// SERVER ONLY. Password hashing + guest session tokens for Bizzux Files'
// external share links (bizzux.com/share/[shareId]) — the one part of this
// app meant to be reachable by people with no Bizzux account at all, so it
// gets its own auth primitives rather than reusing Firebase Auth.
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";
import { adminDb } from "./firebaseAdmin";

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// A guest token only ever proves "this browser correctly entered the
// password for shareId X at some point" — it deliberately carries no
// expiry of its own. Every route that accepts one re-checks the share
// document's live expiresAt/revoked status on every single request, so
// revoking a link or letting it expire takes effect immediately even for
// tokens already handed out, rather than only at next password entry.
export function signGuestToken(shareId) {
  const secret = process.env.SHARE_LINK_SECRET;
  if (!secret) throw new Error("SHARE_LINK_SECRET is not set");
  const payload = Buffer.from(JSON.stringify({ shareId })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

// Returns the shareId the token was signed for, or null if the signature
// doesn't check out. Callers must still separately confirm this matches
// the shareId in the URL they're serving, and re-check expiry/revoked.
export function verifyGuestToken(token) {
  const secret = process.env.SHARE_LINK_SECRET;
  if (!secret || !token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expectedSig = createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(sig || "", "hex");
  const b = Buffer.from(expectedSig, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { shareId } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return shareId || null;
  } catch {
    return null;
  }
}

export function isShareLive(share) {
  if (!share) return false;
  if (share.revoked) return false;
  const expiresAt = share.expiresAt?.toDate ? share.expiresAt.toDate() : share.expiresAt ? new Date(share.expiresAt) : null;
  if (!expiresAt) return false;
  return expiresAt.getTime() > Date.now();
}

// Every guest-facing route (list contents, upload, delete-own, download)
// calls this first. It re-derives liveness from Firestore on every single
// call rather than trusting anything baked into the token, which is what
// makes "revoke this link" and "let it expire" take effect immediately.
export async function requireLiveShare(req, shareId) {
  const authz = req.headers.get("authorization") || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : null;
  if (!token) throw { status: 401, message: "Not signed in to this share" };
  const tokenShareId = verifyGuestToken(token);
  if (!tokenShareId || tokenShareId !== shareId) throw { status: 401, message: "Invalid share session" };

  const ref = adminDb().doc("shareLinks/" + shareId);
  const snap = await ref.get();
  const share = snap.exists ? snap.data() : null;
  if (!isShareLive(share)) throw { status: 410, message: "This link has expired or been revoked." };

  return { ref, share };
}

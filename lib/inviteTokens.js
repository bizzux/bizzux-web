// Invitation tokens. The emailed link carries a long random token; Firestore stores only its SHA-256 as the document id, so reading the
// `invites` collection (a leaked backup, a too-wide rule, a support export) never yields a usable link.
// Invites created before this change used the raw token as the document id; those are still honoured until they expire (`tokenHashed` absent).
import { createHash, randomBytes } from "crypto";

export const hashInviteToken = (token) => createHash("sha256").update(String(token || "")).digest("hex");

export function newInviteToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, id: hashInviteToken(token) };
}

// Which invite document does a presented token point at? `byId(id)` returns a snapshot-like { exists, data() }.
// `signedIn` true (POST, email already matched later) also accepts the document id itself, which /api/my-pending-invite hands to the
// invitee after they proved their email; a pre-sign-in lookup (`signedIn` false) accepts only the emailed token or a legacy raw id.
export async function findInvite(token, byId, { signedIn = false } = {}) {
  const t = String(token || "");
  if (!t) return null;
  const hashed = await byId(hashInviteToken(t));
  if (hashed.exists) return hashed;
  const direct = await byId(t);
  if (!direct.exists) return null;
  if (direct.data().tokenHashed) return signedIn ? direct : null;
  return direct;
}

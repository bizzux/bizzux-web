// Secure hand-off from any Bizzux app (or the portal) to the Admin Center, with NO token in any URL and no cookie shared across subdomains.
//   1. The app asks the portal (POST, signed-in person's Firebase token) for a one-time CODE. The portal checks the person is a company administrator.
//   2. The app submits that code as a form POST to the Admin Center host. The code is in the request BODY: never in a URL, history, access log or Referer.
//   3. The Admin Center host burns the code, checks the request came from the app that asked for it (login-CSRF defence), and sets a short-lived
//      HttpOnly, SameSite=Strict, host-only cookie holding an opaque handle (not a token).
//   4. The Admin Center page redeems the handle once for a Firebase custom token of the SAME person and signs in. Nothing is ever created by email.
// Codes and handles are stored only as SHA-256 hashes, expire quickly and work once. Everything here is server-only.
import { createHash, randomBytes } from "node:crypto";
import { adminDb, adminAuth } from "../firebaseAdmin";
import { safeAdminTarget } from "../adminHost";
import { MENU_APPS } from "./menuModel.js";

export const CODE_TTL_MS = 30_000;
export const HANDLE_TTL_MS = 60_000;
export const HANDLE_COOKIE = "bzx_sso";
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const wwwOrigin = () => (process.env.NEXT_PUBLIC_WWW_ORIGIN || "https://www.bizzux.com").replace(/\/+$/, "");

// The ONLY origins a hand-off may come from or return to: the portal and the Bizzux apps. The client never supplies an origin.
// Local development only: SHELL_APP_ORIGINS='{"attendance":"http://localhost:3095"}' maps an app to its dev origin. Ignored in production builds.
const devOrigins = () => { if (process.env.NODE_ENV === "production") return {}; try { return JSON.parse(process.env.SHELL_APP_ORIGINS || "{}"); } catch { return {}; } };
export const originOfFrom = (from) => (from === "portal" ? wwwOrigin() : devOrigins()[from] || MENU_APPS.find((a) => a.key === from)?.url || null);
export const INTENTS = ["", "add-employee", "add-employee-existing", "add-employee-new"];
export const cleanIntent = (i) => (INTENTS.includes(String(i || "")) ? String(i || "") : "");

// A path on the originating app only (no scheme, no host, no "//", no backslashes, no dot segments).
export function cleanReturnTo(p) {
  const s = String(p || "/");
  if (s.length > 200 || !/^\/[A-Za-z0-9\-._~/%?=&#]*$/.test(s) || s.startsWith("//") || s.includes("..")) return "/";
  return s;
}

export async function createCode({ uid, orgId, from, intent, returnTo, to }) {
  const origin = originOfFrom(from);
  if (!origin) throw { status: 400, message: "Unknown application" };
  const code = randomBytes(32).toString("base64url");
  const ctx = { from, intent: cleanIntent(intent), returnUrl: origin + cleanReturnTo(returnTo), orgId: String(orgId || "") };
  await adminDb().collection("ssoCodes").doc(sha(code)).create({ uid, aud: "admin", ctx, to: safeAdminTarget(to), exp: Date.now() + CODE_TTL_MS, used: false, createdAt: new Date() });
  return { code, returnUrl: ctx.returnUrl };
}

// Burns the code (single use) and returns an opaque handle. `origin` is the Origin header of the posting page: it must be the app that asked.
export async function redeemCode(code, origin) {
  const bad = { status: 401, message: "This sign-in link is invalid or has expired. Open the Admin Center again." };
  if (typeof code !== "string" || code.length < 20 || code.length > 100) throw bad;
  const db = adminDb();
  const ref = db.collection("ssoCodes").doc(sha(code));
  const handle = randomBytes(32).toString("base64url");
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw bad;
    const d = s.data();
    if (d.used || d.aud !== "admin" || d.exp < Date.now()) throw bad;
    const expected = originOfFrom(d.ctx?.from);
    if (!expected || origin !== expected) throw { status: 403, message: "This sign-in request did not come from the app that started it." };
    tx.update(ref, { used: true, usedAt: new Date() });
    tx.create(db.collection("ssoHandles").doc(sha(handle)), { uid: d.uid, ctx: d.ctx, to: d.to, exp: Date.now() + HANDLE_TTL_MS, used: false });
  });
  return handle;
}

// Burns the handle (single use) and returns what the Admin Center page needs to sign the person in.
export async function consumeHandle(handle) {
  const bad = { status: 401, message: "Your sign-in expired. Open the Admin Center again." };
  if (typeof handle !== "string" || handle.length < 20 || handle.length > 100) throw bad;
  const db = adminDb();
  const ref = db.collection("ssoHandles").doc(sha(handle));
  const out = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw bad;
    const d = s.data();
    if (d.used || d.exp < Date.now()) throw bad;
    tx.update(ref, { used: true, usedAt: new Date() });
    return d;
  });
  return { customToken: await adminAuth().createCustomToken(out.uid), to: out.to, context: out.ctx };
}

export function readCookie(req, name) {
  const m = String(req.headers.get("cookie") || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name);
  return m ? decodeURIComponent(m.slice(1).join("=")) : "";
}

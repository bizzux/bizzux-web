// Admin Center hand-off on the Auth + Firestore EMULATORS: who may open it, token format, single use, expiry, audience, tampering, org isolation.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHmac, randomUUID } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
process.env.APP_SSO_SECRET = "test-secret-" + Math.random().toString(36).slice(2);
process.env.ADMIN_CENTER_ORIGIN = "https://admin.example.test";
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run against the emulators only");

const fa = await import("../lib/firebaseAdmin.js");
const hand = await import("../app/api/admin-center/handoff/route.js");
const recv = await import("../app/api/sso/route.js");
const db = fa.adminDb();
const RUN = Math.random().toString(36).slice(2, 8);
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const post = async (p, b) => (await fetch(`${AUTH}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function person(label) {
  const u = await fa.adminAuth().createUser({ email: `${label}-${RUN}@x.test`, emailVerified: true, password: "Passw0rd-" + RUN });
  const token = (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(u.uid), returnSecureToken: true })).idToken;
  return { uid: u.uid, token };
}
const open = (w, to = "/users") => hand.GET(new Request("http://localhost/api/admin-center/handoff?to=" + encodeURIComponent(to), { headers: w ? { Authorization: "Bearer " + w.token } : {} }));
const redeem = (token) => recv.POST(new Request("http://localhost/api/sso", { method: "POST", body: JSON.stringify({ token }) }));
const tokenFrom = (url) => new URLSearchParams(new URL(url).hash.slice(1)).get("token");
const forge = (payload, secretKey) => { const b = Buffer.from(JSON.stringify(payload)).toString("base64url"); const key = createHmac("sha256", process.env.APP_SSO_SECRET).update("bizzux-sso-v2|" + (secretKey || "admin")).digest("hex"); return b + "." + createHmac("sha256", key).update(b).digest("hex"); };

let owner, member, other, outsider;
before(async () => {
  owner = await person("own"); member = await person("mem"); other = await person("oth"); outsider = await person("out");
  await db.doc("customers/" + owner.uid).set({ status: "active", organizationName: "Co A", email: `own-${RUN}@x.test` });
  await db.doc("customers/" + other.uid).set({ status: "active", organizationName: "Co B", email: `oth-${RUN}@x.test` });
  await db.doc("memberships/" + member.uid).set({ accountId: owner.uid, profile: "Staff/Shopkeeper" });
});

test("a company owner gets a fragment URL on the admin origin with a whitelisted target; the token redeems once", async () => {
  const r = await open(owner, "/apps"); assert.equal(r.status, 200);
  const { url } = await r.json();
  assert.ok(url.startsWith("https://admin.example.test/sso#token="), url.slice(0, 60));
  assert.equal(new URLSearchParams(new URL(url).hash.slice(1)).get("to"), "/apps");
  const t = tokenFrom(url);
  const ok = await redeem(t); assert.equal(ok.status, 200);
  const { customToken } = await ok.json();
  const signed = await post("accounts:signInWithCustomToken", { token: customToken, returnSecureToken: true });
  assert.equal((await fa.adminAuth().verifyIdToken(signed.idToken)).uid, owner.uid, "same uid, no new user");
  assert.equal((await redeem(t)).status, 401, "replay refused");
});
test("a target outside the whitelist falls back to /users", async () => {
  const { url } = await (await open(owner, "https://evil.example")).json();
  assert.equal(new URLSearchParams(new URL(url).hash.slice(1)).get("to"), "/users");
});
test("not signed in -> 401; ordinary member -> 403; a user with no company -> not allowed", async () => {
  assert.equal((await open(null)).status, 401);
  assert.equal((await open(member)).status, 403);
  assert.ok((await open(outsider)).status >= 400);
});
test("the token carries the caller's own uid only (Co A admin cannot mint Co B's), and no email or org", async () => {
  const t = tokenFrom((await (await open(other)).json()).url);
  const payload = JSON.parse(Buffer.from(t.split(".")[0], "base64url").toString());
  assert.equal(payload.uid, other.uid);
  assert.deepEqual(Object.keys(payload).sort(), ["aud", "iat", "jti", "uid", "v"]);
  assert.equal(payload.aud, "admin");
});
test("receiver refuses: other audience, legacy format, expired, future-dated, tampered, missing jti, garbage", async () => {
  const now = Date.now();
  assert.equal((await redeem(forge({ v: 2, aud: "crm", jti: randomUUID(), uid: owner.uid, iat: now }, "admin"))).status, 401, "wrong aud");
  assert.equal((await redeem(forge({ v: 2, aud: "admin", jti: randomUUID(), uid: owner.uid, iat: now }, "crm"))).status, 401, "signed with another app's key");
  assert.equal((await redeem(forge({ uid: owner.uid, iat: now }))).status, 401, "legacy (no v2)");
  assert.equal((await redeem(forge({ v: 2, aud: "admin", jti: randomUUID(), uid: owner.uid, iat: now - 120_000 }))).status, 401, "expired");
  assert.equal((await redeem(forge({ v: 2, aud: "admin", jti: randomUUID(), uid: owner.uid, iat: now + 60_000 }))).status, 401, "future-dated");
  assert.equal((await redeem(forge({ v: 2, aud: "admin", uid: owner.uid, iat: now }))).status, 401, "no jti");
  const good = forge({ v: 2, aud: "admin", jti: randomUUID(), uid: owner.uid, iat: now });
  assert.equal((await redeem(good.slice(0, -2) + (good.endsWith("00") ? "11" : "00"))).status, 401, "tampered signature");
  assert.equal((await redeem("not-a-token")).status, 400);
  assert.equal((await redeem(forge({ v: 2, aud: "admin", jti: randomUUID(), uid: owner.uid, iat: now }))).status, 200, "a correctly formed token still works");
});
test("a stale admin who has since been demoted can still redeem (identity only) but every API still enforces the role", async () => {
  const t = tokenFrom((await (await open(owner)).json()).url);
  await db.doc("memberships/" + member.uid).set({ accountId: owner.uid, profile: "Staff/Shopkeeper" });
  assert.equal((await redeem(t)).status, 200); // the hand-off proves who you are, nothing more
  assert.equal((await open(member)).status, 403, "and a non-admin cannot start one");
});

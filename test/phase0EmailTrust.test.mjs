// Phase 0 (unified login): an email only confers authority when a trusted provider proved it. Runs on the Auth + Firestore EMULATORS with real
// ID tokens from each provider type, then drives the portal's own helpers and routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "test@demo-bizzux.iam.gserviceaccount.com" });
const RUN = Math.random().toString(36).slice(2, 8);
const OWNER_EMAIL = `owner-${RUN}@bizzux.test`, SUPER_EMAIL = `super-${RUN}@bizzux.test`;
process.env.PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
process.env.SUPER_ADMIN_EMAIL = SUPER_EMAIL;
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run against the emulators only");

const fa = await import("../lib/firebaseAdmin.js");
const { createUsernameUser, usernameLogin } = await import("../lib/usernameAuth.js");
const { createOrganization } = await import("../lib/organization.js");
const pending = await import("../app/api/my-pending-invite/route.js");
const db = fa.adminDb();
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const post = async (path, body) => (await fetch(`${AUTH}/${path}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

// Tokens exactly as the browser would obtain them from each provider.
const viaIdp = async (providerId, email, verified = true) => {
  const r = await post("accounts:signInWithIdp", { postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: providerId + "-" + email, email, email_verified: verified }))}&providerId=${providerId}`, requestUri: "http://localhost", returnIdpCredential: true, returnSecureToken: true });
  return { uid: r.localId, token: r.idToken, email };
};
const viaPassword = async (email, verified) => {
  const r = await post("accounts:signUp", { email, password: "Passw0rd-" + RUN, returnSecureToken: true });
  if (verified) await fa.adminAuth().updateUser(r.localId, { emailVerified: true });
  const again = await post("accounts:signInWithPassword", { email, password: "Passw0rd-" + RUN, returnSecureToken: true });
  return { uid: r.localId, token: again.idToken, email };
};
const viaCustom = async (uid) => ({ uid, token: (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(uid), returnSecureToken: true })).idToken });
const bearer = (w) => ({ headers: { get: (h) => (h.toLowerCase() === "authorization" ? "Bearer " + w.token : null) } });
const providerOf = async (w) => (await fa.adminAuth().verifyIdToken(w.token)).firebase.sign_in_provider;

// Owner bootstrap only happens while no OWNER exists; earlier suites sharing this emulator may have created one (emulator only).
for (const d of (await db.collection("platformAdmins").where("role", "==", "OWNER").get()).docs) await d.ref.delete();

test("sanity: the emulator really issues tokens for each provider type", async () => {
  assert.equal(await providerOf(await viaIdp("google.com", `g-${RUN}@x.test`)), "google.com");
  assert.equal(await providerOf(await viaIdp("microsoft.com", `m-${RUN}@x.test`)), "microsoft.com");
  assert.equal(await providerOf(await viaPassword(`p-${RUN}@x.test`, true)), "password");
});

test("Google and verified email/password owners keep Platform Owner / super-admin power (no regression)", async () => {
  const g = await viaIdp("google.com", OWNER_EMAIL);
  const c = await fa.requireUser(bearer(g));
  assert.equal(c.trustedEmail, OWNER_EMAIL);
  assert.equal(await fa.resolvePlatformRole(c.uid, c.trustedEmail), "OWNER");
  const s = await viaPassword(SUPER_EMAIL, true);
  const cs = await fa.requireUser(bearer(s));
  assert.equal(cs.isSuper, true);
});

test("Microsoft (or any non-trusted provider) token carrying a super-admin / owner email gets NO authority", async () => {
  for (const [p, mail] of [["microsoft.com", `ms-owner-${RUN}@x.test`], ["oidc.acme", `oidc-${RUN}@x.test`]]) {
    process.env.SUPER_ADMIN_EMAIL = SUPER_EMAIL + "," + mail;
    const w = await viaIdp(p, mail, true);
    const c = await fa.requireUser(bearer(w));
    assert.equal(c.isSuper, false, p);
    assert.equal(c.trustedEmail, "", p);
    assert.equal(c.emailVerified, false, p);
    assert.equal(await fa.resolvePlatformRole(c.uid, c.trustedEmail), null, p);
    assert.equal((await db.doc("platformAdmins/" + c.uid).get()).exists, false, "no platform admin doc may be created");
  }
  process.env.SUPER_ADMIN_EMAIL = SUPER_EMAIL;
});

test("unverified email/password sign-up with a super-admin email gets no authority", async () => {
  const w = await viaPassword(`unv-${RUN}@x.test`, false);
  process.env.SUPER_ADMIN_EMAIL = SUPER_EMAIL + "," + w.email;
  const c = await fa.requireUser(bearer(w));
  assert.equal(c.isSuper, false);
  assert.equal(c.trustedEmail, "");
  process.env.SUPER_ADMIN_EMAIL = SUPER_EMAIL;
});

test("custom-token sessions (portal SSO into the apps) follow the account record, not the token", async () => {
  const g = await viaIdp("google.com", `cg-${RUN}@x.test`);
  assert.equal((await fa.requireUser(bearer(await viaCustom(g.uid)))).trustedEmail, `cg-${RUN}@x.test`);
  const m = await viaIdp("microsoft.com", `cm-${RUN}@x.test`);
  assert.equal((await fa.requireUser(bearer(await viaCustom(m.uid)))).trustedEmail, "");
  // legacy admin-created @bizzux.login login: verified, password provider
  const u = await fa.adminAuth().createUser({ email: `ravi${RUN}@bizzux.login`, emailVerified: true, password: "Passw0rd-" + RUN });
  assert.equal((await fa.requireUser(bearer(await viaCustom(u.uid)))).trustedEmail, `ravi${RUN}@bizzux.login`);
});

test("username/password accounts without any email still sign in and resolve; they never gain an email", async () => {
  const orgX = "p0org" + RUN;
  await createOrganization({ id: orgX, name: "P0 Org", type: "CUSTOMER", createdBy: orgX });
  await db.doc("customers/" + orgX).set({ email: `own-${RUN}@x.test`, organizationName: "P0 Org", status: "active" });
  const name = "p0.user." + RUN;
  const made = await createUsernameUser({ username: name, password: "Str0ng-pass-" + RUN, displayName: "No Email", organizationId: orgX, mustChangePassword: false });
  const r = await usernameLogin({ username: name, password: "Str0ng-pass-" + RUN, ip: "10.9.9.9" });
  assert.ok(r.token, "login yields a token");
  const c = await fa.requireUser(bearer(await viaCustom(made.uid)));
  assert.equal(c.uid, made.uid);
  assert.equal(c.email, "");
  assert.equal(c.trustedEmail, "");
  assert.equal(c.isSuper, false);
});

test("organization isolation: an untrusted-provider email never matches an invite or an existing company", async () => {
  const victim = `ceo-${RUN}@victim.test`;
  await db.doc("invites/tok-" + RUN).set({ email: victim, used: false, accountId: "orgVictim", invitedAt: new Date() });
  const ms = await viaIdp("microsoft.com", victim, true);
  const resMs = await pending.GET(new Request("http://localhost/api/my-pending-invite", { headers: { Authorization: "Bearer " + ms.token } }));
  assert.equal((await resMs.json()).invite, null, "no pending invite leaks to an untrusted provider");
  const unv = await viaPassword(`other-${RUN}@x.test`, false);
  const resUnv = await pending.GET(new Request("http://localhost/api/my-pending-invite", { headers: { Authorization: "Bearer " + unv.token } }));
  assert.equal((await resUnv.json()).invite, null);
  // a real Google-verified owner of that address (a different Firebase user, as in production) still sees it
  const real = await viaIdp("google.com", `real-${RUN}@x.test`, true);
  await db.doc("invites/tok2-" + RUN).set({ email: `real-${RUN}@x.test`, used: false, accountId: "orgReal", invitedAt: new Date() });
  const resReal = await pending.GET(new Request("http://localhost/api/my-pending-invite", { headers: { Authorization: "Bearer " + real.token } }));
  assert.equal((await resReal.json()).invite?.token, "tok2-" + RUN);
  await assert.rejects(fa.resolveAccount(ms.uid), (e) => e.status === 404, "the untrusted sign-in resolves to no company at all");
});

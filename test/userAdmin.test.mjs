// Reset password and user details (Admin Center drawers): authorization, tenant scope, provider rules, audit. Auth + Firestore EMULATORS, real routes.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run against the emulators only");

const fa = await import("../lib/firebaseAdmin.js");
const ids = await import("../app/api/iam/identities/route.js");
const detailRoute = await import("../app/api/iam/users/[uid]/route.js");
const auth = await import("../lib/usernameAuth.js");
const db = fa.adminDb();
const RUN = Math.random().toString(36).slice(2, 7);
const AUTHURL = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const post = async (p, b) => (await fetch(`${AUTHURL}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function person(label, extra = {}) {
  const u = await fa.adminAuth().createUser({ email: `${label}-${RUN}@x.test`, emailVerified: true, displayName: label, ...extra });
  return { uid: u.uid, label, token: (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(u.uid), returnSecureToken: true })).idToken };
}
const hdr = (w) => ({ ...(w ? { Authorization: "Bearer " + w.token } : {}), "Content-Type": "application/json" });
const iam = (w, body) => ids.POST(new Request("http://x/api/iam/identities", { method: "POST", headers: hdr(w), body: JSON.stringify(body) }));
const details = (w, uid) => detailRoute.GET(new Request("http://x/api/iam/users/" + uid, { headers: hdr(w) }), { params: { uid } });
const un = (s) => `${s}${RUN}`;
let A, B, adm, mem, googleUser, pat;
before(async () => {
  A = await person("ownerA"); B = await person("ownerB"); adm = await person("adm"); mem = await person("mem"); googleUser = await person("goog");
  for (const w of [A, B]) {
    await db.doc("customers/" + w.uid).set({ status: "active", organizationName: "Org " + w.label });
    await db.doc(`organizationMemberships/${w.uid}_${w.uid}`).set({ organizationId: w.uid, userId: w.uid, role: "OWNER", status: "active" });
    await db.doc(`organizationAppSubscriptions/${w.uid}_bizzux-crm`).set({ organizationId: w.uid, appId: "bizzux-crm", status: "ACTIVE" });
  }
  const m = async (w, profile) => { await db.doc("memberships/" + w.uid).set({ accountId: A.uid, profile }); await db.doc(`organizationMemberships/${A.uid}_${w.uid}`).set({ organizationId: A.uid, userId: w.uid, role: "MEMBER", status: "active" }); await db.doc(`customers/${A.uid}/team/${w.uid}`).set({ firstName: w.label, uid: w.uid, profile, department: "Ops", designation: "Lead", contactInfo: { jobTitle: "Lead", city: "Chennai" }, status: "active" }); };
  await m(adm, "Admin"); await m(mem, "Staff/Shopkeeper"); await m(googleUser, "Staff/Shopkeeper");
  pat = await (await iam(A, { kind: "username", fullName: "Pat Pending", username: un("pat"), apps: ["bizzux-crm"] })).json();
});

test("reset password: only for Bizzux username logins homed here, by administrators; Google accounts, Owner, self and other companies are refused", async () => {
  assert.equal((await iam(mem, { kind: "resetPassword", uid: pat.uid })).status, 403, "a member can't");
  assert.equal((await iam(B, { kind: "resetPassword", uid: pat.uid })).status, 404, "another company can't");
  assert.equal((await iam(A, { kind: "resetPassword", uid: googleUser.uid })).status, 400, "provider-managed account");
  const g = await (await iam(A, { kind: "resetPassword", uid: googleUser.uid })).json();
  assert.match(g.error, /Google or email/);
  assert.equal((await iam(A, { kind: "resetPassword", uid: A.uid })).status, 403, "never the Owner");
  assert.equal((await iam(adm, { kind: "resetPassword", uid: adm.uid })).status, 403, "never yourself");
  const r = await iam(adm, { kind: "resetPassword", uid: pat.uid });
  assert.equal(r.status, 200); const out = await r.json();
  assert.ok(out.password && out.mustChange === true && out.username === un("pat"));
  await assert.rejects(auth.usernameLogin({ username: un("pat"), password: pat.password, ip: "9.9.9.1" }), (e) => e.status === 401, "the old password is dead");
  assert.equal((await auth.usernameLogin({ username: un("pat"), password: out.password, ip: "9.9.9.1" })).mustChangePassword, true);
});

test("custom password: policy enforced, 'require change' can be turned off, stored hashed, audited", async () => {
  assert.equal((await iam(A, { kind: "resetPassword", uid: pat.uid, password: "abc" })).status, 400, "weak password refused");
  const ok = await iam(A, { kind: "resetPassword", uid: pat.uid, password: "Custom-Pass-2026!", mustChange: false });
  assert.equal(ok.status, 200); const out = await ok.json();
  assert.equal(out.mustChange, false);
  assert.equal((await auth.usernameLogin({ username: un("pat"), password: "Custom-Pass-2026!", ip: "9.9.9.2" })).mustChangePassword, false);
  const doc = (await db.doc("usernames/" + un("pat")).get()).data();
  assert.ok(!JSON.stringify(doc).includes("Custom-Pass-2026!"), "never stored in clear text");
  const aud = await db.collection("auditLogs").where("action", "==", "user.reset_password").get();
  assert.ok(aud.size >= 2 && aud.docs.every((d) => !JSON.stringify(d.data()).includes("Custom-Pass")), "audited without the password");
});

test("details: one round trip for a member of THIS company; others get 404; members and anonymous are refused", async () => {
  const r = await details(adm, pat.uid);
  assert.equal(r.status, 200); const d = await r.json();
  assert.equal(d.username, un("pat")); assert.equal(d.loginKind, "username");
  assert.equal(d.account.homeCompany, true); assert.equal(d.account.canResetPassword, true);
  assert.equal(d.organization.role, "MEMBER");
  const crm = d.apps.find((a) => a.appId === "bizzux-crm"); assert.deepEqual([crm.access, crm.appRole, crm.source], [true, "MEMBER", "assignment"]);
  assert.ok(Array.isArray(d.activity) && d.activity.some((x) => x.action === "user.create_username"), "creation is in the activity list");
  assert.ok(!JSON.stringify(d).match(/hash|salt|recovery":\[/), "no secrets");
  assert.equal((await details(B, pat.uid)).status, 404, "another company cannot open it");
  assert.equal((await details(mem, pat.uid)).status, 403, "a member cannot");
  assert.equal((await details(null, pat.uid)).status, 401);
  const t = await (await details(A, mem.uid)).json();
  assert.deepEqual([t.profileInfo.department, t.profileInfo.jobTitle, t.profileInfo.contactInfo.city], ["Ops", "Lead", "Chennai"]);
  const g = await (await details(A, googleUser.uid)).json(); assert.equal(g.account.canResetPassword, false);
  const o = await (await details(adm, A.uid)).json(); assert.equal(o.organization.role, "OWNER"); assert.equal(o.account.canResetPassword, false);
});

test("details report other companies only as a count, never their names or data", async () => {
  await iam(B, { kind: "link", username: un("pat") });
  const patW = { uid: pat.uid, token: (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(pat.uid), returnSecureToken: true })).idToken };
  const links = await import("../app/api/link-requests/route.js");
  const req = (await (await links.GET(new Request("http://x/api/link-requests", { headers: hdr(patW) }))).json()).requests[0];
  await links.POST(new Request("http://x/api/link-requests", { method: "POST", headers: hdr(patW), body: JSON.stringify({ id: req.id, accept: true }) }));
  const d = await (await details(A, pat.uid)).json();
  assert.equal(d.organization.otherOrganizations, 1);
  assert.ok(!JSON.stringify(d).includes("Org ownerB"), "no other company name");
  const dB = await (await details(B, pat.uid)).json();
  assert.equal(dB.account.homeCompany, false, "B sees this login as homed elsewhere");
  assert.equal(dB.account.canResetPassword, false, "so B's administrators cannot reset it");
});

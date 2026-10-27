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

// ---- Edit after creation: names, account expiry, descriptive profile, business profile ----
const patch = (w, uid, body) => detailRoute.PATCH(new Request("http://x/api/iam/users/" + uid, { method: "PATCH", headers: hdr(w), body: JSON.stringify(body) }), { params: { uid } });
const teamOf = async (uid) => (await db.collection(`customers/${A.uid}/team`).where("uid", "==", uid).get()).docs[0].data();
const lastAudit = async (action, uid) => (await db.collection("auditLogs").where("action", "==", action).where("targetId", "==", uid).get()).docs.map((d) => d.data()).sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())[0];

test("names: first, last and display name are saved everywhere the name lives; display name is required and never rebuilt behind your back", async () => {
  const r = await patch(A, pat.uid, { firstName: "Patricia", lastName: "Pending", displayName: "Patricia P." });
  assert.equal(r.status, 200); assert.deepEqual((await r.json()).changed.sort(), ["displayName", "firstName", "lastName"]);
  assert.equal((await fa.adminAuth().getUser(pat.uid)).displayName, "Patricia P.", "Firebase Auth");
  assert.equal((await db.doc("usernames/" + un("pat")).get()).data().displayName, "Patricia P.", "username record");
  const t = await teamOf(pat.uid); assert.deepEqual([t.firstName, t.lastName, t.displayName], ["Patricia", "Pending", "Patricia P."], "team record");
  assert.equal((await (await details(A, pat.uid)).json()).name, "Patricia P.", "details / list name");

  const only = await patch(A, pat.uid, { firstName: "Pat" }); // display name not sent
  assert.deepEqual((await only.json()).changed, ["firstName"]);
  assert.equal((await fa.adminAuth().getUser(pat.uid)).displayName, "Patricia P.", "display name untouched by a first-name edit");
  const same = await patch(A, pat.uid, { firstName: "Pat", lastName: "Pending", displayName: "Patricia P." }); // unchanged display name is not a change
  assert.deepEqual((await same.json()).changed, []);

  const empty = await patch(A, pat.uid, { firstName: "X", displayName: "   " });
  assert.equal(empty.status, 400); assert.match((await empty.json()).error, /Display name is required/);
  assert.equal((await teamOf(pat.uid)).firstName, "Pat", "nothing written on a refused save");
  const long = await patch(A, pat.uid, { displayName: "x".repeat(200) }); assert.equal(long.status, 200);
  assert.equal((await fa.adminAuth().getUser(pat.uid)).displayName.length, 80, "length limited");
  await patch(A, pat.uid, { displayName: "Patricia P." });

  const aud = await lastAudit("user.update_profile", pat.uid);
  assert.ok(Array.isArray(aud.details.changed) && aud.details.changed.includes("displayName"), "audit lists the changed fields");
});

test("name and expiry belong to a username login homed here: Google/email accounts and other companies' logins are refused, login ID and email never change", async () => {
  assert.equal((await patch(A, googleUser.uid, { firstName: "Gee" })).status, 400);
  assert.equal((await patch(A, googleUser.uid, { accountExpiresAt: "2030-01-01" })).status, 400);
  assert.equal((await patch(B, mem.uid, { firstName: "Hax" })).status, 404, "another company can't reach a person who isn't theirs");
  const away = await patch(B, pat.uid, { firstName: "Hax", displayName: "Hacked" }); // pat joined B but the login is homed in A
  assert.equal(away.status, 400); assert.match((await away.json()).error, /managed by/);
  assert.equal((await fa.adminAuth().getUser(pat.uid)).displayName, "Patricia P.", "B changed nothing");
  assert.equal((await patch(mem, pat.uid, { firstName: "Hax" })).status, 403, "a member can't");
  assert.equal((await patch(null, pat.uid, { firstName: "Hax" })).status, 401);
  const before = await fa.adminAuth().getUser(googleUser.uid);
  const r = await patch(A, googleUser.uid, { username: "hacked", email: "evil@x.test", loginId: "hacked", contactInfo: { city: "Madurai" } });
  assert.equal(r.status, 200);
  assert.equal((await fa.adminAuth().getUser(googleUser.uid)).email, before.email, "email untouched");
  assert.equal((await db.doc("usernames/hacked").get()).exists, false, "login ID untouched");
});

test("account expiry: set, validate, clear; a past date ends the login; audited with old and new date", async () => {
  assert.equal((await patch(A, pat.uid, { accountExpiresAt: "2030-02-30" })).status, 400, "impossible date");
  assert.equal((await patch(A, pat.uid, { accountExpiresAt: "next week" })).status, 400);
  const ok = await patch(A, pat.uid, { accountExpiresAt: "2030-01-01" });
  assert.deepEqual((await ok.json()).changed, ["accountExpiresAt"]);
  assert.equal((await db.doc("usernames/" + un("pat")).get()).data().accountExpiresAt, "2030-01-01");
  assert.equal((await teamOf(pat.uid)).accountExpiresAt, "2030-01-01");
  assert.equal((await (await details(A, pat.uid)).json()).account.accountExpiresAt, "2030-01-01");
  assert.deepEqual((await lastAudit("user.update_profile", pat.uid)).details.accountExpiresAt, { from: "", to: "2030-01-01" });

  await patch(A, pat.uid, { accountExpiresAt: "2020-01-01" });
  await assert.rejects(auth.usernameLogin({ username: un("pat"), password: "Custom-Pass-2026!", ip: "9.9.9.3" }), "expired login is refused");
  const cleared = await patch(A, pat.uid, { accountExpiresAt: "" });
  assert.deepEqual((await cleared.json()).changed, ["accountExpiresAt"]);
  assert.equal((await db.doc("usernames/" + un("pat")).get()).data().accountExpiresAt, "");
  assert.equal((await auth.usernameLogin({ username: un("pat"), password: "Custom-Pass-2026!", ip: "9.9.9.4" })).mustChangePassword, false, "works again once cleared");
});

test("profile fields: every field saves, clearing works, unsent groups and the fax number are left alone, audit lists field names only", async () => {
  await db.doc(`customers/${A.uid}/team/${mem.uid}`).set({ contactInfo: { faxNumber: "044-111" } }, { merge: true });
  const full = { jobTitle: "Manager", department: "Sales", employmentType: "Contractor", office: "HQ-2", officePhone: "044-222", mobilePhone: "98400 00000", streetAddress: "1 Main Rd", city: "Chennai", state: "TN", zip: "600001", country: "India" };
  const r = await patch(A, mem.uid, { branch: "South", employeeId: "E-42", contactInfo: full });
  assert.equal(r.status, 200);
  const t = await teamOf(mem.uid);
  assert.deepEqual([t.branch, t.employeeId, t.designation, t.department, t.employmentType, t.mobile], ["South", "E-42", "Manager", "Sales", "Contractor", "98400 00000"]);
  for (const [k, v] of Object.entries(full)) assert.equal(t.contactInfo[k], v, k);
  assert.equal(t.contactInfo.faxNumber, "044-111", "fax number not in the form is preserved");
  const aud = await lastAudit("user.update_profile", mem.uid);
  assert.ok(aud.details.changed.includes("country") && aud.details.changed.includes("branch") && !aud.details.changed.includes("city"), "only what changed (city was already Chennai)");
  assert.ok(!JSON.stringify(aud.details).includes("India"), "values are not written to the audit trail");

  const names = await patch(A, mem.uid, { branch: "South" }); // contactInfo not sent: left alone
  assert.deepEqual((await names.json()).changed, []);
  assert.equal((await teamOf(mem.uid)).contactInfo.city, "Chennai");

  const blank = Object.fromEntries(Object.keys(full).map((k) => [k, ""]));
  const cleared = await patch(A, mem.uid, { branch: "", employeeId: "", contactInfo: blank });
  assert.ok((await cleared.json()).changed.length >= 11);
  const c2 = await teamOf(mem.uid);
  assert.deepEqual([c2.branch, c2.employeeId, c2.designation, c2.department, c2.mobile], ["", "", "", "", ""]);
  for (const k of Object.keys(full)) assert.equal(c2.contactInfo[k], "", k + " cleared");
  assert.equal(c2.contactInfo.faxNumber, "044-111");
  await patch(A, mem.uid, { contactInfo: { city: " " + "c".repeat(300) + " " } });
  assert.equal((await teamOf(mem.uid)).contactInfo.city.length, 100, "trimmed and length limited");
});

test("business profile: changeable after creation; Admin-level moves need the Owner; no Global Admin, self or Owner changes; audited", async () => {
  const newbie = await person("newbie");
  await db.doc("memberships/" + newbie.uid).set({ accountId: A.uid, profile: "Staff/Shopkeeper" });
  await db.doc(`organizationMemberships/${A.uid}_${newbie.uid}`).set({ organizationId: A.uid, userId: newbie.uid, role: "MEMBER", status: "active" });
  await db.doc(`customers/${A.uid}/team/${newbie.uid}`).set({ firstName: "Newbie", uid: newbie.uid, profile: "Staff/Shopkeeper", role: "Staff/Shopkeeper", status: "active" });
  const setP = (w, uid, profile) => iam(w, { kind: "profile", uid, profile });

  assert.equal((await setP(newbie, mem.uid, "Manager")).status, 403, "a member can't");
  assert.equal((await setP(B, newbie.uid, "Manager")).status, 404, "another company can't");
  assert.equal((await setP(A, newbie.uid, "Bogus")).status, 400);
  assert.equal((await setP(A, newbie.uid, "Global Admin")).status, 400, "Global Admin is never assigned here");
  assert.equal((await setP(A, A.uid, "Manager")).status, 403, "never the Owner");

  assert.equal((await setP(adm, newbie.uid, "Manager")).status, 200);
  assert.equal((await teamOf(newbie.uid)).profile, "Manager");
  assert.equal((await db.doc("memberships/" + newbie.uid).get()).data().profile, "Manager");
  assert.equal((await (await details(A, newbie.uid)).json()).organization.profile, "Manager");
  const a = await lastAudit("user.set_profile", newbie.uid); assert.deepEqual([a.details.from, a.details.to], ["Staff/Shopkeeper", "Manager"]);
  assert.equal((await (await setP(adm, newbie.uid, "Manager")).json()).unchanged, true, "same value is a no-op");

  assert.equal((await setP(adm, newbie.uid, "Admin")).status, 403, "an Admin can't make an Admin");
  assert.equal((await setP(adm, adm.uid, "Manager")).status, 403, "nobody changes their own profile");
  assert.equal((await setP(A, newbie.uid, "Admin")).status, 200, "the Owner can");
  assert.equal((await (await details(A, newbie.uid)).json()).organization.role, "ADMIN", "Admin profile gives the derived Admin role");
  assert.equal((await setP(adm, newbie.uid, "Manager")).status, 403, "an Admin can't remove an Admin either");
  assert.equal((await setP(A, newbie.uid, "Viewer/Auditor")).status, 200);
});

test("organization role and app access are changeable after creation through the existing audited flows", async () => {
  assert.equal((await iam(A, { kind: "orgRole", uid: pat.uid, role: "VIEWER" })).status, 200);
  assert.equal((await (await details(A, pat.uid)).json()).organization.role, "VIEWER");
  assert.equal((await iam(adm, { kind: "orgRole", uid: pat.uid, role: "ADMIN" })).status, 403, "Admin assignment stays Owner-only");
  assert.equal((await iam(A, { kind: "apps", uid: pat.uid, apps: [] })).status, 200);
  assert.equal((await (await details(A, pat.uid)).json()).apps.find((x) => x.appId === "bizzux-crm").access, false);
  assert.equal((await iam(A, { kind: "apps", uid: pat.uid, apps: ["bizzux-crm"] })).status, 200);
  assert.equal((await (await details(A, pat.uid)).json()).apps.find((x) => x.appId === "bizzux-crm").access, true);
  for (const action of ["org.set_role", "user.set_apps"]) assert.ok(await lastAudit(action, pat.uid), action + " audited");
});

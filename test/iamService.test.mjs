// Shared IAM service on the Auth + Firestore EMULATORS, through the real routes (/api/iam/*, /api/link-requests). Synthetic companies only.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run against the emulators only");

const fa = await import("../lib/firebaseAdmin.js");
const ids = await import("../app/api/iam/identities/route.js");
const dir = await import("../app/api/iam/directory/route.js");
const links = await import("../app/api/link-requests/route.js");
const access = await import("../lib/appAccess.js");
const db = fa.adminDb();
const RUN = Math.random().toString(36).slice(2, 7);
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const post = async (p, b) => (await fetch(`${AUTH}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function person(label) {
  const u = await fa.adminAuth().createUser({ email: `${label}-${RUN}@x.test`, emailVerified: true, password: "Passw0rd-" + RUN, displayName: label });
  return withToken(u.uid, label);
}
async function withToken(uid, label = "") {
  const token = (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(uid), returnSecureToken: true })).idToken;
  return { uid, token, label };
}
const hdr = (w) => ({ ...(w ? { Authorization: "Bearer " + w.token } : {}), "Content-Type": "application/json" });
const create = (w, body) => ids.POST(new Request("http://x/api/iam/identities", { method: "POST", headers: hdr(w), body: JSON.stringify(body) }));
const directory = (w, q = "") => dir.GET(new Request("http://x/api/iam/directory" + q, { headers: hdr(w) }));
const myLinks = async (w) => (await (await links.GET(new Request("http://x/api/link-requests", { headers: hdr(w) }))).json()).requests;
const answer = (w, id, accept) => links.POST(new Request("http://x/api/link-requests", { method: "POST", headers: hdr(w), body: JSON.stringify({ id, accept }) }));
const un = (s) => `${s}${RUN}`;

let A, B, manager, adminA;
const member = async (w, org, role, profile) => {
  await db.doc("memberships/" + w.uid).set({ accountId: org, profile });
  await db.doc(`organizationMemberships/${org}_${w.uid}`).set({ organizationId: org, userId: w.uid, role, profile, status: "active" });
};
before(async () => {
  A = await person("ownerA"); B = await person("ownerB"); manager = await person("mgrA"); adminA = await person("admA");
  await db.doc("customers/" + A.uid).set({ status: "active", organizationName: "Org A" });
  await db.doc("customers/" + B.uid).set({ status: "active", organizationName: "Org B" });
  await db.doc(`organizationMemberships/${A.uid}_${A.uid}`).set({ organizationId: A.uid, userId: A.uid, role: "OWNER", status: "active" });
  await db.doc(`organizationMemberships/${B.uid}_${B.uid}`).set({ organizationId: B.uid, userId: B.uid, role: "OWNER", status: "active" });
  for (const org of [A.uid, B.uid]) await db.doc(`organizationAppSubscriptions/${org}_bizzux-crm`).set({ organizationId: org, appId: "bizzux-crm", status: "ACTIVE" });
  await member(manager, A.uid, "MEMBER", "Manager");
  await member(adminA, A.uid, "ADMIN", "Admin");
});

test("authentication and role: anonymous 401, non-admin 403, admin allowed", async () => {
  const body = { kind: "username", fullName: "X", username: un("noauth") };
  assert.equal((await create(null, body)).status, 401);
  assert.equal((await create(manager, body)).status, 403);
  assert.equal((await directory(manager)).status, 403);
  assert.equal((await db.doc("usernames/" + un("noauth")).get()).exists, false);
});

let created;
test("create a username identity: one canonical identity, canonical membership, entitled app, password shown once", async () => {
  const r = await create(adminA, { kind: "username", fullName: "Asha Rao", username: un("asha"), apps: ["bizzux-crm"], profile: "Staff/Shopkeeper", organizationId: B.uid });
  assert.equal(r.status, 403, "an admin cannot name another company in the body");
  const ok = await create(adminA, { kind: "username", fullName: "Asha Rao", username: un("asha"), apps: ["bizzux-crm"], profile: "Staff/Shopkeeper" });
  assert.equal(ok.status, 200); created = await ok.json();
  assert.ok(created.uid && created.password && created.username === un("asha"));
  const m = (await db.doc(`organizationMemberships/${A.uid}_${created.uid}`).get()).data();
  assert.deepEqual([m.role, m.status], ["MEMBER", "active"]);
  assert.equal((await db.doc(`appAssignments/${A.uid}_${created.uid}_bizzux-crm`).get()).data().status, "ACTIVE");
  const u = (await db.doc("usernames/" + un("asha")).get()).data();
  assert.ok(u.hash && u.hash !== created.password, "stored only as a hash");
  assert.equal((await fa.adminAuth().getUser(created.uid)).uid, created.uid, "a real Firebase user, no fake email");
  assert.equal((await fa.adminAuth().getUser(created.uid)).email, undefined);
});

test("directory: canonical, org-scoped, no secrets", async () => {
  const d = await (await directory(adminA)).json();
  const row = d.users.find((x) => x.uid === created.uid);
  assert.deepEqual([row.loginKind, row.username, row.apps, row.pendingActivation], ["username", un("asha"), ["bizzux-crm"], true]);
  assert.ok(d.enabledApps.includes("bizzux-crm"));
  const text = JSON.stringify(d);
  for (const secret of ["hash", "salt", "password", "recovery"]) assert.ok(!text.toLowerCase().includes(secret), "leaks " + secret);
  const dB = await (await directory(B)).json();
  assert.ok(!dB.users.some((x) => x.uid === created.uid), "company B does not see company A's people");
  assert.equal((await directory(B, "?organizationId=" + A.uid)).status, 403, "cross-tenant read refused");
});

test("rules: entitlement, duplicates (both stores) and seat limit are enforced on the server", async () => {
  const noApp = await create(adminA, { kind: "username", fullName: "Y", username: un("noapp"), apps: ["bizzux-projects"] });
  assert.equal(noApp.status, 400);
  assert.equal((await db.doc("usernames/" + un("noapp")).get()).exists, false, "a refused request leaves nothing behind");
  assert.equal((await create(adminA, { kind: "username", fullName: "Dup", username: un("asha") })).status, 409);
  await db.doc("attUsernames/" + un("legacy")).set({ accountId: A.uid, uid: "att_x" });
  assert.equal((await create(adminA, { kind: "username", fullName: "Dup2", username: un("legacy") })).status, 409, "legacy Attendance names stay reserved");
  await db.doc("customers/" + B.uid).set({ allowedUsers: 1 }, { merge: true });
  assert.equal((await create(B, { kind: "username", fullName: "Z", username: un("seat") })).status, 400, "licence/seat limit");
  await db.doc("customers/" + B.uid).set({ allowedUsers: 0 }, { merge: true });
});

test("application access: grant and revoke without recreating the identity; other tenants cannot touch it", async () => {
  assert.equal((await create(B, { kind: "apps", uid: created.uid, apps: [] })).status, 404, "company B has no such member");
  assert.equal((await create(adminA, { kind: "apps", uid: created.uid, apps: ["bizzux-projects"] })).status, 400, "not entitled");
  const ref = { organizationId: A.uid, userId: created.uid, appId: "bizzux-crm" };
  assert.equal(await access.canAccessApp(ref), true);
  assert.equal((await create(adminA, { kind: "apps", uid: created.uid, apps: [] })).status, 200);
  assert.equal(await access.canAccessApp(ref), false, "revocation takes effect on the server check");
  assert.equal((await create(adminA, { kind: "apps", uid: created.uid, apps: ["bizzux-crm"] })).status, 200);
  assert.equal(await access.canAccessApp(ref), true);
  assert.equal((await db.collection("usernames").where("uid", "==", created.uid).get()).size, 1, "still one identity");
});

test("link an existing login to a second company: generic answer, the person accepts, no duplicate identity", async () => {
  const known = await create(B, { kind: "link", username: un("asha"), apps: ["bizzux-crm"] });
  const unknown = await create(B, { kind: "link", username: un("nobody") });
  assert.deepEqual(await known.json(), await unknown.json(), "cannot probe which usernames exist");
  const asha = await withToken(created.uid);
  const pending = await myLinks(asha);
  assert.equal(pending.length, 1);
  assert.equal((await db.doc(`organizationMemberships/${B.uid}_${created.uid}`).get()).exists, false, "nothing changes before acceptance");
  const stranger = await person("stranger");
  assert.ok((await answer(stranger, pending[0].id, true)).status >= 400, "someone else cannot accept it");
  assert.equal((await answer(asha, pending[0].id, true)).status, 200);
  assert.equal((await db.doc(`organizationMemberships/${B.uid}_${created.uid}`).get()).data().status, "active");
  assert.ok((await (await directory(B)).json()).users.some((x) => x.uid === created.uid), "visible to company B");
  assert.ok((await (await directory(adminA)).json()).users.some((x) => x.uid === created.uid), "and still in company A");
  assert.equal((await db.collection("usernames").where("uid", "==", created.uid).get()).size, 1, "one identity across both companies");
  assert.equal(await access.canAccessApp({ organizationId: B.uid, userId: created.uid, appId: "bizzux-crm" }), true);
  assert.equal(await access.canAccessApp({ organizationId: B.uid, userId: created.uid, appId: "bizzux-projects" }), false);
});

test("declined link request changes nothing", async () => {
  const other = await create(adminA, { kind: "username", fullName: "Ben", username: un("ben") });
  const ben = await withToken((await other.json()).uid);
  await create(B, { kind: "link", username: un("ben") });
  const [req] = await myLinks(ben);
  assert.equal((await answer(ben, req.id, false)).status, 200);
  assert.equal((await db.doc(`organizationMemberships/${B.uid}_${ben.uid}`).get()).exists, false);
});

// ---- retry / idempotency (scenarios G, H) ----
const teamRows = async (org, uid) => (await db.collection(`customers/${org}/team`).where("uid", "==", uid).get()).size;
test("G: a create that failed downstream is retried with the same key: same identity, nothing duplicated, nothing deleted", async () => {
  const key = "req_" + RUN + "_aaaa";
  const first = await (await create(adminA, { kind: "username", fullName: "Retry Ravi", username: un("ravi"), apps: ["bizzux-crm"], idempotencyKey: key })).json();
  // (the caller now "fails" to save its own record and asks again)
  const r2 = await create(adminA, { kind: "username", fullName: "Retry Ravi", username: un("ravi"), apps: ["bizzux-crm"], idempotencyKey: key });
  assert.equal(r2.status, 200); const second = await r2.json();
  assert.deepEqual([second.uid, second.reused], [first.uid, true]);
  assert.notEqual(second.password, first.password, "a fresh temporary password; the old one is dead");
  assert.equal((await db.collection("usernames").where("uid", "==", first.uid).get()).size, 1);
  assert.equal(await teamRows(A.uid, first.uid), 1, "no second team row, so no seat inflation");
  assert.equal((await db.collection("organizationMemberships").where("userId", "==", first.uid).get()).size, 1);
  assert.equal((await db.collection("appAssignments").where("userId", "==", first.uid).get()).size, 1);
  assert.equal((await fa.adminAuth().getUser(first.uid)).uid, first.uid, "the identity was never deleted");
  const r3 = await create(adminA, { kind: "username", fullName: "Retry Ravi", username: un("ravi"), idempotencyKey: "req_" + RUN + "_bbbb" });
  assert.equal(r3.status, 409, "a different key never adopts an existing name");
  const r4 = await create(B, { kind: "username", fullName: "Intruder", username: un("ravi"), idempotencyKey: key });
  assert.equal(r4.status, 409, "another company can't adopt it even with the same key");
  await db.doc("usernames/" + un("ravi")).set({ lastLoginAt: new Date() }, { merge: true });
  assert.equal((await create(adminA, { kind: "username", fullName: "x", username: un("ravi"), idempotencyKey: key })).status, 409, "once the person has signed in it is never re-issued");
});

test("H: repeated link requests and acceptances create one request, one membership, one seat", async () => {
  const mk = await (await create(adminA, { kind: "username", fullName: "Hari", username: un("hari") })).json();
  const hari = await withToken(mk.uid);
  await create(B, { kind: "link", username: un("hari") }); await create(B, { kind: "link", username: un("hari") });
  assert.equal((await db.collection("linkRequests").where("targetUid", "==", mk.uid).get()).size, 1);
  const [rq] = await myLinks(hari);
  assert.equal((await answer(hari, rq.id, true)).status, 200);
  assert.ok((await answer(hari, rq.id, true)).status >= 400, "second acceptance refused");
  assert.equal(await teamRows(B.uid, mk.uid), 1);
  assert.equal((await db.collection("organizationMemberships").where("userId", "==", mk.uid).where("organizationId", "==", B.uid).get()).size, 1);
  await create(B, { kind: "link", username: un("hari") });
  assert.equal((await db.collection("linkRequests").where("targetUid", "==", mk.uid).where("status", "==", "pending").get()).size, 0, "already a member: no new request");
});

// ---- employee binding after acceptance (scenarios C, D) ----
test("C/D: accepting a link binds the chosen employee, tenant-scoped, once, audited; history is untouched", async () => {
  const emp = (org, id, extra = {}) => db.doc(`customers/${org}/attEmployees/${id}`).set({ name: id, status: "active", userId: null, history: "keep", ...extra });
  const mk = await (await create(adminA, { kind: "username", fullName: "Bind Bina", username: un("bina") })).json();
  const bina = await withToken(mk.uid);
  await emp(B.uid, "empB1"); await emp(A.uid, "empA1"); await emp(B.uid, "empB2", { userId: "someoneElse" }); await emp(B.uid, "empB3", { loginEmail: "x@y.test" });
  assert.equal((await create(B, { kind: "link", username: un("bina"), bindEmployeeId: "empA1" })).status, 404, "an employee of ANOTHER company can't be named");
  assert.equal((await create(B, { kind: "link", username: un("bina"), bindEmployeeId: "empB2" })).status, 409, "already bound");
  assert.equal((await create(B, { kind: "link", username: un("bina"), bindEmployeeId: "empB3" })).status, 409, "email login");
  assert.equal((await create(manager, { kind: "link", username: un("bina"), bindEmployeeId: "empB1" })).status, 403);
  assert.equal((await create(B, { kind: "link", username: un("bina"), bindEmployeeId: "empB1", apps: ["bizzux-crm"] })).status, 200);
  assert.equal((await db.doc(`customers/${B.uid}/attEmployees/empB1`).get()).data().userId, null, "nothing is bound before the person accepts");
  const [rq] = await myLinks(bina);
  const res = await (await answer(bina, rq.id, true)).json();
  assert.deepEqual(res.binding, { bound: true });
  const e = (await db.doc(`customers/${B.uid}/attEmployees/empB1`).get()).data();
  assert.deepEqual([e.userId, e.loginKind, e.loginUsername, e.history], [mk.uid, "username", un("bina"), "keep"]);
  assert.equal((await db.doc(`customers/${A.uid}/attEmployees/empA1`).get()).data().userId, null, "the other company's record was never touched");
  const { bindEmployeeToIdentity } = await import("../lib/iam/employeeBinding.js");
  assert.deepEqual(await bindEmployeeToIdentity({ organizationId: B.uid, employeeId: "empB1", uid: mk.uid, username: un("bina") }), { bound: true, already: true }, "idempotent");
  assert.equal((await bindEmployeeToIdentity({ organizationId: B.uid, employeeId: "empB1", uid: "other" })).reason, "bound_to_other", "never moves a bound record");
});

test("D: an employee bound after the fact keeps their attendance history (the record is updated in place, not recreated)", async () => {
  await db.doc(`customers/${B.uid}/attEmployees/hist1`).set({ name: "Old Timer", status: "active", userId: null });
  await db.doc(`customers/${B.uid}/attEmployees/hist1/records/2026-01-05`).set({ in: "09:00" });
  const mk = await (await create(adminA, { kind: "username", fullName: "Old Timer", username: un("oldt") })).json();
  const w = await withToken(mk.uid);
  await create(B, { kind: "link", username: un("oldt"), bindEmployeeId: "hist1" });
  await answer(w, (await myLinks(w))[0].id, true);
  assert.equal((await db.doc(`customers/${B.uid}/attEmployees/hist1/records/2026-01-05`).get()).data().in, "09:00");
  assert.equal((await db.doc(`customers/${B.uid}/attEmployees/hist1`).get()).data().userId, mk.uid);
});

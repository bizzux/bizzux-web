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

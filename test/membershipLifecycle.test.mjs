// Remove-from-company never deletes the central identity; Deleted users + restore. Auth + Firestore EMULATORS, real routes.
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
const removedRoute = await import("../app/api/iam/removed/route.js");
const team = await import("../app/api/team/route.js");
const links = await import("../app/api/link-requests/route.js");
const db = fa.adminDb();
const RUN = Math.random().toString(36).slice(2, 7);
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const post = async (p, b) => (await fetch(`${AUTH}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function person(label) {
  const u = await fa.adminAuth().createUser({ email: `${label}-${RUN}@x.test`, emailVerified: true, password: "Passw0rd-" + RUN, displayName: label });
  return withToken(u.uid, label);
}
const withToken = async (uid, label = "") => ({ uid, label, token: (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(uid), returnSecureToken: true })).idToken });
const hdr = (w) => ({ ...(w ? { Authorization: "Bearer " + w.token } : {}), "Content-Type": "application/json" });
const iam = (w, body) => ids.POST(new Request("http://x/api/iam/identities", { method: "POST", headers: hdr(w), body: JSON.stringify(body) }));
const remove = (w, id) => team.POST(new Request("http://x/api/team", { method: "POST", headers: hdr(w), body: JSON.stringify({ action: "remove", id }) }));
const directory = async (w) => (await (await dir.GET(new Request("http://x/api/iam/directory", { headers: hdr(w) }))).json());
const removed = async (w) => removedRoute.GET(new Request("http://x/api/iam/removed", { headers: hdr(w) }));
const un = (s) => `${s}${RUN}`;

let A, B, adm;
before(async () => {
  A = await person("ownerA"); B = await person("ownerB"); adm = await person("admin");
  for (const w of [A, B]) {
    await db.doc("customers/" + w.uid).set({ status: "active", organizationName: "Org " + w.label });
    await db.doc(`organizationMemberships/${w.uid}_${w.uid}`).set({ organizationId: w.uid, userId: w.uid, role: "OWNER", status: "active" });
    await db.doc(`organizationAppSubscriptions/${w.uid}_bizzux-crm`).set({ organizationId: w.uid, appId: "bizzux-crm", status: "ACTIVE" });
  }
  await db.doc("memberships/" + adm.uid).set({ accountId: A.uid, profile: "Admin" });
  await db.doc(`organizationMemberships/${A.uid}_${adm.uid}`).set({ organizationId: A.uid, userId: adm.uid, role: "MEMBER", status: "active" });
  await db.doc(`customers/${A.uid}/team/${adm.uid}`).set({ firstName: "Adm", uid: adm.uid, profile: "Admin", status: "active" });
});

test("removing a person ends THIS company's membership and access, keeps the identity and the audit trail", async () => {
  const u = await (await iam(A, { kind: "username", fullName: "Rita Remove", username: un("rita"), apps: ["bizzux-crm"] })).json();
  assert.equal((await remove(A, u.teamMemberId)).status, 200);
  assert.equal((await fa.adminAuth().getUser(u.uid)).uid, u.uid, "the Firebase identity still exists");
  assert.equal((await db.doc("usernames/" + un("rita")).get()).exists, true, "the username record still exists");
  assert.equal((await db.doc(`customers/${A.uid}/team/${u.teamMemberId}`).get()).exists, false, "gone from the Users records");
  assert.equal((await db.doc(`customers/${A.uid}/teamRemoved/${u.teamMemberId}`).get()).exists, true, "snapshot kept for restore");
  assert.equal((await db.doc(`organizationMemberships/${A.uid}_${u.uid}`).get()).data().status, "removed");
  assert.equal((await db.doc(`appAssignments/${A.uid}_${u.uid}_bizzux-crm`).get()).data().status, "INACTIVE", "app access ended");
  assert.ok(!(await directory(A)).users.some((x) => x.uid === u.uid), "no longer listed as an active user");
  const list = await (await removed(A)).json();
  const row = list.removed.find((r) => r.id === u.teamMemberId);
  assert.ok(row && row.recoverable && row.daysLeft >= 59 && row.username === un("rita"));
  const aud = await db.collection("auditLogs").where("action", "==", "team.remove").get();
  assert.ok(aud.size >= 1, "audit written");
});

test("restore brings the membership back WITHOUT re-granting app access; repeat and cross-tenant are refused", async () => {
  const u = await (await iam(A, { kind: "username", fullName: "Rosa Restore", username: un("rosa"), apps: ["bizzux-crm"] })).json();
  await remove(A, u.teamMemberId);
  assert.equal((await iam(B, { kind: "restore", id: u.teamMemberId })).status, 404, "another company cannot restore it");
  assert.equal((await removed(B).then((r) => r.json())).removed.length, 0, "and cannot see it");
  assert.equal((await iam(A, { kind: "restore", id: u.teamMemberId })).status, 200);
  assert.ok((await directory(A)).users.some((x) => x.uid === u.uid), "listed again");
  assert.equal((await db.doc(`organizationMemberships/${A.uid}_${u.uid}`).get()).data().status, "active");
  assert.equal((await db.doc(`appAssignments/${A.uid}_${u.uid}_bizzux-crm`).get()).data().status, "INACTIVE", "access is NOT restored automatically");
  assert.equal((await db.doc(`customers/${A.uid}/teamRemoved/${u.teamMemberId}`).get()).exists, false);
  assert.equal((await iam(A, { kind: "restore", id: u.teamMemberId })).status, 404, "restore is single use");
  assert.equal((await db.collection("usernames").where("uid", "==", u.uid).get()).size, 1, "still one identity");
});

test("expired recovery window cannot be restored", async () => {
  const u = await (await iam(A, { kind: "username", fullName: "Old Gone", username: un("oldgone") })).json();
  await remove(A, u.teamMemberId);
  await db.doc(`customers/${A.uid}/teamRemoved/${u.teamMemberId}`).set({ restoreUntilMs: Date.now() - 1000 }, { merge: true });
  assert.equal((await iam(A, { kind: "restore", id: u.teamMemberId })).status, 410);
  const row = (await (await removed(A)).json()).removed.find((r) => r.id === u.teamMemberId);
  assert.equal(row.recoverable, false);
});

test("a person in two companies: removal from one leaves the identity and the other company intact", async () => {
  const u = await (await iam(A, { kind: "username", fullName: "Dual Dev", username: un("dual"), apps: ["bizzux-crm"] })).json();
  const dual = await withToken(u.uid);
  await iam(B, { kind: "link", username: un("dual"), apps: ["bizzux-crm"] });
  const req = (await (await links.GET(new Request("http://x/api/link-requests", { headers: hdr(dual) }))).json()).requests[0];
  await links.POST(new Request("http://x/api/link-requests", { method: "POST", headers: hdr(dual), body: JSON.stringify({ id: req.id, accept: true }) }));
  assert.equal((await db.doc(`organizationMemberships/${B.uid}_${u.uid}`).get()).data().status, "active");
  assert.equal((await remove(A, u.teamMemberId)).status, 200);
  assert.equal((await fa.adminAuth().getUser(u.uid)).uid, u.uid);
  assert.equal((await db.doc(`organizationMemberships/${B.uid}_${u.uid}`).get()).data().status, "active", "company B membership untouched");
  assert.equal((await db.doc(`appAssignments/${B.uid}_${u.uid}_bizzux-crm`).get()).data().status, "ACTIVE", "company B access untouched");
  assert.ok((await directory(B)).users.some((x) => x.uid === u.uid));
});

test("rules: not the Owner, not yourself, an Admin cannot remove an Admin, a member cannot remove anyone, another company cannot", async () => {
  const mem = await (await iam(A, { kind: "username", fullName: "Mem", username: un("mem") })).json();
  const memW = await withToken(mem.uid);
  assert.equal((await remove(A, A.uid)).status, 400, "owner");
  assert.equal((await remove(adm, adm.uid)).status, 400, "yourself");
  assert.equal((await remove(memW, adm.uid)).status >= 400, true, "a plain member");
  const other = await (await iam(A, { kind: "username", fullName: "Other Admin", username: un("oadm") })).json();
  await iam(A, { kind: "orgRole", uid: other.uid, role: "ADMIN" });
  assert.equal((await remove(adm, other.teamMemberId)).status, 403, "an Admin cannot remove an Admin");
  assert.equal((await remove(B, mem.teamMemberId)).status, 404, "another company has no such record");
  assert.equal((await remove(A, other.teamMemberId)).status, 200, "the Owner can");
});

test("removed people do not count against the seat limit and can be re-added fresh", async () => {
  const have = (await db.collection(`customers/${B.uid}/team`).count().get()).data().count;
  await db.doc("customers/" + B.uid).set({ allowedUsers: have + 3 }, { merge: true });
  const a = await (await iam(B, { kind: "username", fullName: "Seat A", username: un("seata") })).json();
  assert.equal((await iam(B, { kind: "username", fullName: "Seat B", username: un("seatb") })).status, 200);
  assert.equal((await iam(B, { kind: "username", fullName: "Seat C", username: un("seatc") })).status, 400, "limit reached");
  assert.equal((await remove(B, a.teamMemberId)).status, 200);
  assert.equal((await iam(B, { kind: "username", fullName: "Seat C", username: un("seatc") })).status, 200, "a freed seat is usable");
});

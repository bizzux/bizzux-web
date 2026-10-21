// Layered authorization on the Auth + Firestore EMULATORS through the real routes: organization role vs application role vs licence.
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
const me = await import("../app/api/me/route.js");
const team = await import("../app/api/team/route.js");
const access = await import("../lib/appAccess.js");
const orgM = await import("../lib/organizationMembership.js");
const db = fa.adminDb();
const RUN = Math.random().toString(36).slice(2, 7);
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const post = async (p, b) => (await fetch(`${AUTH}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function person(label) {
  const u = await fa.adminAuth().createUser({ email: `${label}-${RUN}@x.test`, emailVerified: true, password: "Passw0rd-" + RUN, displayName: label });
  return { uid: u.uid, token: (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(u.uid), returnSecureToken: true })).idToken };
}
const hdr = (w) => ({ ...(w ? { Authorization: "Bearer " + w.token } : {}), "Content-Type": "application/json" });
const iam = (w, body) => ids.POST(new Request("http://x/api/iam/identities", { method: "POST", headers: hdr(w), body: JSON.stringify(body) }));
const directory = (w, q = "") => dir.GET(new Request("http://x/api/iam/directory" + q, { headers: hdr(w) }));
const whoami = async (w) => (await me.GET(new Request("http://x/api/me", { headers: hdr(w) }))).json();
const un = (s) => `${s}${RUN}`;

let A, B, admLegacy, mgr, mem, viewer, contractor, susp, adm2;
const member = async (w, org, profile, canonical = {}) => {
  await db.doc("memberships/" + w.uid).set({ accountId: org, profile });
  await db.doc(`organizationMemberships/${org}_${w.uid}`).set({ organizationId: org, userId: w.uid, role: "MEMBER", status: "active", ...canonical });
  await db.doc(`customers/${org}/team/${w.uid}`).set({ firstName: w.label, email: w.label, uid: w.uid, profile, status: "active" });
};
before(async () => {
  A = await person("ownerA"); B = await person("ownerB");
  for (const [w, org] of [[A, A.uid], [B, B.uid]]) {
    await db.doc("customers/" + org).set({ status: "active", organizationName: "Org " + org.slice(0, 4) });
    await db.doc(`organizationMemberships/${org}_${org}`).set({ organizationId: org, userId: org, role: "OWNER", status: "active" });
    await db.doc(`organizationAppSubscriptions/${org}_bizzux-crm`).set({ organizationId: org, appId: "bizzux-crm", status: "ACTIVE" });
  }
  const mk = async (l) => { const w = await person(l); w.label = l; return w; };
  admLegacy = await mk("admLegacy"); mgr = await mk("mgr"); mem = await mk("mem"); viewer = await mk("viewer"); contractor = await mk("contractor"); susp = await mk("susp"); adm2 = await mk("adm2");
  await member(admLegacy, A.uid, "Admin"); await member(mgr, A.uid, "Manager"); await member(mem, A.uid, "Staff/Shopkeeper");
  await member(viewer, A.uid, "Viewer/Auditor"); await member(contractor, A.uid, "Staff/Shopkeeper");
  await db.doc(`customers/${A.uid}/team/${contractor.uid}`).set({ employmentType: "Contractor" }, { merge: true });
  await member(susp, A.uid, "Admin", { status: "suspended" }); await member(adm2, A.uid, "Staff/Shopkeeper");
});

test("organization administration by persona (API enforcement): Owner, legacy Admin allowed; Manager, Member, Viewer, Contractor, suspended refused", async () => {
  const probe = async (w) => (await directory(w)).status;
  assert.equal(await probe(A), 200, "owner");
  assert.equal(await probe(admLegacy), 200, "legacy Admin profile keeps working");
  for (const [n, w] of [["manager", mgr], ["member", mem], ["viewer", viewer], ["contractor", contractor], ["suspended admin", susp]]) assert.equal(await probe(w), 403, n);
  assert.equal((await iam(mem, { kind: "username", fullName: "X", username: un("x1") })).status, 403);
  const m = await whoami(mem); assert.deepEqual([m.isAccountAdmin, m.orgRoleEffective, m.orgRoleSource], [false, "MEMBER", "legacy-profile"]);
  const a = await whoami(admLegacy); assert.deepEqual([a.isAccountAdmin, a.orgRoleEffective], [true, "ADMIN"]);
});

test("SCENARIO F: Owner promotes MEMBER to ADMIN -> organization administration changes, application access and profile do NOT", async () => {
  const before = { profile: (await db.doc("memberships/" + mem.uid).get()).data().profile, assigns: (await db.collection("appAssignments").where("userId", "==", mem.uid).get()).size };
  assert.equal((await directory(mem)).status, 403, "before: no organization admin");
  assert.equal((await iam(A, { kind: "orgRole", uid: mem.uid, role: "ADMIN" })).status, 200);
  assert.equal((await directory(mem)).status, 200, "after: organization admin (same token, next request)");
  assert.equal((await iam(mem, { kind: "username", fullName: "By Promoted", username: un("bypromoted") })).status, 200, "can now create users");
  const m = await whoami(mem); assert.deepEqual([m.isAccountAdmin, m.orgRoleEffective, m.orgRoleSource], [true, "ADMIN", "explicit"]);
  const after = { profile: (await db.doc("memberships/" + mem.uid).get()).data().profile, assigns: (await db.collection("appAssignments").where("userId", "==", mem.uid).get()).size };
  assert.deepEqual(after, before, "business profile and app assignments untouched");
  assert.equal(await access.canAccessApp({ organizationId: A.uid, userId: mem.uid, appId: "bizzux-crm" }), false, "an organization admin still has NO application access by default");
  const row = (await (await directory(A)).json()).users.find((u) => u.uid === mem.uid);
  assert.deepEqual([row.orgRoleEffective, row.orgRoleSource, row.profile], ["ADMIN", "explicit", "Staff/Shopkeeper"]);
  assert.equal(row.effective.find((e) => e.appId === "bizzux-crm").access, false);
  // an independent APPLICATION role change does not alter the organization role
  assert.equal((await iam(mem, { kind: "apps", uid: mem.uid, apps: ["bizzux-crm"] })).status, 200);
  await db.doc(`appAssignments/${A.uid}_${mem.uid}_bizzux-crm`).set({ role: "ADMIN" }, { merge: true });
  const row2 = (await (await directory(A)).json()).users.find((u) => u.uid === mem.uid);
  assert.deepEqual([row2.orgRoleEffective, row2.effective.find((e) => e.appId === "bizzux-crm").appRole, row2.effective.find((e) => e.appId === "bizzux-crm").source], ["ADMIN", "ADMIN", "assignment"]);
  await db.doc(`appAssignments/${A.uid}_${mem.uid}_bizzux-crm`).set({ role: "MEMBER" }, { merge: true });
  assert.equal((await iam(A, { kind: "orgRole", uid: mem.uid, role: "MEMBER" })).status, 200);
  const row3 = (await (await directory(A)).json()).users.find((u) => u.uid === mem.uid);
  assert.deepEqual([row3.orgRoleEffective, row3.effective.find((e) => e.appId === "bizzux-crm").appRole], ["MEMBER", "MEMBER"], "demoting the organization role leaves the app role alone");
  assert.equal((await directory(mem)).status, 403, "demotion is immediate for an already-signed-in session");
});

test("privilege escalation is refused: Admin can't mint or demote Admins, nobody changes self or the Owner, Member can't change roles", async () => {
  await iam(A, { kind: "orgRole", uid: adm2.uid, role: "ADMIN" });
  assert.equal((await iam(adm2, { kind: "orgRole", uid: viewer.uid, role: "ADMIN" })).status, 403, "Admin cannot create an Admin");
  assert.equal((await iam(adm2, { kind: "orgRole", uid: admLegacy.uid, role: "MEMBER" })).status, 403, "Admin cannot demote an Admin (legacy)");
  assert.equal((await iam(adm2, { kind: "orgRole", uid: adm2.uid, role: "VIEWER" })).status, 403, "no self change");
  assert.equal((await iam(adm2, { kind: "orgRole", uid: A.uid, role: "MEMBER" })).status, 403, "Owner's role is fixed");
  assert.equal((await iam(adm2, { kind: "orgRole", uid: viewer.uid, role: "OWNER" })).status, 400);
  assert.equal((await iam(adm2, { kind: "orgRole", uid: viewer.uid, role: "MEMBER" })).status, 200, "Admin may move people between Member and Viewer");
  assert.equal((await iam(mgr, { kind: "orgRole", uid: viewer.uid, role: "MEMBER" })).status, 403);
  assert.equal((await iam(A, { kind: "orgRole", uid: A.uid, role: "MEMBER" })).status, 403);
  // legacy-profile Admin demoted by the Owner: the explicit demotion wins immediately
  assert.equal((await directory(admLegacy)).status, 200);
  assert.equal((await iam(A, { kind: "orgRole", uid: admLegacy.uid, role: "MEMBER" })).status, 200);
  assert.equal((await directory(admLegacy)).status, 403, "stale session cannot keep organization admin");
});

test("tenant isolation of roles: another company's Admin/Owner can't read or change this company's people or roles", async () => {
  assert.equal((await directory(B, "?organizationId=" + A.uid)).status, 403);
  assert.equal((await iam(B, { kind: "orgRole", uid: viewer.uid, role: "MEMBER" })).status, 404, "not a member of B");
  assert.equal((await iam(B, { kind: "orgRole", uid: viewer.uid, role: "MEMBER", organizationId: A.uid })).status, 403, "naming another company is refused");
  assert.equal((await iam(adm2, { kind: "orgRole", uid: B.uid, role: "ADMIN" })).status, 404, "company A's admin has no authority over company B's owner");
  // an administrator of A who is only a MEMBER in B has no authority in B
  const multi = await person("multi"); multi.label = "multi";
  await member(multi, A.uid, "Admin"); await db.doc(`organizationMemberships/${B.uid}_${multi.uid}`).set({ organizationId: B.uid, userId: multi.uid, role: "MEMBER", status: "active" });
  assert.equal((await directory(multi, "?organizationId=" + B.uid)).status, 403);
  assert.equal((await directory(multi)).status, 200);
});

test("a later profile sync never overwrites an explicitly set role; suspended explicit admins lose authority", async () => {
  await iam(A, { kind: "orgRole", uid: contractor.uid, role: "ADMIN" });
  await orgM.upsertOrganizationMembership({ organizationId: A.uid, userId: contractor.uid, role: "MEMBER", status: "active" });
  assert.equal((await db.doc(`organizationMemberships/${A.uid}_${contractor.uid}`).get()).data().role, "ADMIN");
  assert.equal((await directory(contractor)).status, 200, "relationship (Contractor) never limits an organization role the Owner set");
  await db.doc(`organizationMemberships/${A.uid}_${contractor.uid}`).set({ status: "suspended" }, { merge: true });
  assert.equal((await directory(contractor)).status, 403, "suspension removes organization authority at once");
});

test("changing an organization role never grants application access or licence", async () => {
  const w = await person("plain"); w.label = "plain"; await member(w, A.uid, "Staff/Shopkeeper");
  await iam(A, { kind: "orgRole", uid: w.uid, role: "ADMIN" });
  assert.equal((await db.collection("appAssignments").where("userId", "==", w.uid).get()).size, 0);
  assert.equal((await db.collection("organizationAppSubscriptions").where("organizationId", "==", A.uid).get()).size, 1, "licences untouched");
  const t = await team.POST(new Request("http://x/api/team", { method: "POST", headers: hdr(w), body: JSON.stringify({ action: "setOrgRole", id: viewer.uid, role: "MEMBER" }) }));
  assert.equal(t.status, 200, "the legacy Users-table dropdown goes through the same central rules");
  const t2 = await team.POST(new Request("http://x/api/team", { method: "POST", headers: hdr(w), body: JSON.stringify({ action: "setOrgRole", id: mgr.uid, role: "ADMIN" }) }));
  assert.equal(t2.status, 403, "...including the Admin-can't-mint-Admin rule");
});

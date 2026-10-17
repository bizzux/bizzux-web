// Regression tests for Super Admin -> Organizations provisioning.
// Run against the Firebase emulators (never real credentials):
//   npm run test:orgs
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account", project_id: "demo-bizzux", private_key: privateKey,
  client_email: "test@demo-bizzux.iam.gserviceaccount.com",
});
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run via firebase emulators:exec");

const lib = await import("../lib/orgProvisioning.js");
const fa = await import("../lib/firebaseAdmin.js");
const { createOrganization } = await import("../lib/organization.js");
const db = fa.adminDb();
const owner = { uid: "owner-1", email: "owner@bizzux.test", platformRole: "OWNER" };
const admin = { uid: "padmin-1", email: "padmin@bizzux.test", platformRole: "ADMIN" };
const sent = [];
const deps = { sendInvite: async (x) => { sent.push(x); } };
let n = 0;
const rnd = () => Math.random().toString(36).slice(2, 8);
const rid = () => "req-test-" + Date.now() + "-" + ++n;
const base = (o = {}) => ({
  setupMode: "ORG_ADMIN", requestId: rid(), organizationName: "Acme " + n + " " + rnd(),
  industry: "Retail", countryCode: "IN", state: "Kerala", timezone: "Asia/Kolkata", currency: "INR",
  planType: "PAID", expiryDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), licensedSeats: 5,
  apps: ["bizzux-notes", "bizzux-crm"],
  admin: { fullName: "Asha Admin", loginMethod: "USERNAME_TEMP", username: "asha" + rnd() },
  ...o,
});
const orgCount = async () => (await db.collection("organizations").count().get()).data().count;
const prov = (body, actor = owner) => lib.provisionOrganization({ actor, body, origin: "http://localhost" }, deps);

before(async () => {
  await db.doc("platformAdmins/" + admin.uid).set({ email: admin.email, role: "ADMIN", status: "active", permissions: null });
});

test("admin-assisted: org + admin + users uses the shared data model, explicit plan/apps, no stored password", async () => {
  const body = base({
    setupMode: "ORG_ADMIN_USERS",
    users: [{ fullName: "Sam Staff", loginMethod: "USERNAME_TEMP", username: "sam" + rnd(), profile: "Staff/Shopkeeper", apps: ["bizzux-notes", "bizzux-pos"] }],
  });
  const r = await prov(body);
  assert.equal(r.credentials.length, 2);
  const org = (await db.doc("organizations/" + r.organizationId).get()).data();
  assert.equal(org.type, "CUSTOMER"); assert.equal(org.planType, "PAID"); assert.equal(org.allowedUsers, 5);
  const cust = (await db.doc("customers/" + r.organizationId).get()).data();
  assert.equal(cust.mustChangePassword, true); assert.equal(cust.createdByAdmin, true); assert.equal(cust.planType, "PAID");
  const subs = await db.collection("organizationAppSubscriptions").where("organizationId", "==", r.organizationId).get();
  const active = subs.docs.map((d) => d.data()).filter((s) => s.status === "ACTIVE").map((s) => s.appId).sort();
  assert.deepEqual(active, ["bizzux-crm", "bizzux-notes"]);
  const assigns = await db.collection("appAssignments").where("organizationId", "==", r.organizationId).get();
  assert.ok(!assigns.docs.some((d) => d.data().appId === "bizzux-pos"), "user can't be given an app the org lacks");
  const members = await db.collection("organizationMemberships").where("organizationId", "==", r.organizationId).get();
  assert.equal(members.size, 2);
  const dump = JSON.stringify([
    ...(await db.collection("usernames").get()).docs.map((d) => d.data()),
    ...(await db.collection("provisioningRequests").get()).docs.map((d) => d.data()),
    ...(await db.collection("auditLogs").get()).docs.map((d) => d.data()),
    cust, org,
  ]);
  for (const c of r.credentials) assert.ok(!dump.includes(c.temporaryPassword), "plaintext password persisted");
  const actions = (await db.collection("auditLogs").where("targetId", "==", r.organizationId).get()).docs.map((d) => d.data().action);
  for (const a of ["organization.provision", "organization.admin_assigned", "organization.entitlements_set"]) assert.ok(actions.includes(a), a);
});

test("retry with the same requestId never duplicates the tenant", async () => {
  const body = base();
  const before = await orgCount();
  const a = await prov(body);
  const b = await prov(body);
  assert.equal(b.replay, true); assert.equal(b.organizationId, a.organizationId); assert.deepEqual(b.credentials, []);
  assert.equal(await orgCount(), before + 1);
});

test("same organization name under a different request is rejected", async () => {
  const body = base();
  await prov(body);
  await assert.rejects(prov({ ...body, requestId: rid(), admin: { ...body.admin, username: "other" + rnd() } }), (e) => e.status === 409);
});

test("failure rolls back everything (no orphan org or Auth user)", async () => {
  const taken = "taken" + rnd();
  await prov(base({ admin: { fullName: "X", loginMethod: "USERNAME_TEMP", username: taken } }));
  const body = base({
    setupMode: "ORG_ADMIN_USERS",
    users: [{ fullName: "Dup", loginMethod: "USERNAME_TEMP", username: taken, profile: "Manager", apps: [] }],
  });
  const before = await orgCount();
  await assert.rejects(prov(body), (e) => e.status === 409);
  assert.equal(await orgCount(), before);
  assert.equal((await db.collection("customers").where("organizationName", "==", body.organizationName).get()).size, 0);
  // the name is released so a corrected retry works
  await prov({ ...body, requestId: rid(), users: [{ ...body.users[0], username: "fresh" + rnd() }] });
});

test("email invitation: no password exists, invite is sent, existing email is refused", async () => {
  const email = "boss" + rnd() + "@example.test";
  const r = await prov(base({ admin: { fullName: "Boss", loginMethod: "EMAIL_INVITE", email } }));
  assert.equal(r.credentials.length, 0);
  assert.equal(sent.at(-1).email, email);
  const user = await fa.adminAuth().getUserByEmail(email);
  assert.ok(!user.passwordHash);
  assert.equal((await db.doc("customers/" + r.organizationId).get()).data().mustChangePassword, false);
  const before = await orgCount();
  await assert.rejects(prov(base({ admin: { fullName: "Dup", loginMethod: "EMAIL_INVITE", email } })), (e) => e.status === 409);
  assert.equal(await orgCount(), before);
});

test("organization only: no customer/login created, plan not inherited from caller", async () => {
  const r = await prov(base({ setupMode: "ORG_ONLY", admin: undefined, planType: "TRIAL" }));
  assert.equal((await db.doc("customers/" + r.organizationId).get()).exists, false);
  const org = (await db.doc("organizations/" + r.organizationId).get()).data();
  assert.equal(org.status, "pending_admin"); assert.equal(org.planType, "TRIAL");
});

test("platform admin vs owner permissions", async () => {
  const r = await prov(base({ setupMode: "ORG_ONLY", admin: undefined }));
  await lib.changeOrganizationStatus({ actor: admin, organizationId: r.organizationId, action: "archive" });
  await assert.rejects(lib.deleteOrganizationPermanently({ actor: admin, organizationId: r.organizationId, confirmName: "x" }), (e) => e.status === 403);
  await db.doc("platformAdmins/" + admin.uid).set({ permissions: [] }, { merge: true });
  await assert.rejects(prov(base(), admin), (e) => e.status === 403);
  await db.doc("platformAdmins/" + admin.uid).set({ permissions: null }, { merge: true });
  const name = (await db.doc("organizations/" + r.organizationId).get()).data().organizationName;
  await assert.rejects(lib.deleteOrganizationPermanently({ actor: owner, organizationId: r.organizationId, confirmName: "wrong" }), (e) => e.status === 400);
  await lib.deleteOrganizationPermanently({ actor: owner, organizationId: r.organizationId, confirmName: name });
  assert.equal((await db.doc("organizations/" + r.organizationId).get()).exists, false);
});

test("listing normalizes real/self-service/placeholder orgs; self-service stays protected", async () => {
  // self-service shape: real org uses `name`, customer doc owned by a signed-up user
  await createOrganization({ id: "selfsvc-1", name: "Self Serve Co", type: "CUSTOMER", createdBy: "selfsvc-1" });
  await db.doc("customers/selfsvc-1").set({ organizationName: "Self Serve Co", email: "me@self.test", status: "trial", userRange: "11-20", createdAt: new Date() });
  await db.doc("organizationMemberships/selfsvc-1_selfsvc-1").set({ organizationId: "selfsvc-1", userId: "selfsvc-1", role: "OWNER", status: "active" });
  await db.doc("organizations/placeholder-1").set({ organizationName: "Old Placeholder", userRange: "1-10", planName: "Trial", status: "pending", createdBy: "x@y.z", createdAt: new Date() });
  const rows = await lib.listOrganizations({});
  const self = rows.find((x) => x.id === "selfsvc-1");
  assert.equal(self.name, "Self Serve Co"); assert.equal(self.kind, "self-service"); assert.equal(self.activeUsers, 1); assert.equal(self.estimatedUsers, "11-20");
  assert.equal(rows.find((x) => x.id === "placeholder-1").name, "Old Placeholder");
  assert.ok(rows.every((x) => x.name && x.name !== "(unnamed)"));
  await assert.rejects(lib.updateOrganizationEntitlements({ actor: owner, organizationId: "selfsvc-1", body: { apps: ["bizzux-notes"] } }), (e) => e.status === 400);
  await assert.rejects(lib.deleteOrganizationPermanently({ actor: owner, organizationId: "selfsvc-1", confirmName: "Self Serve Co" }), (e) => e.status === 400);
  const s = await lib.changeOrganizationStatus({ actor: owner, organizationId: "selfsvc-1", action: "suspend" });
  assert.equal(s.status, "suspended");
  assert.equal((await db.doc("customers/selfsvc-1").get()).data().status, "suspended");
  await lib.changeOrganizationStatus({ actor: owner, organizationId: "selfsvc-1", action: "reactivate" });
  assert.equal((await db.doc("customers/selfsvc-1").get()).data().status, "trial");
});

test("entitlement change deactivates removed apps for users and is audited", async () => {
  const r = await prov(base({ setupMode: "ORG_ADMIN" }));
  await lib.updateOrganizationEntitlements({ actor: owner, organizationId: r.organizationId, body: { apps: ["bizzux-notes"], licensedSeats: 9 } });
  const crm = (await db.doc("appAssignments/" + r.organizationId + "_" + r.organizationId + "_bizzux-crm").get()).data();
  assert.equal(crm.status, "INACTIVE");
  assert.equal((await db.doc("customers/" + r.organizationId).get()).data().allowedUsers, 9);
  const logs = await db.collection("auditLogs").where("targetId", "==", r.organizationId).get();
  assert.ok(logs.docs.filter((d) => d.data().action === "organization.entitlements_set").length >= 2);
});

// Tests for the requester / business owner / primary admin model: onboarding
// scenarios, role separation, legacy compatibility, migration and authorization.
// Run against the emulators only:  npm run test:orgs
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
const adminLib = await import("../lib/orgContactsAdmin.js");
const mig = await import("../lib/orgContactsMigration.js");
const model = await import("../lib/orgContacts.js");
const fa = await import("../lib/firebaseAdmin.js");
const { createOrganization } = await import("../lib/organization.js");
const { upsertOrganizationMembership } = await import("../lib/organizationMembership.js");
const db = fa.adminDb();
const auth = fa.adminAuth();

const owner = { uid: "co-owner-1", email: "owner@bizzux.test", platformRole: "OWNER" };
const padmin = { uid: "co-padmin-1", email: "padmin@bizzux.test", platformRole: "ADMIN" };
const customerActor = { uid: "co-customer-1", email: "cust@acme.test" }; // no platform role
const deps = { sendInvite: async () => {} };
let n = 0;
const rnd = () => Math.random().toString(36).slice(2, 8);
const rid = () => "req-co-" + Date.now() + "-" + ++n;
const soon = () => new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const base = (o = {}) => ({
  setupMode: "ORG_ADMIN", requestId: rid(), organizationName: "Contacts Co " + n + " " + rnd(),
  industry: "Marine & Engineering", countryCode: "IN", state: "Tamil Nadu", timezone: "Asia/Kolkata", currency: "INR",
  planType: "TRIAL", expiryDate: soon(), licensedSeats: 30, apps: ["bizzux-attendance"],
  requester: { name: "Singaravelan", jobTitle: "Site Manager", phone: "+919800000001", type: "manager" },
  admin: { fullName: "Asha Admin", loginMethod: "USERNAME_TEMP", username: "asha" + rnd() },
  ...o,
});
const prov = (body, actor = owner) => lib.provisionOrganization({ actor, body, origin: "http://localhost" }, deps);
const getOrg = async (id) => (await db.doc("organizations/" + id).get()).data();
const authCount = async () => (await auth.listUsers(1000)).users.length;

before(async () => {
  await db.doc("platformAdmins/" + padmin.uid).set({ email: padmin.email, role: "ADMIN", status: "active", permissions: null });
});

test("manager requests an organization: Business Owner is optional and never invented", async () => {
  const r = await prov(base());
  const org = await getOrg(r.organizationId);
  assert.equal(org.requester.type, "manager");
  assert.equal(org.requester.name, "Singaravelan");
  assert.equal(org.businessOwner, null);
  assert.equal(org.businessOwnerStatus, "not_provided");
  assert.notEqual(org.adminName, org.requester.name);        // requester is not auto-promoted
  assert.equal(org.authorizationStatus, "pending");           // a manager is not proof of authority
  assert.equal(org.contactsVersion, 2);
});

test("requester and administrator are separate identities when they differ", async () => {
  const r = await prov(base({ requesterIsAdmin: false }));
  const org = await getOrg(r.organizationId);
  assert.equal(org.requesterIsPrimaryAdmin, false);
  assert.equal(org.primaryAdmin.displayName, "Asha Admin");
  assert.equal(org.requester.name, "Singaravelan");
});

test("owner creates organization and is also the Primary Admin, with ONE sign-in account", async () => {
  const before = await authCount();
  const r = await prov(base({
    requester: { name: "Surya", email: "surya@surya.test", type: "owner" }, requesterIsAdmin: true,
    admin: { loginMethod: "EMAIL_INVITE", email: "surya@surya.test" },
    ownerKnown: true, businessOwner: { name: "Surya", email: "surya@surya.test" },
  }));
  assert.equal((await authCount()) - before, 1, "no duplicate authentication accounts");
  const org = await getOrg(r.organizationId);
  assert.equal(org.requesterIsPrimaryAdmin, true);
  assert.equal(org.primaryAdmin.displayName, "Surya");
  assert.equal(org.businessOwner.name, "Surya");
  assert.equal(org.businessOwner.status, "declared");        // self-declared until verified
  assert.equal(org.authorizationStatus, "not_required");     // owner starting a trial
  assert.equal(org.primaryAdmin.status, "pending_activation");
});

test("owner contact is stored without creating a login", async () => {
  const before = await authCount();
  const r = await prov(base({ ownerKnown: true, businessOwner: { name: "Mr Owner", email: "boss@firm.test", phone: "+919800000009" } }));
  assert.equal((await authCount()) - before, 1, "only the administrator gets an account");
  const org = await getOrg(r.organizationId);
  assert.equal(org.businessOwner.userId, null);
  assert.equal(org.businessOwner.name, "Mr Owner");
});

test("an unknown owner is not copied from the administrator or the requester", async () => {
  const r = await prov(base({ ownerKnown: false }));
  const org = await getOrg(r.organizationId);
  assert.equal(org.businessOwner, null);
  const r2 = await prov(base({ ownerKnown: false, requester: { name: "Emp", email: "e@x.test", type: "manager" }, requesterIsAdmin: true, admin: { loginMethod: "EMAIL_INVITE", email: "e@x.test" } }));
  assert.equal((await getOrg(r2.organizationId)).businessOwner, null);
});

test("employee / other requester gets a restricted, pending organization", async () => {
  const emp = { name: "Consultant", email: "c@x.test", type: "employee_other" };
  await assert.rejects(prov(base({ requester: emp, planType: "PAID" })), (e) => e.status === 400);
  await assert.rejects(prov(base({ requester: emp, licensedSeats: 50 })), (e) => e.status === 400);
  const r = await prov(base({ requester: emp, licensedSeats: 3 }));
  const org = await getOrg(r.organizationId);
  assert.equal(org.restrictedAccess, true);
  assert.equal(org.authorizationStatus, "pending");
});

test("createdBy is the real session actor and cannot be spoofed from the request", async () => {
  const r = await prov(base({ createdBy: { actorUserId: "someone-else", actorType: "customer" }, provisionedBy: "someone-else" }), padmin);
  const org = await getOrg(r.organizationId);
  assert.deepEqual(org.createdBy, { actorUserId: padmin.uid, actorType: "platform_admin", actorEmail: padmin.email });
  assert.equal(org.provisionedBy, padmin.uid);
  assert.notEqual(org.primaryAdmin.userId, padmin.uid, "the Bizzux employee is not the customer's admin");
});

test("requester details are validated", async () => {
  await assert.rejects(prov(base({ requester: undefined })), (e) => e.status === 400);
  await assert.rejects(prov(base({ requester: { name: "No Contact", type: "manager" } })), (e) => /email|phone/i.test(e.message));
  await assert.rejects(prov(base({ requester: { name: "", email: "a@b.test", type: "manager" } })), (e) => e.status === 400);
  await assert.rejects(prov(base({ requester: { name: "X", email: "a@b.test", type: "king" } })), (e) => e.status === 400);
  await assert.rejects(prov(base({ setupMode: "ORG_ONLY", admin: undefined, requesterIsAdmin: true })), (e) => e.status === 400);
});

test("a duplicate creation request does not create a second organization", async () => {
  const body = base();
  const a = await prov(body);
  const b = await prov(body);
  assert.equal(b.replay, true);
  assert.equal(a.organizationId, b.organizationId);
});

test("pending administrator is never counted as an active user", async () => {
  const r = await prov(base({ admin: { fullName: "Pending Pat", loginMethod: "EMAIL_INVITE", email: "pat" + rnd() + "@x.test" } }));
  const v = await adminLib.getOwnershipOverview(r.organizationId);
  assert.equal(v.ownership.primaryAdmin.status, "pending_activation");
  assert.equal(v.metrics.activeUsers, 0);
  assert.equal(v.metrics.acceptedUsers, 0);
  assert.equal(v.metrics.provisionedSeats, 1);
  assert.equal(v.metrics.licensedSeats, 30);
  assert.equal(v.ownership.onboardingStatus, "pending_activation");
});

test("seat metrics: active needs a recent sign-in", () => {
  const now = Date.parse("2026-10-17T00:00:00Z");
  const m = model.seatMetrics({ now, licensedSeats: 10, members: [
    { uid: "a", lastLoginAt: "2026-10-10T00:00:00Z" },
    { uid: "b", lastLoginAt: "2026-06-01T00:00:00Z" },
    { uid: "c", lastLoginAt: null },
    { uid: "d", lastLoginAt: "2026-10-12T00:00:00Z", disabled: true },
  ] });
  assert.deepEqual([m.provisionedSeats, m.acceptedUsers, m.activeUsers], [4, 2, 1]);
});

// --- legacy compatibility and migration ---------------------------------------
async function makeLegacy({ withMember = true, adminName = "Singaravelan" } = {}) {
  const u = await auth.createUser({ email: "legacy" + rnd() + "@old.test", displayName: adminName });
  const id = u.uid;
  await createOrganization({ id, name: "Legacy " + rnd(), type: "CUSTOMER", createdBy: id });
  await db.doc("organizations/" + id).set({ adminUid: withMember ? id : "ghost-uid", adminName, apps: ["bizzux-notes"], allowedUsers: 7, planType: "PAID", provisionedVia: "platform-admin", provisionedBy: "old-staff" }, { merge: true });
  await db.doc("customers/" + id).set({ organizationName: "x", owner: { name: adminName }, createdByAdmin: true, status: "trial" });
  if (withMember) await upsertOrganizationMembership({ organizationId: id, userId: id, role: "OWNER", status: "active" });
  return id;
}

test("a legacy organization opens without crashing and shows no invented owner", async () => {
  const id = await makeLegacy();
  const v = await adminLib.getOwnershipOverview(id);
  assert.equal(v.ownership.businessOwner, null);
  assert.equal(v.ownership.businessOwnerStatus, "not_provided");
  assert.equal(v.ownership.legacyOwnerAdministrator, "Singaravelan");
  assert.equal(v.ownership.primaryAdmin.userId, id);
  assert.equal(v.ownership.onboardingMethod, "bizzux_managed");
  assert.equal(v.ownership.createdBy.actorUserId, "old-staff");
});

test("migration: dry run writes nothing; apply preserves legacy data and permissions; rerun is a no-op", async () => {
  const id = await makeLegacy();
  const memBefore = (await db.doc("organizations/" + id).get()).data();
  const roleBefore = (await db.doc("organizationMemberships/" + id + "_" + id).get()).data().role;

  const dry = await mig.migrateOrganization(id, { apply: false });
  assert.equal(dry.outcome, "migrated");
  assert.equal((await getOrg(id)).contactsVersion, undefined, "dry run must not write");

  const r1 = await mig.migrateOrganization(id, { apply: true });
  assert.equal(r1.outcome, "migrated");
  const org = await getOrg(id);
  assert.equal(org.contactsVersion, 2);
  assert.equal(org.businessOwner, null);                      // never inferred from the admin
  assert.equal(org.legacyOwnerAdministrator, "Singaravelan"); // legacy text preserved
  assert.equal(org.adminName, memBefore.adminName);
  assert.equal(org.allowedUsers, 7);
  assert.deepEqual(org.apps, ["bizzux-notes"]);
  assert.equal(org.primaryAdmin.userId, id);
  assert.equal(org.authorizationStatus, "not_required");
  assert.equal((await db.doc("organizationMemberships/" + id + "_" + id).get()).data().role, roleBefore, "no privilege change");

  const usersBefore = await authCount();
  const r2 = await mig.migrateOrganization(id, { apply: true });
  assert.equal(r2.outcome, "skipped");
  assert.equal(await authCount(), usersBefore, "no duplicate users");
});

test("migration flags organizations whose administrator cannot be mapped for manual review", async () => {
  const id = await makeLegacy({ withMember: false });
  const r = await mig.migrateOrganization(id, { apply: true });
  assert.equal(r.outcome, "review");
  const org = await getOrg(id);
  assert.equal(org.primaryAdmin, null);
  assert.equal(org.migration.needsAdminReview, true);
  assert.equal(org.businessOwner, null);
});

test("migrateAll reports inspected / migrated / review / failed and is rerunnable", async () => {
  const rep = await mig.migrateAll({ apply: true, limit: 1000 });
  assert.ok(rep.inspected >= 1);
  assert.equal(rep.failed, 0);
  const again = await mig.migrateAll({ apply: true, limit: 1000 });
  assert.equal(again.migrated, 0, "second run changes nothing");
});

// --- authorization ------------------------------------------------------------
test("verification and ownership transfer are Platform Owner only", async () => {
  const r = await prov(base({ ownerKnown: true, businessOwner: { name: "Real Owner", email: "ro@x.test" } }));
  const id = r.organizationId;
  const args = { organizationId: id, reason: "documents checked" };
  await assert.rejects(adminLib.setAuthorizationStatus({ actor: padmin, ...args, status: "verified" }), (e) => e.status === 403);
  await assert.rejects(adminLib.verifyBusinessOwner({ actor: padmin, ...args }), (e) => e.status === 403);
  await assert.rejects(adminLib.transferBusinessOwner({ actor: padmin, ...args, newOwner: { name: "Thief", email: "t@x.test" } }), (e) => e.status === 403);
  await assert.rejects(adminLib.setAuthorizationStatus({ actor: customerActor, ...args, status: "verified" }), (e) => e.status === 403);
  // Even the Owner cannot transfer until authority is verified.
  await assert.rejects(adminLib.transferBusinessOwner({ actor: owner, ...args, newOwner: { name: "New", email: "n@x.test" } }), (e) => e.status === 400);
  await adminLib.setAuthorizationStatus({ actor: owner, ...args, status: "verified" });
  await adminLib.verifyBusinessOwner({ actor: owner, ...args });
  assert.equal((await getOrg(id)).businessOwner.status, "verified");
  // A verified owner can't be swapped through the ordinary contact edit.
  await assert.rejects(adminLib.updateBusinessOwner({ actor: padmin, ...args, owner: { name: "Other", email: "o@x.test" } }), (e) => e.status === 403);
  await adminLib.transferBusinessOwner({ actor: owner, ...args, newOwner: { name: "New Owner", email: "new@x.test" } });
  assert.equal((await getOrg(id)).businessOwner.name, "New Owner");
  const audit = await db.collection("auditLogs").where("targetId", "==", id).get();
  const actions = audit.docs.map((d) => d.data().action);
  for (const a of ["organization.authorization_changed", "organization.business_owner_verified", "organization.ownership_transferred", "organization.provision"]) {
    assert.ok(actions.includes(a), "audited: " + a);
  }
});

test("a declared owner contact can be edited by an authorized admin, with a reason, and is audited", async () => {
  const r = await prov(base());
  const id = r.organizationId;
  await assert.rejects(adminLib.updateBusinessOwner({ actor: padmin, organizationId: id, owner: { name: "Boss", email: "boss@x.test" }, reason: "" }), (e) => e.status === 400);
  await adminLib.updateBusinessOwner({ actor: padmin, organizationId: id, owner: { name: "Boss", email: "boss@x.test" }, reason: "owner called in" });
  const org = await getOrg(id);
  assert.equal(org.businessOwner.status, "declared");
  assert.equal(org.updatedBy, padmin.uid);
  await assert.rejects(adminLib.updateBusinessOwner({ actor: customerActor, organizationId: id, owner: { name: "Mallory", email: "m@x.test" }, reason: "me" }), (e) => e.status === 403);
});

test("primary admin reassignment: authorized, audited, tenant-scoped, no silent elevation", async () => {
  const a = await prov(base({
    setupMode: "ORG_ADMIN_USERS", authorizationStatus: undefined,
    users: [{ fullName: "Sam Staff", loginMethod: "USERNAME_TEMP", username: "sam" + rnd(), profile: "Staff/Shopkeeper", apps: [] }],
  }));
  const b = await prov(base());
  const members = await db.collection("organizationMemberships").where("organizationId", "==", a.organizationId).get();
  const staff = members.docs.map((d) => d.data()).find((m) => m.userId !== a.organizationId);
  assert.ok(staff);

  // wrong tenant: org B's admin is not a member of org A
  await assert.rejects(adminLib.reassignPrimaryAdmin({ actor: padmin, organizationId: a.organizationId, newAdminUid: b.organizationId, reason: "cross tenant" }), (e) => e.status === 404);
  await assert.rejects(adminLib.reassignPrimaryAdmin({ actor: customerActor, organizationId: a.organizationId, newAdminUid: staff.userId, reason: "me" }), (e) => e.status === 403);
  await assert.rejects(adminLib.reassignPrimaryAdmin({ actor: padmin, organizationId: a.organizationId, newAdminUid: staff.userId, reason: "" }), (e) => e.status === 400);

  await adminLib.reassignPrimaryAdmin({ actor: padmin, organizationId: a.organizationId, newAdminUid: staff.userId, reason: "manager left" });
  const org = await getOrg(a.organizationId);
  assert.equal(org.primaryAdmin.userId, staff.userId);
  assert.equal(org.adminUid, a.organizationId, "the account-owner login pointer is untouched");
  const actions = (await db.collection("auditLogs").where("targetId", "==", a.organizationId).get()).docs.map((d) => d.data().action);
  assert.ok(actions.includes("organization.primary_admin_reassigned"));
});

test("a restricted (unverified) organization cannot raise anyone to administrator", async () => {
  const r = await prov(base({
    setupMode: "ORG_ADMIN_USERS", requester: { name: "Temp", email: "t@x.test", type: "employee_other" }, licensedSeats: 4,
    users: [{ fullName: "Sam Staff", loginMethod: "USERNAME_TEMP", username: "sam" + rnd(), profile: "Staff/Shopkeeper", apps: [] }],
  }));
  const members = await db.collection("organizationMemberships").where("organizationId", "==", r.organizationId).get();
  const staff = members.docs.map((d) => d.data()).find((m) => m.userId !== r.organizationId);
  await assert.rejects(adminLib.reassignPrimaryAdmin({ actor: padmin, organizationId: r.organizationId, newAdminUid: staff.userId, reason: "try" }), (e) => e.status === 403);
});

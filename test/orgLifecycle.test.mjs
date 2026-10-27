// Organization lifecycle: archive/restore (30 days), permanent delete, shared users,
// resumable cleanup. Synthetic organizations on the Firebase emulators only:
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
const lc = await import("../lib/orgLifecycle.js");
const fa = await import("../lib/firebaseAdmin.js");
const realPurge = (await import("../lib/userPurge.js")).purgeUser;
const db = fa.adminDb();
const owner = { uid: "owner-1", email: "owner@bizzux.test", platformRole: "OWNER" };
const admin = { uid: "padmin-1", email: "padmin@bizzux.test", platformRole: "ADMIN" };
let n = 0;
const rnd = () => Math.random().toString(36).slice(2, 8);
const rid = () => "req-lc-" + Date.now() + "-" + ++n;
const base = (o = {}) => ({
  setupMode: "ORG_ADMIN", requestId: rid(), organizationName: "Synthetic " + ++n + " " + rnd(),
  industry: "Retail", countryCode: "IN", state: "Kerala", timezone: "Asia/Kolkata", currency: "INR",
  planType: "PAID", expiryDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), licensedSeats: 5,
  apps: ["bizzux-notes", "bizzux-crm"],
  admin: { fullName: "Asha Admin", loginMethod: "USERNAME_TEMP", username: "asha" + rnd() },
  requester: { name: "Rita Requester", email: "rita@acme.test", type: "manager" },
  ...o,
});
const prov = (body, actor = owner) => lib.provisionOrganization({ actor, body, origin: "http://localhost" }, { sendInvite: async () => {} });
const withUser = (o = {}) => base({
  setupMode: "ORG_ADMIN_USERS",
  users: [{ fullName: "Sam Staff", loginMethod: "USERNAME_TEMP", username: "sam" + rnd(), profile: "Manager", apps: ["bizzux-notes"] }],
  ...o,
});
// Real purge for people; owners' blob/POS calls need network tokens, so they are mimicked.
const purgeUser = async (info) => {
  if (!info.ownsBusiness) return realPurge(info);
  if (!info.keepIdentity) await fa.adminAuth().deleteUser(info.uid).catch(() => {});
  return { skipped: [] };
};
const orphans = async (id) => {
  const out = {};
  for (const col of ["organizationAppSubscriptions", "appAssignments", "organizationMemberships", "usernames"]) {
    out[col] = (await db.collection(col).where("organizationId", "==", id).get()).size;
  }
  out.org = (await db.doc("organizations/" + id).get()).exists;
  out.customer = (await db.doc("customers/" + id).get()).exists;
  out.team = (await db.collection("customers/" + id + "/team").get()).size;
  return out;
};
const empty = { organizationAppSubscriptions: 0, appAssignments: 0, organizationMemberships: 0, usernames: 0, org: false, customer: false, team: 0 };
const uidsOf = async (id) => (await db.collection("usernames").where("organizationId", "==", id).get()).docs.map((d) => d.data().uid);
const exists = (uid) => fa.adminAuth().getUser(uid).then(() => true, () => false);

before(async () => {
  await db.doc("platformAdmins/" + admin.uid).set({ email: admin.email, role: "ADMIN", status: "active", permissions: null });
});

test("environment classification: Production / Trial / Test-Demo", async () => {
  const mk = (planType) => lc.environmentFor({ planType }, null);
  assert.equal(mk("PAID"), "production"); assert.equal(mk("TRIAL"), "trial"); assert.equal(mk("TEST"), "test_demo");
  const r = await prov(base({ planType: "TEST" }));
  const row = (await lib.listOrganizations({})).find((x) => x.id === r.organizationId);
  assert.equal(row.environment, "test_demo");
});

test("deletion reasons: picklist enforced, 'Other' needs text", () => {
  assert.equal(lc.parseDeletionReason({ reasonCode: "duplicate" }).reasonCode, "duplicate");
  assert.throws(() => lc.parseDeletionReason({ reasonCode: "bogus" }), (e) => e.status === 400);
  assert.throws(() => lc.parseDeletionReason({ reasonCode: "other", reason: "" }), (e) => e.status === 400);
});

test("TEST org: preview, permanent delete, recreate with same name -> new id, nothing orphaned", async () => {
  const name = "Demo Recreate " + rnd();
  const r1 = await prov(withUser({ organizationName: name, planType: "TEST" }));
  const uids = await uidsOf(r1.organizationId);
  assert.equal(uids.length, 2);
  const pv = await lc.previewOrgDeletion({ actor: admin, organizationId: r1.organizationId });
  assert.equal(pv.environment, "test_demo"); assert.equal(pv.canDeleteNow, true);
  assert.equal(pv.users.removed, 2); assert.equal(pv.users.keptElsewhere, 0); assert.deepEqual(pv.blockers, []);
  await assert.rejects(lc.deleteOrganizationPermanently({ actor: admin, organizationId: r1.organizationId, confirmName: "wrong" }, { purgeUser }), (e) => e.status === 400);
  const out = await lc.deleteOrganizationPermanently({ actor: admin, organizationId: r1.organizationId, confirmName: name, reasonCode: "testing_recreate" }, { purgeUser });
  assert.equal(out.ok, true); assert.equal(out.usersRemoved, 2);
  assert.deepEqual(await orphans(r1.organizationId), empty);
  for (const u of uids) assert.equal(await exists(u), false);
  const job = (await db.doc("orgLifecycle/" + r1.organizationId).get()).data();
  assert.equal(job.state, "completed"); assert.equal(job.reasonCode, "testing_recreate");
  const audit = (await db.collection("auditLogs").where("targetId", "==", r1.organizationId).get()).docs.map((d) => d.data().action);
  assert.ok(audit.includes("organization.delete_test"));
  // recreate with the same name and the same admin username
  const r2 = await prov(withUser({ organizationName: name, planType: "TEST" }));
  assert.notEqual(r2.organizationId, r1.organizationId);
  assert.equal((await db.doc("organizations/" + r2.organizationId).get()).exists, true);
});

test("a person in two organizations keeps their login and the surviving org", async () => {
  const a = await prov(withUser({ planType: "TEST" }));
  const b = await prov(base());
  const [adminA, shared] = [a.organizationId, (await uidsOf(a.organizationId)).find((u) => u !== a.organizationId)];
  await db.doc("organizationMemberships/" + b.organizationId + "_" + shared).set({ organizationId: b.organizationId, userId: shared, role: "STAFF", status: "active" });
  await db.doc("appAssignments/" + b.organizationId + "_" + shared + "_bizzux-notes").set({ organizationId: b.organizationId, userId: shared, appId: "bizzux-notes", status: "ACTIVE" });
  const bBefore = await orphans(b.organizationId);
  const pv = await lc.previewOrgDeletion({ actor: owner, organizationId: adminA });
  assert.equal(pv.users.keptElsewhere, 1); assert.equal(pv.users.removed, 1);
  const out = await lc.deleteOrganizationPermanently({ actor: owner, organizationId: adminA, confirmName: (await db.doc("organizations/" + adminA).get()).data().organizationName, reasonCode: "testing_recreate" }, { purgeUser });
  assert.equal(out.ok, true); assert.equal(out.usersDetached, 1);
  assert.deepEqual(await orphans(adminA), empty);
  assert.equal(await exists(shared), true, "shared login must survive");
  assert.equal((await db.doc("organizationMemberships/" + b.organizationId + "_" + shared).get()).exists, true);
  assert.equal((await db.collection("appAssignments").where("organizationId", "==", b.organizationId).where("userId", "==", shared).get()).size, 1);
  const bAfter = await orphans(b.organizationId);
  assert.equal(bAfter.organizationMemberships, bBefore.organizationMemberships);
  assert.equal(bAfter.org, true); assert.equal(bAfter.customer, true);
});

test("failed or skipped cleanup is never reported complete; retry resumes and finishes", async () => {
  const name = "Flaky " + rnd();
  const r = await prov(withUser({ organizationName: name, planType: "TEST" }));
  const id = r.organizationId;
  const t = new Date();
  let fail = true;
  const flaky = async (info) => { if (fail && info.ownsBusiness) throw new Error("storage unavailable"); return purgeUser(info); };
  const first = await lc.deleteOrganizationPermanently({ actor: admin, organizationId: id, confirmName: name, now: t }, { purgeUser: flaky });
  assert.equal(first.ok, false); assert.equal(first.status, "incomplete"); assert.ok(first.failed[0].includes("storage unavailable"));
  assert.equal((await db.doc("organizations/" + id).get()).data().status, "deleting");
  assert.equal((await db.doc("orgLifecycle/" + id).get()).data().state, "deleting");
  assert.ok((await db.collection("auditLogs").where("targetId", "==", id).get()).docs.some((d) => d.data().action === "organization.delete_incomplete"));
  // skipped external stores also count as incomplete
  const skippy = async (info) => ({ ...(await purgeUser(info)), skipped: info.ownsBusiness ? ["CRM photos (token not configured)"] : [] });
  const second = await lc.deleteOrganizationPermanently({ actor: admin, organizationId: id, confirmName: name, now: new Date(t.getTime() + 1000) }, { purgeUser: skippy });
  assert.equal(second.ok, false); assert.ok(second.failed[0].includes("CRM photos"));
  fail = false;
  const third = await lc.deleteOrganizationPermanently({ actor: admin, organizationId: id, confirmName: name, now: new Date(t.getTime() + 2000) }, { purgeUser: flaky });
  assert.equal(third.ok, true);
  assert.deepEqual(await orphans(id), empty);
  assert.equal((await db.doc("orgLifecycle/" + id).get()).data().state, "completed");
});

test("archive: 30-day window, restore cancels it, expiry purges only after day 30", async () => {
  const name = "Archive Co " + rnd();
  const r = await prov(withUser({ organizationName: name }));
  const id = r.organizationId;
  const t0 = new Date("2026-01-01T00:00:00Z");
  await assert.rejects(lib.changeOrganizationStatus({ actor: owner, organizationId: id, action: "archive", reasonCode: "other", reason: "", now: t0 }), (e) => e.status === 400);
  await lib.changeOrganizationStatus({ actor: admin, organizationId: id, action: "archive", reasonCode: "no_longer_required", now: t0 });
  let org = (await db.doc("organizations/" + id).get()).data();
  assert.equal(org.status, "archived"); assert.equal(org.deletionReasonCode, "no_longer_required");
  assert.equal(org.purgeAfter.toDate().toISOString(), "2026-01-31T00:00:00.000Z");
  // restore within the window: back to active, schedule gone
  const back = await lib.changeOrganizationStatus({ actor: admin, organizationId: id, action: "reactivate", reason: "customer returned" });
  assert.equal(back.status, "active");
  org = (await db.doc("organizations/" + id).get()).data();
  assert.equal(org.purgeAfter, undefined);
  assert.deepEqual(await lc.purgeExpiredArchives({ now: new Date("2026-03-01T00:00:00Z"), deps: { purgeUser } }), [], "restored org is never purged");
  // archive again, same name is reusable meanwhile, and expiry honours the date
  await lib.changeOrganizationStatus({ actor: admin, organizationId: id, action: "archive", reasonCode: "duplicate", now: t0 });
  const other = await prov(base({ organizationName: name }));
  const early = await lc.purgeExpiredArchives({ now: new Date("2026-01-30T23:59:00Z"), deps: { purgeUser } });
  assert.equal(early.filter((x) => x.id === id).length, 0, "day 29: untouched");
  assert.equal((await db.doc("organizations/" + id).get()).exists, true);
  // production delete before expiry is refused for the Owner without the explicit early flag
  await assert.rejects(lc.deleteOrganizationPermanently({ actor: owner, organizationId: id, confirmName: name, reasonCode: "duplicate", now: new Date("2026-01-10T00:00:00Z") }, { purgeUser }), (e) => e.status === 400 && /Recovery window/.test(e.message));
  await assert.rejects(lc.deleteOrganizationPermanently({ actor: admin, organizationId: id, confirmName: name, reasonCode: "duplicate" }, { purgeUser }), (e) => e.status === 403);
  const late = await lc.purgeExpiredArchives({ now: new Date("2026-02-01T00:00:00Z"), deps: { purgeUser } });
  assert.equal(late.find((x) => x.id === id).result, "deleted");
  assert.deepEqual(await orphans(id), empty);
  // the live organization that reused the name must keep its name lock
  await assert.rejects(prov(base({ organizationName: name, admin: { fullName: "Z", loginMethod: "USERNAME_TEMP", username: "z" + rnd() } })), (e) => e.status === 409);
  assert.equal((await db.doc("organizations/" + other.organizationId).get()).exists, true);
});

test("expiry is blocked by legal hold, retention and active billing; stays archived with reasons", async () => {
  const mk = async (patchOrg, patchCust) => {
    const r = await prov(withUser());
    await lib.changeOrganizationStatus({ actor: owner, organizationId: r.organizationId, action: "archive", reasonCode: "no_longer_required", now: new Date("2026-01-01T00:00:00Z") });
    if (patchOrg) await db.doc("organizations/" + r.organizationId).set(patchOrg, { merge: true });
    if (patchCust) await db.doc("customers/" + r.organizationId).set(patchCust, { merge: true });
    return r.organizationId;
  };
  const hold = await mk({ legalHold: true });
  const keep = await mk({ retentionUntil: new Date("2027-01-01T00:00:00Z") });
  const bill = await mk(null, { billing: "paid", planId: "plan-1", status: "suspended", prevStatus: "active" });
  const res = await lc.purgeExpiredArchives({ now: new Date("2026-03-01T00:00:00Z"), deps: { purgeUser } });
  for (const id of [hold, keep, bill]) {
    assert.equal(res.find((x) => x.id === id).result, "blocked");
    const o = (await db.doc("organizations/" + id).get()).data();
    assert.equal(o.status, "archived"); assert.ok(o.purgeBlocked.length >= 1);
    assert.equal((await db.doc("customers/" + id).get()).exists, true, "no data touched");
    await assert.rejects(lc.deleteOrganizationPermanently({ actor: owner, organizationId: id, confirmName: o.organizationName || o.name, reasonCode: "duplicate", earlyPurge: true }, { purgeUser }), (e) => e.status === 409 && e.blockers.length >= 1);
  }
  assert.match((await db.doc("organizations/" + hold).get()).data().purgeBlocked[0], /Legal hold/);
  assert.match((await db.doc("organizations/" + bill).get()).data().purgeBlocked[0], /paid subscription/);
});

test("Owner may remove a Production org early; permanent delete needs fresh sign-in at the route", async () => {
  const name = "Early " + rnd();
  const r = await prov(withUser({ organizationName: name }));
  await assert.rejects(lc.deleteOrganizationPermanently({ actor: owner, organizationId: r.organizationId, confirmName: name, reasonCode: "duplicate" }, { purgeUser }), (e) => e.status === 400);
  await lib.changeOrganizationStatus({ actor: owner, organizationId: r.organizationId, action: "archive", reasonCode: "duplicate" });
  const out = await lc.deleteOrganizationPermanently({ actor: owner, organizationId: r.organizationId, confirmName: name, reasonCode: "duplicate", earlyPurge: true }, { purgeUser });
  assert.equal(out.ok, true); assert.deepEqual(await orphans(r.organizationId), empty);
  assert.throws(() => fa.requireRecentAuth({ authTime: Math.floor(Date.now() / 1000) - 3600 }), (e) => e.code === "reauth_required");
  assert.doesNotThrow(() => fa.requireRecentAuth({ authTime: Math.floor(Date.now() / 1000) - 30 }));
});

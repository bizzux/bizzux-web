// Phase 1 foundation tests: platform roles/permissions, derived status,
// owner resolution, the directory search index, and tenant isolation.
// Run with: npm run test:orgs  (Firebase emulators)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account", project_id: "demo-bizzux", private_key: privateKey,
  client_email: "test@demo-bizzux.iam.gserviceaccount.com",
});
process.env.PLATFORM_OWNER_EMAIL = "owner-f@bizzux.test";
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run via firebase emulators:exec");

const roles = await import("../lib/platformRoles.js");
const fa = await import("../lib/firebaseAdmin.js");
const st = await import("../lib/orgStatus.js");
const dir = await import("../lib/orgDirectory.js");
const owners = await import("../lib/orgOwners.js");
const prov = await import("../lib/orgProvisioning.js");
const { createOrganization } = await import("../lib/organization.js");
const { Timestamp } = await import("firebase-admin/firestore");
const db = fa.adminDb();
const rnd = () => Math.random().toString(36).slice(2, 8);

async function signIn(email, displayName = "") {
  const u = await fa.adminAuth().createUser({ email, password: "Passw0rd-" + rnd(), displayName: displayName || undefined });
  const custom = await fa.adminAuth().createCustomToken(u.uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const { idToken } = await r.json();
  assert.ok(idToken);
  return { uid: u.uid, req: { headers: { get: (h) => (h.toLowerCase() === "authorization" ? "Bearer " + idToken : null) } } };
}

test("permission matrix by role; owner-only permissions are never delegable", () => {
  const P = roles.hasPermission;
  for (const p of roles.PERMISSIONS) assert.ok(P("OWNER", null, p));
  assert.ok(P("ADMIN", null, "organizations.create") && P("ADMIN", null, "organizations.delete_test"));
  assert.ok(!P("ADMIN", null, "organizations.delete") && !P("ADMIN", null, "support.access.approve"));
  assert.ok(P("SUPPORT_AGENT", null, "organizations.view") && P("SUPPORT_AGENT", null, "support.tickets"));
  for (const p of ["organizations.create", "organizations.suspend", "subscription.manage", "billing.manage"]) assert.ok(!P("SUPPORT_AGENT", null, p), p);
  assert.ok(P("BILLING_ADMIN", null, "subscription.manage") && P("BILLING_ADMIN", null, "billing.manage"));
  for (const p of ["organizations.create", "organizations.suspend", "support.tickets", "organizations.manage"]) assert.ok(!P("BILLING_ADMIN", null, p), p);
  // stored arrays are exact, but can never grant owner-only permissions
  assert.ok(P("SUPPORT_AGENT", ["organizations.view", "organizations.create"], "organizations.create"));
  assert.ok(!P("SUPPORT_AGENT", ["organizations.view"], "support.tickets"));
  assert.ok(!P("ADMIN", ["organizations.delete", "support.access.approve"], "organizations.delete"));
  assert.ok(!P("ADMIN", ["organizations.delete", "support.access.approve"], "support.access.approve"));
  assert.deepEqual(roles.effectivePermissions("NOPE", null), []);
  assert.deepEqual(roles.effectivePermissions(undefined, null), []);
});

test("request guard: platform roles, customer admins and anonymous callers", async () => {
  const owner = await signIn("owner-f@bizzux.test");
  const support = await signIn("support-" + rnd() + "@bizzux.test");
  const billing = await signIn("billing-" + rnd() + "@bizzux.test");
  const customerAdmin = await signIn("custadmin-" + rnd() + "@example.test");
  await db.doc("platformAdmins/" + support.uid).set({ email: "s", role: "SUPPORT_AGENT", status: "active", permissions: null });
  await db.doc("platformAdmins/" + billing.uid).set({ email: "b", role: "BILLING_ADMIN", status: "active", permissions: null });
  await db.doc("customers/" + customerAdmin.uid).set({ email: "c", organizationName: "Cust", status: "trial" });
  await db.doc("memberships/" + customerAdmin.uid).set({ accountId: customerAdmin.uid, profile: "Global Admin" });

  assert.equal((await roles.requirePlatformPermission(owner.req, "organizations.delete")).platformRole, "OWNER");
  assert.equal((await roles.requirePlatformPermission(support.req, "organizations.view")).platformRole, "SUPPORT_AGENT");
  await assert.rejects(roles.requirePlatformPermission(support.req, "organizations.create"), (e) => e.status === 403);
  await assert.rejects(roles.requirePlatformPermission(support.req, "support.access.approve"), (e) => e.status === 403);
  assert.ok((await roles.requirePlatformPermission(billing.req, "billing.manage")).permissions.includes("billing.manage"));
  await assert.rejects(roles.requirePlatformPermission(billing.req, "organizations.suspend"), (e) => e.status === 403);
  // a customer-side Global Admin has NO platform access, whatever their account rights
  for (const p of roles.PERMISSIONS) await assert.rejects(roles.requirePlatformPermission(customerAdmin.req, p), (e) => e.status === 403, p);
  await assert.rejects(roles.requirePlatformPermission({ headers: { get: () => null } }, "organizations.view"), (e) => e.status === 401);
  // the new roles do NOT reach routes still guarded by the older OWNER/ADMIN checks
  await assert.rejects(fa.requirePlatformAdmin(support.req), (e) => e.status === 403);
  await assert.rejects(fa.requireSuperAdmin(billing.req), (e) => e.status === 403);
  // a disabled platform admin loses access
  await db.doc("platformAdmins/" + support.uid).update({ status: "disabled" });
  await assert.rejects(roles.requirePlatformPermission(support.req, "organizations.view"), (e) => e.status === 403);
});

test("derived status separates plan, payment, trial, onboarding and account", () => {
  const soon = Timestamp.fromMillis(Date.now() + 5 * 864e5), past = Timestamp.fromMillis(Date.now() - 864e5);
  let s = st.deriveStatus({ status: "trial", trialEndDate: soon, onboarded: true });
  assert.equal(s.account, "active"); assert.equal(s.plan.type, "TRIAL"); assert.equal(s.payment, "unpaid");
  assert.equal(s.trial.state, "active"); assert.ok(s.trial.daysLeft >= 4); assert.equal(s.onboarding, "onboarded");
  s = st.deriveStatus({ status: "trial", trialEndDate: past });
  assert.equal(s.trial.state, "expired"); assert.equal(s.account, "active"); assert.equal(s.onboarding, "not_onboarded");
  s = st.deriveStatus({ status: "active", planId: "p1", planName: "Suite", onboarded: true });
  assert.equal(s.payment, "paid"); assert.equal(s.plan.type, "PAID"); assert.equal(s.trial.state, "none");
  s = st.deriveStatus({ status: "active", billing: "complimentary", planId: "p1" });
  assert.equal(s.payment, "complimentary"); assert.equal(s.plan.type, "FREE"); assert.equal(s.trial.state, "none");
  s = st.deriveStatus({ status: "active", billing: "complimentary", planType: "TEST" }, { planType: "TEST" });
  assert.equal(s.plan.type, "TEST"); assert.equal(s.payment, "complimentary");
  s = st.deriveStatus({ status: "suspended", prevStatus: "trial" });
  assert.equal(s.account, "suspended");
  s = st.deriveStatus({ status: "active", planId: "p" }, { status: "archived" });
  assert.equal(s.account, "archived");
  s = st.deriveStatus(null, { status: "pending_admin", planType: "PAID" });
  assert.equal(s.account, "pending_admin"); assert.equal(s.plan.type, "PAID"); assert.equal(s.payment, "none");
  s = st.deriveStatus({ status: "trial_pending" });
  assert.equal(s.trial.state, "not_started"); assert.equal(s.onboarding, "trial_not_started");
  s = st.deriveStatus({ status: "trial", trialEndDate: soon, mustChangePassword: true });
  assert.equal(s.onboarding, "awaiting_first_login");
  s = st.deriveStatus({ status: "past_due", planId: "p" });
  assert.equal(s.payment, "past_due");
  // never throws on odd input
  assert.ok(st.deriveStatus({}, {}).account);
});

test("owner resolution follows real memberships; nothing is invented", async () => {
  const a = await fa.adminAuth().createUser({ email: "ownerA-" + rnd() + "@example.test", displayName: "Alice Owner" });
  const b = await fa.adminAuth().createUser({ email: "ownerB-" + rnd() + "@example.test", displayName: "Bob Owner" });
  const mk = async (id, uid, status = "active", role = "OWNER") => {
    await createOrganization({ id, name: "Org " + id, type: "CUSTOMER", createdBy: uid || "x" });
    if (uid) await db.doc(`organizationMemberships/${id}_${uid}`).set({ organizationId: id, userId: uid, role, status });
  };
  const idA = "ownA-" + rnd(), idB = "ownB-" + rnd(), idNone = "ownN-" + rnd(), idInactive = "ownI-" + rnd();
  await mk(idA, a.uid); await mk(idB, b.uid); await mk(idNone, null); await mk(idInactive, a.uid, "disabled");
  const r = await owners.resolveOrgOwners([idA, idB, idNone, idInactive]);
  assert.equal(r[idA].owner.name, "Alice Owner"); assert.equal(r[idA].owner.uid, a.uid);
  assert.equal(r[idB].owner.name, "Bob Owner");
  assert.equal(r[idNone].owner, null, "no membership -> no owner, never invented");
  assert.equal(r[idInactive].owner, null, "inactive membership is ignored");
  // tenant separation: A's owner is not B's
  assert.notEqual(r[idA].owner.uid, r[idB].owner.uid);
  const withAdmins = await owners.resolveOrgOwners([idA], { includeAdmins: true });
  assert.equal(withAdmins[idA].admins.length, 0);
});

test("list fills a missing administrator from the real OWNER membership (self-service)", async () => {
  const u = await fa.adminAuth().createUser({ email: "lash-" + rnd() + "@example.test", displayName: "Lash Mariner" });
  const id = "selfown-" + rnd();
  await createOrganization({ id, name: "Seasafe " + rnd(), type: "CUSTOMER", createdBy: u.uid });
  await db.doc("customers/" + id).set({ email: u.email, status: "trial", createdAt: new Date() }); // no name fields, like real self-service
  await db.doc(`organizationMemberships/${id}_${u.uid}`).set({ organizationId: id, userId: u.uid, role: "OWNER", status: "active" });
  const row = (await prov.listOrganizations({})).find((x) => x.id === id);
  assert.equal(row.adminName, "Lash Mariner"); assert.equal(row.adminContact, u.email); assert.equal(row.ownerFromMembership, true);
});

test("directory index: build, search, filter, sort, cursor pagination", async () => {
  const tag = "zq" + rnd();
  const mkEntry = async (i, over = {}) => {
    const id = `${tag}-${String(i).padStart(2, "0")}`;
    const entry = dir.buildDirectoryEntry({
      id,
      org: { type: "CUSTOMER", name: over.name || `${tag} Company ${i}`, status: over.status || "active", planType: over.planType || "TRIAL", createdAt: Timestamp.fromMillis(1700000000000 + i * 1000), industry: "Retail", countryCode: "IN", countryName: "India" },
      customer: over.customer === undefined ? { status: "trial", createdByAdmin: !!over.admin } : over.customer,
      owner: over.owner === undefined ? { uid: "u" + i, name: "Owner " + i, email: `owner${i}@${tag}.test` } : over.owner,
    });
    await db.doc("organizationDirectory/" + id).set(entry);
    return id;
  };
  for (let i = 1; i <= 7; i++) await mkEntry(i);
  await mkEntry(8, { name: `${tag} Marine Engineering`, status: "suspended", customer: { status: "suspended" }, owner: null });
  await mkEntry(9, { name: `${tag} Costal Works`, admin: true });

  // search: prefix of name, owner email, owner name
  let r = await dir.queryDirectory({ q: tag, limit: 100 });
  assert.equal(r.rows.length, 9); assert.equal(r.nextCursor, null);
  assert.deepEqual((await dir.queryDirectory({ q: `${tag} cost` })).rows.map((x) => x.name), [`${tag} Costal Works`]);
  assert.equal((await dir.queryDirectory({ q: `owner3@${tag}.test` })).rows.length, 1);
  assert.equal((await dir.queryDirectory({ q: "marine " + tag })).rows[0].hasOwner, false);
  assert.equal((await dir.queryDirectory({ q: "nomatchhere" + rnd() })).rows.length, 0);

  // filters (one pushed to Firestore, others applied) + search together
  r = await dir.queryDirectory({ q: tag, accountStatus: "suspended" });
  assert.deepEqual(r.rows.map((x) => x.orgId), [`${tag}-08`]);
  r = await dir.queryDirectory({ q: tag, kind: "admin-provisioned", accountStatus: "active" });
  assert.deepEqual(r.rows.map((x) => x.orgId), [`${tag}-09`]);

  // sorting
  r = await dir.queryDirectory({ q: tag, sort: "name", limit: 100 });
  assert.deepEqual(r.rows.map((x) => x.nameLower), [...r.rows.map((x) => x.nameLower)].sort());
  r = await dir.queryDirectory({ q: tag, sort: "created", dir: "asc", limit: 100 });
  assert.equal(r.rows[0].orgId, `${tag}-01`);

  // cursor pagination: pages of 4 cover everything exactly once, in order
  for (const sort of ["created", "name"]) {
    const seen = []; let cursor = null; let pages = 0;
    do {
      const page = await dir.queryDirectory({ q: tag, sort, limit: 4, cursor });
      assert.ok(page.rows.length <= 4);
      seen.push(...page.rows.map((x) => x.orgId)); cursor = page.nextCursor; pages++;
    } while (cursor && pages < 10);
    assert.equal(seen.length, 9, sort); assert.equal(new Set(seen).size, 9, sort + " no duplicates");
    assert.equal(pages, 3, sort);
  }
  await assert.rejects(dir.queryDirectory({ q: tag, cursor: "garbage!!" }), (e) => e.status === 400);
  // limit is capped; derived fields are present, internals are not leaked
  r = await dir.queryDirectory({ q: tag, limit: 100000 });
  assert.ok(r.rows.length <= 100); assert.equal(r.rows[0].searchTokens, undefined);
  assert.ok(["accountStatus", "planType", "payment", "trialState", "onboarding"].every((k) => k in r.rows[0]));
});

test("directory stays in sync from the provisioning paths and the sync is non-destructive", async () => {
  const actor = { uid: "own-" + rnd(), email: "o@bizzux.test", platformRole: "OWNER" };
  const name = "Sync Test " + rnd();
  const r = await prov.provisionOrganization({
    actor, origin: "http://localhost",
    body: {
      setupMode: "ORG_ADMIN", requestId: "req-sync-" + rnd(), organizationName: name, industry: "Retail", countryCode: "IN", timezone: "Asia/Kolkata", currency: "INR",
      planType: "PAID", expiryDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), licensedSeats: 5, apps: ["bizzux-notes"],
      admin: { fullName: "Sync Admin", loginMethod: "USERNAME_TEMP", username: "sy" + rnd() },
    },
  }, { sendInvite: async () => {} });
  let e = (await db.doc("organizationDirectory/" + r.organizationId).get()).data();
  assert.equal(e.name, name); assert.equal(e.accountStatus, "active"); assert.equal(e.kind, "admin-provisioned"); assert.equal(e.planType, "PAID");
  assert.equal(e.ownerName, "Sync Admin");
  assert.equal((await dir.queryDirectory({ q: name.split(" ").slice(-1)[0] })).rows.some((x) => x.orgId === r.organizationId), true);

  await prov.changeOrganizationStatus({ actor, organizationId: r.organizationId, action: "suspend" });
  e = (await db.doc("organizationDirectory/" + r.organizationId).get()).data();
  assert.equal(e.accountStatus, "suspended");

  // re-sync never modifies the source records
  const before = JSON.stringify([(await db.doc("organizations/" + r.organizationId).get()).data(), (await db.doc("customers/" + r.organizationId).get()).data()]);
  await dir.syncOrganizationDirectory(r.organizationId);
  const after = JSON.stringify([(await db.doc("organizations/" + r.organizationId).get()).data(), (await db.doc("customers/" + r.organizationId).get()).data()]);
  assert.equal(before, after);

  // a missing source removes the entry
  await db.doc("organizations/" + r.organizationId).delete();
  await dir.syncOrganizationDirectory(r.organizationId);
  assert.equal((await db.doc("organizationDirectory/" + r.organizationId).get()).exists, false);
});

test("backfill script: estimate writes nothing, dry-run writes nothing, apply builds the index without touching sources", async () => {
  const { execFileSync } = await import("node:child_process");
  const id = "bf-" + rnd();
  await createOrganization({ id, name: "Backfill Co " + rnd(), type: "CUSTOMER", createdBy: "x" });
  await db.doc("customers/" + id).set({ email: "bf@example.test", status: "trial", createdAt: new Date() });
  const srcBefore = JSON.stringify([(await db.doc("organizations/" + id).get()).data(), (await db.doc("customers/" + id).get()).data()]);
  const run = (...args) => execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/backfill-organization-directory.mjs", ...args], { env: process.env, encoding: "utf8" });
  const out0 = run();
  assert.match(out0, /Estimate only/);
  assert.equal((await db.doc("organizationDirectory/" + id).get()).exists, false);
  const out1 = run("--dry-run");
  assert.match(out1, /\[dry-run\] processed \d+ organizations, 0 index documents written/);
  assert.equal((await db.doc("organizationDirectory/" + id).get()).exists, false);
  const out2 = run("--apply");
  assert.match(out2, /\[apply\] processed/);
  const e = (await db.doc("organizationDirectory/" + id).get()).data();
  assert.equal(e.orgId, id); assert.equal(e.hasOwner, false);
  assert.equal(JSON.stringify([(await db.doc("organizations/" + id).get()).data(), (await db.doc("customers/" + id).get()).data()]), srcBefore);
  run("--apply"); // idempotent
  assert.equal((await db.collection("organizationDirectory").where("orgId", "==", id).get()).size, 1);
});

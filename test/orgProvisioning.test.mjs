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

test("temporary password expires; reset and normal logins still work", async () => {
  const ua = await import("../lib/usernameAuth.js");
  const body = base();
  const r = await prov(body);
  const cred = r.credentials[0];
  const ok = await ua.usernameLogin({ username: cred.username, password: cred.temporaryPassword, ip: "t1" });
  assert.equal(ok.mustChangePassword, true);
  // force expiry
  await db.doc("usernames/" + cred.username).update({ tempExpiresAt: new Date(Date.now() - 1000) });
  await assert.rejects(ua.usernameLogin({ username: cred.username, password: cred.temporaryPassword, ip: "t1" }), (e) => e.code === "temp_password_expired");
  // wrong password on an expired account still gets the generic error (no leak)
  await assert.rejects(ua.usernameLogin({ username: cred.username, password: "nope-nope-1", ip: "t1" }), (e) => e.status === 401);
  // admin reissue restores access with a fresh expiry
  const uid = (await db.doc("usernames/" + cred.username).get()).data().uid;
  await ua.setUsernamePassword(uid, "Fresh-temp-123", true, { tempExpiresAt: ua.tempExpiry() });
  assert.equal((await ua.usernameLogin({ username: cred.username, password: "Fresh-temp-123", ip: "t1" })).mustChangePassword, true);
  // after the user sets their own password the expiry is cleared
  await ua.setUsernamePassword(uid, "My-own-pass-123", false);
  assert.equal((await db.doc("usernames/" + cred.username).get()).data().tempExpiresAt, null);
  assert.equal((await ua.usernameLogin({ username: cred.username, password: "My-own-pass-123", ip: "t1" })).mustChangePassword, false);
  // legacy accounts (no tempExpiresAt field) are unaffected
  await db.doc("usernames/" + cred.username).update({ tempExpiresAt: (await import("firebase-admin/firestore")).FieldValue.delete(), mustChangePassword: true });
  assert.ok((await ua.usernameLogin({ username: cred.username, password: "My-own-pass-123", ip: "t1" })).token);
});

test("password change at first login is optional per person", async () => {
  const ua = await import("../lib/usernameAuth.js");
  const r = await prov(base({
    setupMode: "ORG_ADMIN_USERS",
    admin: { fullName: "Keep Pw", loginMethod: "USERNAME_TEMP", username: "keep" + rnd(), requirePasswordChange: false },
    users: [{ fullName: "Must Change", loginMethod: "USERNAME_TEMP", username: "must" + rnd(), profile: "Manager", apps: [] }],
  }));
  const [a, u] = r.credentials;
  assert.equal(a.mustChangePassword, false); assert.equal(u.mustChangePassword, true);
  const login = await ua.usernameLogin({ username: a.username, password: a.temporaryPassword, ip: "t2" });
  assert.equal(login.mustChangePassword, false);
  assert.equal((await db.doc("usernames/" + a.username).get()).data().tempExpiresAt, null);
  assert.equal((await db.doc("customers/" + r.organizationId).get()).data().mustChangePassword, false);
  assert.equal((await ua.usernameLogin({ username: u.username, password: u.temporaryPassword, ip: "t2" })).mustChangePassword, true);
});

test("manual password: used for login, never echoed or stored in plaintext", async () => {
  const ua = await import("../lib/usernameAuth.js");
  const pw = "Typed-by-admin-77";
  const r = await prov(base({ admin: { fullName: "Manual", loginMethod: "USERNAME_TEMP", username: "man" + rnd(), passwordMode: "MANUAL", password: pw, requirePasswordChange: false } }));
  assert.equal(r.credentials[0].temporaryPassword, undefined);
  assert.ok(!JSON.stringify(r).includes(pw));
  const dump = JSON.stringify((await db.collection("usernames").get()).docs.map((d) => d.data()));
  assert.ok(!dump.includes(pw));
  assert.ok((await ua.usernameLogin({ username: r.credentials[0].username, password: pw, ip: "t3" })).token);
  await assert.rejects(prov(base({ admin: { fullName: "Short", loginMethod: "USERNAME_TEMP", username: "sh" + rnd(), passwordMode: "MANUAL", password: "abc" } })), (e) => e.status === 400);
});

test("TEST plan: no trial clock, not billed, duplicate names allowed, plan switch works", async () => {
  const trial = await import("../lib/trial.js");
  const name = "Test Retail " + rnd();
  const mk = () => prov(base({ organizationName: name, planType: "TEST", expiryDate: undefined, admin: { fullName: "T", loginMethod: "USERNAME_TEMP", username: "t" + rnd() } }));
  const a = await mk(); const b = await mk();
  assert.notEqual(a.organizationId, b.organizationId);
  const cust = (await db.doc("customers/" + a.organizationId).get()).data();
  assert.equal(cust.status, "active"); assert.equal(cust.billing, "complimentary"); assert.equal(cust.isTestAccount, true);
  assert.equal(trial.canAccessApps(cust), true);
  assert.equal(trial.isPayingCustomer(cust), false);
  assert.equal((await db.doc("organizations/" + a.organizationId).get()).data().isTestAccount, true);
  const subs = await db.collection("organizationAppSubscriptions").where("organizationId", "==", a.organizationId).get();
  assert.ok(subs.docs.every((d) => d.data().subscriptionType === "INTERNAL"));
  // switching to Trial requires an expiry, then applies the trial clock
  await assert.rejects(lib.updateOrganizationEntitlements({ actor: owner, organizationId: a.organizationId, body: { planType: "TRIAL" } }), (e) => e.status === 400);
  const exp = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await lib.updateOrganizationEntitlements({ actor: owner, organizationId: a.organizationId, body: { planType: "TRIAL", expiryDate: exp } });
  const after = (await db.doc("customers/" + a.organizationId).get()).data();
  assert.equal(after.status, "trial"); assert.equal(after.isTestAccount, false); assert.equal(after.billing, undefined);
  // non-test duplicates are still refused
  const real = base(); await prov(real);
  await assert.rejects(prov({ ...real, requestId: rid(), admin: { ...real.admin, username: "x" + rnd() } }), (e) => e.status === 409);
});

test("platform admin can delete a TEST org (with users) by typing its name; real orgs stay protected", async () => {
  const purged = [];
  const purgeUser = async (info) => { purged.push(info.uid); await fa.adminAuth().deleteUser(info.uid).catch(() => {}); return { skipped: [] }; };
  const name = "Disposable " + rnd();
  const r = await prov(base({
    organizationName: name, planType: "TEST", setupMode: "ORG_ADMIN_USERS",
    users: [{ fullName: "U", loginMethod: "USERNAME_TEMP", username: "u" + rnd(), profile: "Manager", apps: [] }],
  }));
  const uids = (await db.collection("usernames").where("organizationId", "==", r.organizationId).get()).docs.map((d) => d.data().uid);
  assert.equal(uids.length, 2);
  await assert.rejects(lib.deleteOrganizationPermanently({ actor: admin, organizationId: r.organizationId, confirmName: "nope" }, { purgeUser }), (e) => e.status === 400);
  const out = await lib.deleteOrganizationPermanently({ actor: admin, organizationId: r.organizationId, confirmName: name }, { purgeUser });
  assert.equal(out.usersRemoved, 2);
  assert.equal((await db.doc("organizations/" + r.organizationId).get()).exists, false);
  assert.equal((await db.doc("customers/" + r.organizationId).get()).exists, false);
  assert.equal((await db.collection("usernames").where("organizationId", "==", r.organizationId).get()).size, 0);
  for (const u of uids) await assert.rejects(fa.adminAuth().getUser(u));
  // a real (non-test) org is still not deletable by a platform admin
  const real = await prov(base());
  await assert.rejects(lib.deleteOrganizationPermanently({ actor: admin, organizationId: real.organizationId, confirmName: "x" }, { purgeUser }), (e) => e.status === 403);
  assert.equal((await db.doc("organizations/" + real.organizationId).get()).exists, true);
});

test("INTERNAL plan: group company, free, no expiry, manageable, Owner-only delete, not test", async () => {
  const trial = await import("../lib/trial.js");
  const name = "Bizzux Sister " + rnd();
  const r = await prov(base({ organizationName: name, planType: "INTERNAL", expiryDate: undefined }));
  const org = (await db.doc("organizations/" + r.organizationId).get()).data();
  assert.equal(org.type, "INTERNAL"); assert.equal(org.planType, "INTERNAL"); assert.equal(org.isTestAccount, false);
  const cust = (await db.doc("customers/" + r.organizationId).get()).data();
  assert.equal(cust.isInternal, true); assert.equal(cust.isTestAccount, false);
  assert.equal(trial.canAccessApps(cust), true); assert.equal(trial.isPayingCustomer(cust), false);
  // duplicate names are still refused (real company)
  await assert.rejects(prov(base({ organizationName: name, planType: "INTERNAL", admin: { fullName: "Z", loginMethod: "USERNAME_TEMP", username: "z" + rnd() } })), (e) => e.status === 409);
  // listing: editable, labelled Internal
  const row = (await lib.listOrganizations({})).find((x) => x.id === r.organizationId);
  assert.equal(row.planLabel, "Internal"); assert.equal(row.editable, true); assert.equal(row.isTest, false);
  await lib.updateOrganizationEntitlements({ actor: owner, organizationId: r.organizationId, body: { apps: ["bizzux-notes"] } });
  await assert.rejects(lib.updateOrganizationEntitlements({ actor: owner, organizationId: r.organizationId, body: { planType: "PAID", expiryDate: "2099-01-01" } }), (e) => e.status === 400);
  // a Platform Admin can't delete it; the pre-existing own org stays untouchable
  await assert.rejects(lib.deleteOrganizationPermanently({ actor: admin, organizationId: r.organizationId, confirmName: name }), (e) => e.status === 403);
  await createOrganization({ id: "bizzux-own", name: "Bizzux", type: "INTERNAL", createdBy: "x" });
  await assert.rejects(lib.changeOrganizationStatus({ actor: owner, organizationId: "bizzux-own", action: "suspend" }), (e) => e.status === 400);
  assert.equal((await lib.changeOrganizationStatus({ actor: owner, organizationId: r.organizationId, action: "suspend" })).status, "suspended");
});

test("reset org admin password: generated, hashed, forced change, unlocks; list shows username", async () => {
  const ua = await import("../lib/usernameAuth.js");
  const r = await prov(base({ admin: { fullName: "Reset Me", loginMethod: "USERNAME_TEMP", username: "rst" + rnd(), email: "rm@example.test" } }));
  const username = r.credentials[0].username;
  const row = (await lib.listOrganizations({})).find((x) => x.id === r.organizationId);
  assert.equal(row.adminUsername, username);
  await db.doc("usernames/" + username).update({ failedCount: 5, lockedUntil: new Date(Date.now() + 600000) });
  const out = await lib.resetOrgAdminPassword({ actor: admin, organizationId: r.organizationId });
  assert.equal(out.username, username); assert.equal(out.mustChangePassword, true);
  const dump = JSON.stringify([...(await db.collection("usernames").get()).docs.map((d) => d.data()), ...(await db.collection("auditLogs").get()).docs.map((d) => d.data())]);
  assert.ok(!dump.includes(out.temporaryPassword));
  assert.equal((await ua.usernameLogin({ username, password: out.temporaryPassword, ip: "t9" })).mustChangePassword, true);
  await assert.rejects(ua.usernameLogin({ username, password: r.credentials[0].temporaryPassword, ip: "t9" }), (e) => e.status === 401);
  const man = await lib.resetOrgAdminPassword({ actor: owner, organizationId: r.organizationId, password: "Chosen-pass-55", requirePasswordChange: false });
  assert.equal(man.temporaryPassword, undefined);
  assert.equal((await ua.usernameLogin({ username, password: "Chosen-pass-55", ip: "t9" })).mustChangePassword, false);
  // email-invite admins have no username login to reset
  const inv = await prov(base({ admin: { fullName: "E", loginMethod: "EMAIL_INVITE", email: "e" + rnd() + "@example.test" } }));
  await assert.rejects(lib.resetOrgAdminPassword({ actor: owner, organizationId: inv.organizationId }), (e) => e.status === 400);
});

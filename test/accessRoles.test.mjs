// Access & Roles: role matrix, invitation lifecycle, owner protection, audit.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "test@demo-bizzux.iam.gserviceaccount.com" });
process.env.PLATFORM_OWNER_EMAIL = "owner-ar@bizzux.test";
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run via firebase emulators:exec");

const fa = await import("../lib/firebaseAdmin.js");
const roles = await import("../lib/platformRoles.js");
const acc = await import("../lib/platformAdminAccess.js");
const route = await import("../app/api/admin/platform-admins/route.js");
const inviteRoute = await import("../app/api/admin/platform-invitation/route.js");
const { Timestamp } = await import("firebase-admin/firestore");
const db = fa.adminDb();
const rnd = () => Math.random().toString(36).slice(2, 8);

async function signIn(email, emailVerified = true) {
  const u = await fa.adminAuth().createUser({ email, emailVerified, password: "Passw0rd-" + rnd() });
  const custom = await fa.adminAuth().createCustomToken(u.uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  return { uid: u.uid, email, token: (await r.json()).idToken };
}
const post = (r, who, body) => r.POST(new Request("http://localhost/api/x", { method: "POST", headers: { Authorization: "Bearer " + who.token, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const get = (r, who, qs = "") => r.GET(new Request("http://localhost/api/x" + qs, { headers: { Authorization: "Bearer " + who.token } }));
const bearer = (w) => ({ headers: { get: (h) => (h.toLowerCase() === "authorization" ? "Bearer " + w.token : null) } });
const sent = [];
const send = async (x) => { sent.push(x); };
const asActor = (w, role) => ({ uid: w.uid, email: w.email, platformRole: role });
const caller = (w, extra = {}) => ({ uid: w.uid, email: w.email, emailVerified: true, ...extra });

let owner, admin;
before(async () => {
  owner = await signIn("owner-ar@bizzux.test");
  await db.doc("platformAdmins/" + owner.uid).set({ email: owner.email, role: "OWNER", status: "active", permissions: null });
  admin = await signIn("ar-admin-" + rnd() + "@bizzux.test");
  await db.doc("platformAdmins/" + admin.uid).set({ email: admin.email, role: "ADMIN", status: "active", permissions: null });
});

test("role matrix: each role gets only its intended permissions", () => {
  const P = roles.hasPermission;
  assert.ok(P("CUSTOMER_OPERATIONS_ADMIN", null, "customers.create") && P("CUSTOMER_OPERATIONS_ADMIN", null, "customers.users.manage"));
  for (const p of ["billing.manage", "platform.roles.manage", "platform.finops.read", "security.settings.manage"]) assert.ok(!P("CUSTOMER_OPERATIONS_ADMIN", null, p), p);
  for (const p of ["billing.subscriptions.read", "billing.subscriptions.manage", "analytics.saas.read", "billing.refunds.approve"]) assert.ok(!P("SUPPORT_AGENT", null, p), p);
  assert.ok(P("BILLING_ADMIN", null, "billing.refunds.approve") && P("BILLING_ADMIN", null, "analytics.saas.read"));
  assert.ok(!P("BILLING_ADMIN", null, "security.settings.manage") && !P("BILLING_ADMIN", null, "platform.configuration.manage"));
  assert.ok(P("PLATFORM_OPERATIONS_ADMIN", null, "platform.health.read") && P("PLATFORM_OPERATIONS_ADMIN", null, "platform.finops.read"));
  for (const p of ["customers.read", "billing.manage", "support.tickets", "audit.view"]) assert.ok(!P("PLATFORM_OPERATIONS_ADMIN", null, p), p);
  for (const p of ["platform.roles.manage", "security.settings.manage", "data.recovery.execute"]) {
    assert.ok(P("OWNER", null, p)); assert.ok(!P("ADMIN", null, p)); assert.ok(!P("ADMIN", roles.PERMISSIONS, p));
  }
  assert.ok(P("ADMIN", null, "customers.suspend")); // alias of organizations.suspend
  assert.ok(!roles.ASSIGNABLE_ROLES.includes("OWNER"));
});

test("only the Owner can invite; Admin cannot; OWNER is never assignable", async () => {
  assert.equal((await post(route, admin, { action: "invite", email: "x@y.test", role: "ADMIN" })).status, 403);
  assert.equal((await post(route, admin, { action: "changeRole", uid: owner.uid, role: "ADMIN" })).status, 403);
  const o = asActor(owner, "OWNER");
  await assert.rejects(acc.createInvitation({ actor: o, email: "new@y.test", role: "OWNER", origin: "http://x", send }), (e) => e.status === 400);
  await assert.rejects(acc.createInvitation({ actor: o, email: "not-an-email", role: "ADMIN", origin: "http://x", send }), (e) => e.status === 400);
  await assert.rejects(acc.createInvitation({ actor: o, email: owner.email, role: "ADMIN", origin: "http://x", send }), (e) => e.status === 400);
  assert.equal((await post(route, owner, { action: "changeRole", uid: admin.uid, role: "OWNER" })).status, 400);
  assert.equal((await db.doc("platformAdmins/" + admin.uid).get()).data().role, "ADMIN");
  const g = await get(route, admin);
  assert.equal(g.status, 200);
  assert.equal((await g.json()).invitations.length, 0); // admins don't see invitations
});

test("invitation: no prior account; accept needs matching verified email and MFA; single use", async () => {
  const email = "ops-" + rnd() + "@bizzux.test";
  const inv = await acc.createInvitation({ actor: asActor(owner, "OWNER"), email, role: "CUSTOMER_OPERATIONS_ADMIN", origin: "http://x", send });
  assert.equal(sent.at(-1).email, email);
  const stored = (await db.doc("platformInvitations/" + inv.id).get()).data();
  assert.equal(stored.status, "pending");
  assert.ok(!JSON.stringify(stored).includes(inv.token));
  assert.equal((await acc.inspectInvitation(inv.token)).state, "ok");
  assert.equal((await acc.inspectInvitation("nope")).state, "invalid");

  const u = await signIn(email);
  const other = await signIn("other-" + rnd() + "@bizzux.test");
  await assert.rejects(acc.acceptInvitation({ c: caller(other), token: inv.token }), (e) => e.status === 403);
  await assert.rejects(acc.acceptInvitation({ c: caller(u, { emailVerified: false }), token: inv.token }), (e) => e.code === "email_unverified");
  await assert.rejects(acc.acceptInvitation({ c: caller(u), token: inv.token }), (e) => e.code === "mfa_required");
  assert.equal((await db.doc("platformAdmins/" + u.uid).get()).exists, false);

  await db.doc("twoFactor/" + u.uid).set({ enabled: true, method: "totp" });
  assert.equal((await acc.acceptInvitation({ c: caller(u), token: inv.token })).role, "CUSTOMER_OPERATIONS_ADMIN");
  const d = (await db.doc("platformAdmins/" + u.uid).get()).data();
  assert.equal(d.role, "CUSTOMER_OPERATIONS_ADMIN");
  assert.equal(d.status, "active");
  assert.equal(d.invitedBy, owner.email);
  await assert.rejects(acc.acceptInvitation({ c: caller(u), token: inv.token }), (e) => e.status === 410);
  assert.equal((await acc.inspectInvitation(inv.token)).state, "used");

  const c = await roles.requirePlatformPermission(bearer(u), "customers.create");
  assert.equal(c.platformRole, "CUSTOMER_OPERATIONS_ADMIN");
  await assert.rejects(roles.requirePlatformPermission(bearer(u), "billing.manage"), (e) => e.status === 403);
});

test("expiry, resend supersedes the old link, revoke, failed email leaves nothing usable", async () => {
  const o = asActor(owner, "OWNER");
  const email = "exp-" + rnd() + "@bizzux.test";
  const a = await acc.createInvitation({ actor: o, email, role: "SUPPORT_AGENT", origin: "http://x", send });
  await db.doc("platformInvitations/" + a.id).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  assert.equal((await acc.inspectInvitation(a.token)).state, "expired");
  const u = await signIn(email);
  await db.doc("twoFactor/" + u.uid).set({ enabled: true });
  await assert.rejects(acc.acceptInvitation({ c: caller(u), token: a.token }), (e) => e.status === 410);

  const b = await acc.createInvitation({ actor: o, email, role: "BILLING_ADMIN", origin: "http://x", send });
  assert.equal((await db.doc("platformInvitations/" + a.id).get()).data().status, "revoked");
  await acc.revokeInvitation({ actor: o, id: b.id });
  assert.equal((await acc.inspectInvitation(b.token)).state, "invalid");
  await assert.rejects(acc.acceptInvitation({ c: caller(u), token: b.token }), (e) => e.status === 410);

  const failEmail = "fail-" + rnd() + "@bizzux.test";
  await assert.rejects(acc.createInvitation({ actor: o, email: failEmail, role: "SUPPORT_AGENT", origin: "http://x", send: async () => { throw { status: 502, message: "boom" }; } }), (e) => e.status === 502);
  assert.equal((await db.collection("platformInvitations").where("status", "==", "pending").where("email", "==", failEmail).get()).size, 0);
});

test("role change, disable and reactivate; Owner untouchable; audited; history", async () => {
  const email = "chg-" + rnd() + "@bizzux.test";
  const u = await signIn(email);
  await db.doc("platformAdmins/" + u.uid).set({ email, role: "SUPPORT_AGENT", status: "active", permissions: null });
  const actor = asActor(owner, "OWNER");
  await acc.changeRole({ actor, uid: u.uid, role: "PLATFORM_OPERATIONS_ADMIN" });
  assert.equal((await db.doc("platformAdmins/" + u.uid).get()).data().role, "PLATFORM_OPERATIONS_ADMIN");
  await assert.rejects(acc.changeRole({ actor, uid: u.uid, role: "OWNER" }), (e) => e.status === 400);
  await assert.rejects(acc.changeRole({ actor, uid: owner.uid, role: "ADMIN" }), (e) => e.status === 400);
  await assert.rejects(acc.setAccess({ actor, uid: owner.uid, enable: false }), (e) => e.status === 400);

  await acc.setAccess({ actor, uid: u.uid, enable: false });
  await assert.rejects(roles.requirePlatformPermission(bearer(u), "platform.health.read"), (e) => e.status === 403);
  await acc.setAccess({ actor, uid: u.uid, enable: true });
  assert.ok((await roles.requirePlatformPermission(bearer(u), "platform.health.read")).platformRole);

  const h = await acc.adminHistory(u.uid);
  const kinds = h.map((x) => x.action);
  for (const k of ["platform_admin.role_change", "platform_admin.disable", "platform_admin.reactivate"]) assert.ok(kinds.includes(k), k);
  const rc = h.find((x) => x.action === "platform_admin.role_change");
  assert.deepEqual([rc.details.from, rc.details.to], ["SUPPORT_AGENT", "PLATFORM_OPERATIONS_ADMIN"]);
  assert.equal(rc.actorEmail, owner.email);
});

test("roster shows MFA status, inviter and pending invitations (Owner only)", async () => {
  const email = "ros-" + rnd() + "@bizzux.test";
  await acc.createInvitation({ actor: asActor(owner, "OWNER"), email, role: "SUPPORT_AGENT", origin: "http://x", send });
  const r = await (await get(route, owner)).json();
  assert.ok(r.invitations.some((i) => i.email === email && i.roleLabel === "Customer Support Agent"));
  assert.ok(r.admins.every((a) => typeof a.mfaEnabled === "boolean" && a.roleLabel));
  assert.equal(r.roles.length, roles.ASSIGNABLE_ROLES.length);
});

test("recent sign-in is required for privileged changes", () => {
  assert.throws(() => fa.requireRecentAuth({ authTime: Math.floor(Date.now() / 1000) - 3600 }), (e) => e.code === "reauth_required");
  assert.doesNotThrow(() => fa.requireRecentAuth({ authTime: Math.floor(Date.now() / 1000) - 30 }));
});

test("public invitation endpoint reveals nothing for bad tokens", async () => {
  const r = await inviteRoute.GET(new Request("http://localhost/api/x?token=garbage"));
  assert.deepEqual(await r.json(), { state: "invalid" });
  const p = await inviteRoute.POST(new Request("http://localhost/api/x", { method: "POST", body: "{}" }));
  assert.equal(p.status, 401);
});

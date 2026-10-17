// Phase 3: route-level permission, reason and audit tests for the customer /
// organization admin endpoints, using real (emulator) ID tokens.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "test@demo-bizzux.iam.gserviceaccount.com" });
process.env.PLATFORM_OWNER_EMAIL = "owner-p3@bizzux.test";
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run via firebase emulators:exec");

const fa = await import("../lib/firebaseAdmin.js");
const { createOrganization } = await import("../lib/organization.js");
const { upsertOrganizationMembership } = await import("../lib/organizationMembership.js");
const customersRoute = await import("../app/api/admin/customers/route.js");
const orgsRoute = await import("../app/api/admin/organizations/route.js");
const dirRoute = await import("../app/api/admin/org-directory/route.js");
const { Timestamp } = await import("firebase-admin/firestore");
const db = fa.adminDb();
const rnd = () => Math.random().toString(36).slice(2, 8);

async function signIn(email) {
  const u = await fa.adminAuth().createUser({ email, password: "Passw0rd-" + rnd() });
  const custom = await fa.adminAuth().createCustomToken(u.uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  return { uid: u.uid, email, token: (await r.json()).idToken };
}
const post = (route, who, body) => route.POST(new Request("http://localhost/api/x", { method: "POST", headers: { Authorization: "Bearer " + who.token, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const get = (route, who, qs = "") => route.GET(new Request("http://localhost/api/x" + qs, { headers: { Authorization: "Bearer " + who.token } }));
const status = async (resP) => { const r = await resP; if (r.status !== 200 && process.env.DEBUG_STATUS) console.log("STATUS", r.status, JSON.stringify(await r.clone().json().catch(() => null))); return r.status; };
const auditFor = async (id, action) => (await db.collection("auditLogs").where("targetId", "==", id).get()).docs.map((d) => d.data()).filter((a) => a.action === action);

let owner, admin, billing, support, custAdmin, cid;
before(async () => {
  owner = await signIn("owner-p3@bizzux.test");
  await db.doc("platformAdmins/" + owner.uid).set({ email: owner.email, role: "OWNER", status: "active", permissions: null });
  admin = await signIn("p3admin-" + rnd() + "@bizzux.test");
  billing = await signIn("p3billing-" + rnd() + "@bizzux.test");
  support = await signIn("p3support-" + rnd() + "@bizzux.test");
  custAdmin = await signIn("p3cust-" + rnd() + "@example.test");
  await db.doc("platformAdmins/" + admin.uid).set({ email: admin.email, role: "ADMIN", status: "active", permissions: null });
  await db.doc("platformAdmins/" + billing.uid).set({ email: billing.email, role: "BILLING_ADMIN", status: "active", permissions: null });
  await db.doc("platformAdmins/" + support.uid).set({ email: support.email, role: "SUPPORT_AGENT", status: "active", permissions: null });
  await db.doc("customers/" + custAdmin.uid).set({ email: custAdmin.email, organizationName: "Their Co", status: "trial" });
  await db.doc("memberships/" + custAdmin.uid).set({ accountId: custAdmin.uid, profile: "Global Admin" });
  cid = "p3cust-" + rnd();
  await createOrganization({ id: cid, name: "P3 Customer " + rnd(), type: "CUSTOMER", createdBy: "x" });
  await db.doc("customers/" + cid).set({
    email: "owner@p3.test", organizationName: "P3 Customer", status: "trial", createdAt: Timestamp.now(),
    trialEndDate: Timestamp.fromMillis(Date.now() + 3 * 864e5),
  });
  await upsertOrganizationMembership({ organizationId: cid, userId: "someone", role: "OWNER", status: "active" });
});

test("customer actions: each needs its permission; customer-side admins and anonymous are refused", async () => {
  const ext = { action: "extendTrial", id: cid, amount: 1, unit: "weeks", reason: "Customer asked for more time" };
  assert.equal(await status(post(customersRoute, support, ext)), 403, "support agent can't change subscriptions");
  assert.equal(await status(post(customersRoute, custAdmin, ext)), 403, "customer admin is not platform staff");
  assert.equal(await status(post(customersRoute, { token: "garbage" }, ext)), 500, "bad token is rejected (not 200)");
  assert.equal(await status(post(customersRoute, billing, ext)), 200, "billing admin can");
  assert.equal(await status(post(customersRoute, admin, ext)), 200, "platform admin can");
  // billing admin cannot suspend; platform admin can
  assert.equal(await status(post(customersRoute, billing, { action: "suspend", id: cid, reason: "Fraud review" })), 403);
  assert.equal(await status(post(customersRoute, support, { action: "suspend", id: cid, reason: "Fraud review" })), 403);
  // billing cannot touch sign-in controls
  assert.equal(await status(post(customersRoute, billing, { action: "revokeSessions", uid: cid })), 403);
  // unknown action
  assert.equal(await status(post(customersRoute, owner, { action: "nope", id: cid })), 400);
});

test("reasons are required on the server and recorded with before/after in the audit log", async () => {
  assert.equal(await status(post(customersRoute, admin, { action: "extendTrial", id: cid, amount: 1, unit: "days" })), 400);
  assert.equal(await status(post(customersRoute, admin, { action: "extendTrial", id: cid, amount: 1, unit: "days", reason: "  " })), 400);
  assert.equal(await status(post(customersRoute, admin, { action: "setGuestSeats", id: cid, guestSeats: 2 })), 400);
  assert.equal(await status(post(customersRoute, billing, { action: "setGuestSeats", id: cid, guestSeats: 2, reason: "Bought two guest seats" })), 200);
  const gs = (await auditFor(cid, "customer.set_guest_seats")).at(-1);
  assert.equal(gs.details.reason, "Bought two guest seats"); assert.equal(gs.details.previousGuestSeats, 0); assert.equal(gs.details.guestSeats, 2);
  assert.equal(gs.actorEmail, billing.email); assert.equal(gs.actorRole, "BILLING_ADMIN");
  const ex = (await auditFor(cid, "customer.extend_trial")).at(-1);
  assert.ok(ex.details.reason && ex.details.previousTrialEndDate && ex.details.newTrialEndDate);

  // suspension: reason required, before/after recorded, directory follows
  assert.equal(await status(post(customersRoute, admin, { action: "suspend", id: cid })), 400);
  assert.equal(await status(post(customersRoute, admin, { action: "suspend", id: cid, reason: "Non-payment, 30 days" })), 200);
  assert.equal((await db.doc("customers/" + cid).get()).data().status, "suspended");
  const su = (await auditFor(cid, "organization.suspend")).at(-1);
  assert.equal(su.details.reason, "Non-payment, 30 days"); assert.equal(su.details.fromStatus, "trial");
  assert.equal((await db.doc("organizationDirectory/" + cid).get()).data().accountStatus, "suspended");
  // reactivation does not need a reason but accepts one
  assert.equal(await status(post(customersRoute, admin, { action: "reactivate", id: cid })), 200);
  assert.equal((await db.doc("customers/" + cid).get()).data().status, "trial");
});

test("organization actions: reason required for suspend/archive and plan/app changes", async () => {
  const org = "p3org-" + rnd();
  await createOrganization({ id: org, name: "P3 Admin Org " + rnd(), type: "CUSTOMER", createdBy: "x" });
  await db.doc("organizations/" + org).set({ provisionedVia: "platform-admin", apps: ["bizzux-notes"], planType: "TRIAL", status: "pending_admin", allowedUsers: 3 }, { merge: true });
  assert.equal(await status(post(orgsRoute, admin, { action: "suspend", id: org })), 400);
  assert.equal(await status(post(orgsRoute, admin, { action: "archive", id: org, reason: "" })), 400);
  assert.equal(await status(post(orgsRoute, admin, { action: "updateEntitlements", id: org, apps: ["bizzux-crm"] })), 400);
  assert.equal(await status(post(orgsRoute, admin, { action: "updateEntitlements", id: org, apps: ["bizzux-crm"], reason: "Customer upgraded" })), 200);
  const en = (await auditFor(org, "organization.entitlements_set")).at(-1);
  assert.equal(en.details.reason, "Customer upgraded"); assert.deepEqual(en.details.before.apps, ["bizzux-notes"]); assert.deepEqual(en.details.after.apps, ["bizzux-crm"]);
  assert.equal(await status(post(orgsRoute, admin, { action: "suspend", id: org, reason: "Abuse report" })), 200);
  const st = (await auditFor(org, "organization.suspend")).at(-1);
  assert.equal(st.details.reason, "Abuse report"); assert.equal(st.details.from, "pending_admin"); assert.equal(st.details.to, "suspended");
  // support agents & billing admins can't use the organization-management route at all
  assert.ok([403, 404].includes(await status(post(orgsRoute, support, { action: "archive", id: org, reason: "x y z" }))), "refused (no customer account for staff roles)");
  assert.ok([403, 404].includes(await status(post(orgsRoute, billing, { action: "archive", id: org, reason: "x y z" }))));
  assert.equal(await status(post(orgsRoute, custAdmin, { action: "archive", id: org, reason: "x y z" })), 403);
});

test("read endpoints: support and billing roles can view; customer admins cannot; tenant data isn't cross-readable", async () => {
  assert.equal(await status(get(dirRoute, support)), 200);
  assert.equal(await status(get(dirRoute, billing, "?id=" + cid)), 200);
  assert.equal(await status(get(dirRoute, custAdmin)), 403);
  assert.equal(await status(get(dirRoute, custAdmin, "?id=" + cid)), 403);
  assert.equal(await status(get(dirRoute, custAdmin, "?id=" + cid + "&section=audit")), 403);
  assert.equal(await status(get(customersRoute, support, "?row=" + cid)), 200);
  assert.equal(await status(get(customersRoute, support)), 403, "full customer list stays owner/admin only");
  assert.equal(await status(get(customersRoute, admin)), 200);
  assert.equal(await status(get(customersRoute, custAdmin, "?row=" + cid)), 403);
  // the reindex maintenance action needs organizations.manage
  assert.equal(await status(post(dirRoute, support, { action: "reindex" })), 403);
  assert.equal(await status(post(dirRoute, admin, { action: "reindex" })), 200);
  // a disabled staff account loses everything immediately
  await db.doc("platformAdmins/" + billing.uid).update({ status: "disabled" });
  assert.equal(await status(get(dirRoute, billing)), 403);
  assert.equal(await status(post(customersRoute, billing, { action: "setGuestSeats", id: cid, guestSeats: 1, reason: "disabled?" })), 403);
});

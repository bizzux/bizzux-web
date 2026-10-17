// Phase 4: approved, scoped, time-limited, audited support access.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "test@demo-bizzux.iam.gserviceaccount.com" });
process.env.PLATFORM_OWNER_EMAIL = "owner-p4@bizzux.test";
process.env.APP_SSO_SECRET = "test-app-secret";
process.env.SHOP_SSO_SECRET = "test-shop-secret";
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run via firebase emulators:exec");

const fa = await import("../lib/firebaseAdmin.js");
const sa = await import("../lib/supportAccess.js");
const accessRoute = await import("../app/api/admin/support-access/route.js");
const appSso = await import("../app/api/app-sso/route.js");
const shopSso = await import("../app/api/shop-sso/route.js");
const posSso = await import("../app/api/pos-sso/route.js");
const db = fa.adminDb();
const rnd = () => Math.random().toString(36).slice(2, 8);
const { Timestamp } = await import("firebase-admin/firestore");

async function signIn(email) {
  const u = await fa.adminAuth().createUser({ email, password: "Passw0rd-" + rnd() });
  const custom = await fa.adminAuth().createCustomToken(u.uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  return { uid: u.uid, email, token: (await r.json()).idToken };
}
const hdr = (who) => ({ Authorization: "Bearer " + who.token, "Content-Type": "application/json" });
const post = async (who, body) => { const r = await accessRoute.POST(new Request("http://localhost/x", { method: "POST", headers: hdr(who), body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const get = async (who, qs) => { const r = await accessRoute.GET(new Request("http://localhost/x" + qs, { headers: hdr(who) })); return { status: r.status, body: await r.json() }; };
const open = async (route, who, qs) => { const r = await route.GET(new Request("http://localhost/x" + qs, { headers: hdr(who) })); return { status: r.status, body: await r.json() }; };
const tokenPayload = (url) => JSON.parse(Buffer.from(url.split("token=")[1].split(".")[0], "base64url").toString());
const audits = async (orgId, action) => (await db.collection("auditLogs").where("targetId", "==", orgId).get()).docs.map((d) => d.data()).filter((a) => a.action === action);

let owner, admin, support, support2, billing, custAdmin, org;
before(async () => {
  owner = await signIn("owner-p4@bizzux.test");
  await db.doc("platformAdmins/" + owner.uid).set({ email: owner.email, role: "OWNER", status: "active", permissions: null });
  admin = await signIn("p4admin-" + rnd() + "@bizzux.test");
  support = await signIn("p4support-" + rnd() + "@bizzux.test");
  support2 = await signIn("p4support2-" + rnd() + "@bizzux.test");
  billing = await signIn("p4bill-" + rnd() + "@bizzux.test");
  custAdmin = await signIn("p4cust-" + rnd() + "@example.test");
  const role = (u, r) => db.doc("platformAdmins/" + u.uid).set({ email: u.email, role: r, status: "active", permissions: null });
  await role(admin, "ADMIN"); await role(support, "SUPPORT_AGENT"); await role(support2, "SUPPORT_AGENT"); await role(billing, "BILLING_ADMIN");
  await db.doc("customers/" + custAdmin.uid).set({ email: custAdmin.email, organizationName: "Their Co", status: "trial" });
  org = "p4org-" + rnd();
  await db.doc("customers/" + org).set({ email: "owner@p4.test", organizationName: "P4 Customer", status: "trial", createdAt: Timestamp.now() });
});

test("requests: who can ask, validation, one open request per person per organization", async () => {
  const ok = { action: "request", organizationId: org, apps: ["notes"], minutes: 30, reason: "Investigating missing invoice" };
  assert.equal((await post(billing, ok)).status, 403, "billing admin has no support access permission");
  assert.equal((await post(custAdmin, ok)).status, 403, "customer admin is not platform staff");
  for (const bad of [{ reason: "" }, { apps: [] }, { apps: ["nope"] }, { minutes: 999 }, { organizationId: "does-not-exist" }]) {
    const r = await post(support, { ...ok, ...bad });
    assert.ok([400, 404].includes(r.status), JSON.stringify(bad));
  }
  const first = await post(support, ok);
  assert.equal(first.status, 200); assert.equal(first.body.grant.state, "pending"); assert.equal(first.body.grant.autoApproved, false);
  const again = await post(support, ok);
  assert.equal(again.body.grant.id, first.body.grant.id); assert.equal(again.body.grant.existing, true);
  assert.equal((await audits(org, "support_access.requested")).length >= 1, true);
});

test("approval is Platform Owner only and cannot be delegated, self-approved or inflated", async () => {
  const g = (await post(support2, { action: "request", organizationId: org, apps: ["notes", "files"], minutes: 60, reason: "Slow sync reports" })).body.grant;
  assert.equal((await post(support2, { action: "approve", grantId: g.id })).status, 403, "requester can't self-approve");
  assert.equal((await post(admin, { action: "approve", grantId: g.id })).status, 403, "platform admin can't approve");
  await db.doc("platformAdmins/" + admin.uid).update({ permissions: ["support.access.approve", "support.access.request"] });
  assert.equal((await post(admin, { action: "approve", grantId: g.id })).status, 403, "even an explicit permission can't grant approval");
  assert.equal((await get(admin, "?pending=1")).status, 403);
  assert.equal((await post(owner, { action: "approve", grantId: g.id, minutes: 120 })).status, 400, "can't exceed what was asked");
  const pend = await get(owner, "?pending=1");
  assert.ok(pend.body.grants.some((x) => x.id === g.id));
  assert.equal((await post(owner, { action: "approve", grantId: g.id, minutes: 15 })).status, 200);
  assert.equal((await post(owner, { action: "approve", grantId: g.id })).status, 409, "already decided");
  const after = (await get(owner, "?org=" + org)).body.grants.find((x) => x.id === g.id);
  assert.equal(after.state, "active"); assert.equal(after.minutes, 15); assert.equal(after.approvedByEmail, owner.email);
  const ex = new Date(after.expiresAt).getTime() - new Date(after.approvedAt).getTime();
  assert.equal(Math.round(ex / 60000), 15);
  const ap = (await audits(org, "support_access.approved")).find((a) => a.details.grantId === g.id);
  assert.equal(ap.actorEmail, owner.email);
  // deny path
  const g2 = (await post(billing === null ? support : admin, { action: "request", organizationId: "p4org-x", apps: ["notes"], minutes: 15, reason: "x y z" }));
  assert.equal(g2.status, 404);
});

test("opening an app needs a valid grant: scope, requester, organization, window, revocation", async () => {
  const grantFor = async (who, apps, minutes = 30) => {
    const r = await post(who, { action: "request", organizationId: org, apps, minutes, reason: "Customer reported a sync problem" });
    return r.body.grant;
  };
  const approve = (g) => post(owner, { action: "approve", grantId: g.id });
  const s3 = await signIn("p4support3-" + rnd() + "@bizzux.test");
  await db.doc("platformAdmins/" + s3.uid).set({ email: s3.email, role: "SUPPORT_AGENT", status: "active", permissions: null });

  // 1. no grant at all, and a pending grant, are refused
  let r = await open(appSso, s3, `?app=notes&asOrg=${org}`);
  assert.equal(r.status, 403); assert.equal(r.body.code, "support_access_required");
  const g = await grantFor(s3, ["notes"]);
  r = await open(appSso, s3, `?app=notes&asOrg=${org}&grant=${g.id}`);
  assert.equal(r.status, 403, "pending grant");
  await approve(g);

  // 2. approved: works, token carries expiry + grant id, use is audited
  r = await open(appSso, s3, `?app=notes&asOrg=${org}&grant=${g.id}`);
  assert.equal(r.status, 200);
  const p = tokenPayload(r.body.url);
  assert.equal(p.uid, org); assert.equal(p.sg, g.id); assert.ok(p.exp > Date.now() && p.exp <= Date.now() + 31 * 60000);
  assert.ok((await audits(org, "support_access.used")).some((a) => a.details.grantId === g.id && a.details.app === "notes"));
  assert.equal((await db.doc("supportAccessGrants/" + g.id).get()).data().useCount, 1);

  // 3. out-of-scope app, someone else's grant, wrong organization
  assert.equal((await open(appSso, s3, `?app=files&asOrg=${org}&grant=${g.id}`)).status, 403, "app not in scope");
  assert.equal((await open(appSso, support, `?app=notes&asOrg=${org}&grant=${g.id}`)).status, 403, "someone else's grant");
  const other = "p4other-" + rnd();
  await db.doc("customers/" + other).set({ email: "o@o.test", status: "trial" });
  assert.equal((await open(appSso, s3, `?app=notes&asOrg=${other}&grant=${g.id}`)).status, 403, "different organization");

  // 4. expired
  await db.doc("supportAccessGrants/" + g.id).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  assert.equal((await open(appSso, s3, `?app=notes&asOrg=${org}&grant=${g.id}`)).status, 403, "expired grant");

  // 5. revoked (by the requester, and by the Owner)
  const g2 = await grantFor(s3, ["notes", "business", "pos"]);
  await approve(g2);
  assert.equal((await open(shopSso, s3, `?asOrg=${org}&grant=${g2.id}`)).status, 200, "business app in scope");
  assert.equal((await open(posSso, s3, `?asOrg=${org}&grant=${g2.id}`)).status, 200, "pos in scope");
  const sp = tokenPayload((await open(shopSso, s3, `?asOrg=${org}&grant=${g2.id}`)).body.url);
  assert.equal(sp.orgId, org); assert.equal(sp.sg, g2.id); assert.ok(sp.exp > Date.now());
  assert.equal((await post(support, { action: "revoke", grantId: g2.id })).status, 403, "other support agents can't revoke it");
  assert.equal((await post(s3, { action: "revoke", grantId: g2.id })).status, 200);
  assert.equal((await open(appSso, s3, `?app=notes&asOrg=${org}&grant=${g2.id}`)).status, 403, "revoked");
  assert.ok((await audits(org, "support_access.revoked")).length >= 1);

  // 6. a demoted / disabled holder of an approved grant is refused immediately
  const g3 = await grantFor(s3, ["notes"]);
  await approve(g3);
  await db.doc("platformAdmins/" + s3.uid).update({ status: "disabled" });
  assert.equal((await open(appSso, s3, `?app=notes&asOrg=${org}&grant=${g3.id}`)).status, 403);
  // 7. a customer-side admin can never use asOrg
  assert.equal((await open(appSso, custAdmin, `?app=notes&asOrg=${org}&grant=${g3.id}`)).status, 403);
});

test("Owner access is auto-approved but still a scoped, time-limited, audited grant", async () => {
  const r = await post(owner, { action: "request", organizationId: org, apps: ["notes"], minutes: 15, reason: "Owner checking the account" });
  assert.equal(r.body.grant.autoApproved, true); assert.equal(r.body.grant.state, "active");
  assert.equal((await open(appSso, owner, `?app=notes&asOrg=${org}`)).status, 403, "even the Owner needs a grant to open");
  assert.equal((await open(appSso, owner, `?app=notes&asOrg=${org}&grant=${r.body.grant.id}`)).status, 200);
  assert.equal((await open(appSso, owner, `?app=chat&asOrg=${org}&grant=${r.body.grant.id}`)).status, 403, "scope applies to the Owner too");
});

test("visibility: staff see only their own grants; Owner sees all; customer admins see nothing", async () => {
  const mine = (await get(support, "?org=" + org)).body.grants;
  assert.ok(mine.length >= 1 && mine.every((g) => g.requestedByUid === support.uid));
  const all = (await get(owner, "?org=" + org)).body.grants;
  assert.ok(new Set(all.map((g) => g.requestedByUid)).size >= 3);
  assert.equal((await get(custAdmin, "?org=" + org)).status, 403);
  assert.equal((await get(billing, "?org=" + org)).status, 403);
  assert.equal(sa.grantState({ status: "pending", requestExpiresAt: Timestamp.fromMillis(Date.now() - 1) }), "lapsed");
  assert.equal(sa.grantState({ status: "approved", expiresAt: Timestamp.fromMillis(Date.now() + 5000) }), "active");
  assert.equal(sa.grantState({ status: "denied" }), "denied");
});

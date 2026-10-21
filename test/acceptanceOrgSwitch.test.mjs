// Acceptance: organization switching, cross-company isolation, revocation and the canonical fallback, through the real routes (emulators only).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "emulators only");

const fa = await import("../lib/firebaseAdmin.js");
const sw = await import("../app/api/switch-organization/route.js");
const meRoute = await import("../app/api/me/route.js");
const teamRoute = await import("../app/api/team/route.js");
const db = fa.adminDb();
const RUN = Math.random().toString(36).slice(2, 7);
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const post = async (p, b) => (await fetch(`${AUTH}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function person(label) {
  const u = await fa.adminAuth().createUser({ email: `${label}-${RUN}@x.test`, emailVerified: true, password: "Passw0rd-" + RUN });
  const token = (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(u.uid), returnSecureToken: true })).idToken;
  return { uid: u.uid, token };
}
const req = (w, method = "GET", body) => new Request("http://x/api", { method, headers: { Authorization: "Bearer " + w.token, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
const me = async (w) => (await meRoute.GET(req(w))).json();
const team = async (w) => (await (await teamRoute.GET(req(w))).json()).members?.map((m) => m.email).filter((e) => !e.startsWith("own")) || [];
const switchTo = (w, organizationId) => sw.POST(req(w, "POST", { organizationId }));

let A, B, C, U, single, orgA, orgB, orgC;
before(async () => {
  [A, B, C, U, single] = await Promise.all(["ownA", "ownB", "ownC", "multi", "single"].map(person));
  orgA = A.uid; orgB = B.uid; orgC = C.uid;
  for (const [w, name, mail] of [[A, "Co A", "a-only@x.test"], [B, "Co B", "b-only@x.test"], [C, "Co C", "c-only@x.test"]]) {
    await db.doc("customers/" + w.uid).set({ status: "active", organizationName: name, email: `own${name}@x.test` });
    await db.collection(`customers/${w.uid}/team`).add({ firstName: name, email: mail, uid: "t" + name, profile: "Staff/Shopkeeper", status: "active" });
  }
  // U: legacy member of A (multiOrg), canonical member of B, nothing in C
  await db.doc("memberships/" + U.uid).set({ accountId: orgA, profile: "Admin", multiOrg: true });
  await db.doc(`organizationMemberships/${orgA}_${U.uid}`).set({ organizationId: orgA, userId: U.uid, role: "ADMIN", profile: "Admin", status: "active" });
  await db.doc(`organizationMemberships/${orgB}_${U.uid}`).set({ organizationId: orgB, userId: U.uid, role: "ADMIN", profile: "Admin", status: "active" });
  await db.doc("memberships/" + single.uid).set({ accountId: orgA, profile: "Admin" });
});

test("a multi-company login sees only its companies and starts in the first one", async () => {
  const m = await me(U);
  assert.deepEqual(m.organizations.map((o) => o.id).sort(), [orgA, orgB].sort());
  assert.equal(m.activeOrganizationId, orgA);
  assert.deepEqual(await team(U), ["a-only@x.test"]);
});
test("switching changes the company for data and identity, and never leaks the other company", async () => {
  assert.equal((await switchTo(U, orgB)).status, 200);
  assert.equal((await me(U)).activeOrganizationId, orgB);
  assert.deepEqual(await team(U), ["b-only@x.test"]);
  assert.equal((await switchTo(U, orgA)).status, 200);
  assert.deepEqual(await team(U), ["a-only@x.test"]);
});
test("switching to a company you do not belong to, or as a single-company login, is refused and changes nothing", async () => {
  assert.equal((await switchTo(U, orgC)).status, 403);
  assert.deepEqual(await team(U), ["a-only@x.test"]);
  assert.equal((await switchTo(single, orgB)).status, 400);
  assert.equal((await switchTo(single, orgA)).status, 400);
});
test("a forged active company is ignored: a user pointing at a company they are not in stays in their own", async () => {
  await db.doc("users/" + U.uid).set({ activeOrganizationId: orgC }, { merge: true });
  assert.equal((await fa.resolveAccount(U.uid)).accountId, orgA);
  assert.deepEqual(await team(U), ["a-only@x.test"]);
});
test("revoking or suspending the membership ends access to that company immediately", async () => {
  await switchTo(U, orgB); assert.deepEqual(await team(U), ["b-only@x.test"]);
  for (const status of ["suspended", "removed"]) {
    await db.doc(`organizationMemberships/${orgB}_${U.uid}`).update({ status });
    assert.equal((await fa.resolveAccount(U.uid)).accountId, orgA, status + ": falls back to the company they still belong to");
    assert.equal((await switchTo(U, orgB)).status, 403, status + ": cannot switch back in");
  }
  await db.doc(`organizationMemberships/${orgB}_${U.uid}`).update({ status: "active" });
});
test("the canonical fallback grants only what the record says and never owner power", async () => {
  const x = await person("canonOnly");
  await db.doc(`organizationMemberships/${orgC}_${x.uid}`).set({ organizationId: orgC, userId: x.uid, role: "MEMBER", status: "active" });
  const a = await fa.resolveAccount(x.uid);
  assert.deepEqual([a.accountId, a.isOwner, a.profile], [orgC, false, "Staff/Shopkeeper"]);
  assert.equal((await teamRoute.GET(req(x))).status, 403, "an ordinary member cannot use the admin team API");
  const y = await person("canonOwnerRow");
  await db.doc(`organizationMemberships/${orgC}_${y.uid}`).set({ organizationId: orgC, userId: y.uid, role: "OWNER", status: "active" });
  await assert.rejects(fa.resolveAccount(y.uid), (e) => e.status === 404, "an OWNER row for someone else's company never yields owner access");
  await db.doc("customers/" + orgC).update({ status: "suspended" });
  await assert.rejects(fa.resolveAccount(x.uid), (e) => e.status === 404, "a suspended company grants nothing");
  await db.doc("customers/" + orgC).update({ status: "active" });
});

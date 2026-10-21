// Join requests + members.approve on the Auth + Firestore EMULATORS, through the real route.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run against the emulators only");

const fa = await import("../lib/firebaseAdmin.js");
const route = await import("../app/api/join-requests/route.js");
const rules = await import("../lib/joinRules.js");
const { GENERIC } = await import("../lib/joinRequests.js");
const db = fa.adminDb();
const RUN = Math.random().toString(36).slice(2, 7);
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const post = async (p, b) => (await fetch(`${AUTH}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function person(label) {
  const u = await fa.adminAuth().createUser({ email: `${label}-${RUN}@x.test`, emailVerified: true, password: "Passw0rd-" + RUN, displayName: label });
  const token = (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(u.uid), returnSecureToken: true })).idToken;
  return { uid: u.uid, token };
}
const call = (w, body) => route.POST(new Request("http://x/api/join-requests", { method: "POST", headers: { ...(w ? { Authorization: "Bearer " + w.token } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const list = async (w) => (await route.GET(new Request("http://x/api/join-requests", { headers: { Authorization: "Bearer " + w.token } }))).json();
const reqDoc = (org, uid) => db.doc(`joinRequests/${org}_${uid}`).get();

let O, P, adminNoGrant, adminGrant, manager, code;
const member = async (w, org, role, profile, permissions = []) => {
  await db.doc("memberships/" + w.uid).set({ accountId: org, profile });
  await db.doc(`organizationMemberships/${org}_${w.uid}`).set({ organizationId: org, userId: w.uid, role, profile, status: "active", permissions });
};
before(async () => {
  O = await person("ownerO"); P = await person("ownerP"); adminNoGrant = await person("adm1"); adminGrant = await person("adm2"); manager = await person("mgr");
  code = "BZ" + RUN.toUpperCase().padEnd(6, "X").slice(0, 6);
  await db.doc("customers/" + O.uid).set({ status: "active", organizationName: "Org O", companyCode: code });
  await db.doc("customers/" + P.uid).set({ status: "active", organizationName: "Org P", companyCode: "BZOTHER1" });
  await db.doc(`organizationMemberships/${O.uid}_${O.uid}`).set({ organizationId: O.uid, userId: O.uid, role: "OWNER", status: "active" });
  await db.doc(`organizationAppSubscriptions/${O.uid}_bizzux-crm`).set({ organizationId: O.uid, appId: "bizzux-crm", status: "ACTIVE" });
  await member(adminNoGrant, O.uid, "ADMIN", "Admin");
  await member(adminGrant, O.uid, "ADMIN", "Admin", ["members.approve"]);
  await member(manager, O.uid, "MEMBER", "Manager");
});

test("rules: who can decide and which roles can be assigned", () => {
  const owner = { isOwner: true, role: "OWNER", status: "active", permissions: [] };
  assert.equal(rules.approverCan(owner), true);
  assert.equal(rules.approverCan({ role: "ADMIN", status: "active", permissions: [] }), false);
  assert.equal(rules.approverCan({ role: "ADMIN", status: "active", permissions: ["members.approve"] }), true);
  assert.equal(rules.approverCan({ role: "ADMIN", status: "suspended", permissions: ["members.approve"] }), false);
  for (const r of ["MEMBER", "VIEWER", ""]) assert.equal(rules.approverCan({ role: r, status: "active", permissions: ["members.approve"] }), false, r);
  assert.ok(rules.assignableProfiles(owner).includes("Admin") && !rules.assignableProfiles(owner).includes("Global Admin"));
  assert.ok(!rules.assignableProfiles({ role: "ADMIN", status: "active", permissions: ["members.approve"] }).includes("Admin"));
  assert.equal(rules.cleanCode(" bzabc123 "), "BZABC123"); assert.equal(rules.cleanCode("../x"), "");
});

test("requesting: signed-in only, identical answer for valid and invalid codes, no duplicates", async () => {
  const r1 = await person("req1");
  assert.equal((await call(null, { action: "request", code })).status, 401);
  const bad = await call(r1, { action: "request", code: "BZNOPE99" }); const badJson = await bad.json();
  const good = await call(r1, { action: "request", code, message: "hi" }); const goodJson = await good.json();
  assert.deepEqual([bad.status, badJson], [200, GENERIC]); assert.deepEqual([good.status, goodJson], [200, GENERIC]);
  assert.equal((await db.collection("joinRequests").where("requesterUid", "==", r1.uid).get()).size, 1, "only the valid code created a request");
  await call(r1, { action: "request", code }); assert.equal((await db.collection("joinRequests").where("requesterUid", "==", r1.uid).get()).size, 1);
  const d = (await reqDoc(O.uid, r1.uid)).data();
  assert.deepEqual([d.status, d.requesterEmail, d.organizationId], ["pending", `req1-${RUN}@x.test`, O.uid]);
  assert.ok(d.notifiedUids.includes(O.uid) && d.notifiedUids.includes(adminGrant.uid) && !d.notifiedUids.includes(adminNoGrant.uid) && !d.notifiedUids.includes(manager.uid));
});
test("rate limit: more than 5 requests a day is refused", async () => {
  const r = await person("spam"); let last;
  for (let i = 0; i < 6; i++) last = await call(r, { action: "request", code: "BZNOPE0" + i });
  assert.equal(last.status, 429);
});

test("who sees and who decides", async () => {
  const r = await person("req2"); await call(r, { action: "request", code });
  assert.equal((await list(manager)).canApprove, false);
  assert.equal((await list(adminNoGrant)).canApprove, false);
  assert.equal((await list(adminGrant)).requests.some((x) => x.id === `${O.uid}_${r.uid}`), true);
  for (const w of [manager, adminNoGrant]) assert.equal((await call(w, { action: "approve", id: `${O.uid}_${r.uid}`, profile: "Staff/Shopkeeper", apps: [] })).status, 403);
  assert.equal((await call(r, { action: "approve", id: `${O.uid}_${r.uid}`, profile: "Staff/Shopkeeper" })).status >= 400, true, "requester cannot approve themselves");
  assert.equal((await call(P, { action: "approve", id: `${O.uid}_${r.uid}`, profile: "Staff/Shopkeeper" })).status, 404, "another company cannot see it");
  assert.equal((await reqDoc(O.uid, r.uid)).data().status, "pending");
});

test("approval: grants only the chosen enabled apps, caps the role, records who decided, single use", async () => {
  const r = await person("req3"); await call(r, { action: "request", code }); const id = `${O.uid}_${r.uid}`;
  assert.equal((await call(adminGrant, { action: "approve", id, profile: "Admin" })).status, 403, "an admin approver cannot create an admin");
  assert.equal((await call(O, { action: "approve", id, profile: "Global Admin" })).status, 403, "nobody creates a Global Admin by join");
  assert.equal((await call(adminGrant, { action: "approve", id, profile: "Staff/Shopkeeper", apps: ["bizzux-attendance"] })).status, 400, "app not enabled for the company");
  assert.equal((await reqDoc(O.uid, r.uid)).data().status, "pending", "failed approval leaves it pending");
  const ok = await call(adminGrant, { action: "approve", id, profile: "Staff/Shopkeeper", apps: ["bizzux-crm"] }); assert.equal(ok.status, 200);
  const m = (await db.doc(`organizationMemberships/${O.uid}_${r.uid}`).get()).data();
  assert.deepEqual([m.role, m.profile, m.status, m.source], ["MEMBER", "Staff/Shopkeeper", "active", "join_request"]);
  assert.equal((await db.doc(`appAssignments/${O.uid}_${r.uid}_bizzux-crm`).get()).data().status, "ACTIVE");
  assert.equal((await db.doc(`appAssignments/${O.uid}_${r.uid}_bizzux-attendance`).get()).exists, false);
  const d = (await reqDoc(O.uid, r.uid)).data(); assert.deepEqual([d.status, d.decidedBy, d.decision], ["approved", adminGrant.uid, "approve"]); assert.ok(d.decidedAt);
  assert.equal((await fa.resolveAccount(r.uid)).accountId, O.uid, "the new member resolves to the company");
  assert.equal((await call(adminGrant, { action: "approve", id, profile: "Staff/Shopkeeper" })).status, 400, "replay refused");
});

test("owner may assign Admin; reject creates nothing", async () => {
  const a = await person("req4"), b = await person("req5");
  await call(a, { action: "request", code }); await call(b, { action: "request", code });
  assert.equal((await call(O, { action: "approve", id: `${O.uid}_${a.uid}`, profile: "Admin" })).status, 200);
  assert.equal((await db.doc(`organizationMemberships/${O.uid}_${a.uid}`).get()).data().role, "ADMIN");
  assert.equal((await call(O, { action: "reject", id: `${O.uid}_${b.uid}` })).status, 200);
  assert.equal((await db.doc(`organizationMemberships/${O.uid}_${b.uid}`).get()).exists, false);
  assert.equal((await reqDoc(O.uid, b.uid)).data().status, "rejected");
  assert.equal((await call(O, { action: "approve", id: `${O.uid}_${b.uid}`, profile: "Staff/Shopkeeper" })).status, 400, "a rejected request cannot be approved later");
});

test("granting members.approve: owner only, Admins only", async () => {
  assert.equal((await call(adminGrant, { action: "grant", userId: adminNoGrant.uid, permission: "members.approve" })).status, 403);
  assert.equal((await call(O, { action: "grant", userId: manager.uid, permission: "members.approve" })).status, 400);
  assert.equal((await call(O, { action: "grant", userId: adminNoGrant.uid, permission: "members.approve" })).status, 200);
  assert.equal((await list(adminNoGrant)).canApprove, true);
  assert.equal((await call(O, { action: "revoke", userId: adminNoGrant.uid, permission: "members.approve" })).status, 200);
  assert.equal((await list(adminNoGrant)).canApprove, false);
});

const search = async (w, q) => route.GET(new Request("http://x/api/join-requests?search=" + encodeURIComponent(q), { headers: w ? { Authorization: "Bearer " + w.token } : {} }));

test("search by name: opt-in only, name + code only, 3+ letters, owner-only switch, request still needs approval", async () => {
  const s = await person("seeker");
  assert.equal((await search(null, "org")).status, 401);
  assert.deepEqual((await (await search(s, "Org")).json()).results, [], "not listed until the Owner opts in");
  assert.equal((await call(adminGrant, { action: "discoverable", value: true })).status, 403, "an approver admin cannot switch it");
  assert.equal((await call(O, { action: "discoverable", value: true })).status, 200);
  assert.deepEqual((await (await search(s, "ab")).json()).results, [], "fewer than 3 letters returns nothing");
  const hit = (await (await search(s, "org o")).json()).results;
  assert.deepEqual(hit, [{ name: "Org O", code }], "only name and code are exposed");
  assert.deepEqual((await (await search(s, "Org P")).json()).results, [], "other company stays unlisted");
  assert.equal((await call(s, { action: "request", code: hit[0].code })).status, 200);
  assert.equal((await reqDoc(O.uid, s.uid)).data().status, "pending", "found does not mean joined");
  assert.equal((await db.doc(`organizationMemberships/${O.uid}_${s.uid}`).get()).exists, false);
  assert.equal((await call(O, { action: "discoverable", value: false })).status, 200);
  assert.deepEqual((await (await search(s, "Org")).json()).results, [], "switching it off hides the company again");
});

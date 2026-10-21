// Provisioned accounts, Phases 2-3 (portal side), on the Auth + Firestore EMULATORS: hashed single-use invitation tokens, usernames unique across the
// portal and Attendance, link requests (the person must accept; no enumeration; seat / entitlement / tenant checks), account expiry at login.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "test@demo-bizzux.iam.gserviceaccount.com" });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run against the emulators only");

const { Timestamp } = await import("firebase-admin/firestore");
const fa = await import("../lib/firebaseAdmin.js");
const { createUsernameUser, usernameLogin } = await import("../lib/usernameAuth.js");
const { newInviteToken, hashInviteToken } = await import("../lib/inviteTokens.js");
const { createOrganization } = await import("../lib/organization.js");
const acceptRoute = await import("../app/api/team/accept/route.js");
const unameRoute = await import("../app/api/admin/username-users/route.js");
const linkRoute = await import("../app/api/link-requests/route.js");
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
const tokenFor = async (uid) => {
  const custom = await fa.adminAuth().createCustomToken(uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  return { uid, token: (await r.json()).idToken };
};
const hdr = (w) => ({ Authorization: "Bearer " + w.token, "Content-Type": "application/json" });
const call = async (fn, w, url, body) => { const r = await fn(new Request("http://x/" + url, body ? { method: "POST", headers: hdr(w), body: JSON.stringify(body) } : { headers: w ? hdr(w) : {} })); let b = null; try { b = await r.json(); } catch { /* none */ } return { status: r.status, body: b }; };

let ownerA, ownerB, platform, outsider, orgA, orgB;
const PW = "Harbour2026x";
before(async () => {
  ownerA = await signIn("paOwnerA-" + rnd() + "@example.test");
  ownerB = await signIn("paOwnerB-" + rnd() + "@example.test");
  platform = await signIn("paPlat-" + rnd() + "@bizzux.test");
  outsider = await signIn("paOut-" + rnd() + "@example.test");
  await db.doc("platformAdmins/" + platform.uid).set({ email: platform.email, role: "ADMIN", status: "active", permissions: null });
  orgA = ownerA.uid; orgB = ownerB.uid;
  for (const [id, name, u] of [[orgA, "Provision Co A", ownerA], [orgB, "Provision Co B", ownerB]]) {
    await createOrganization({ id, name, type: "CUSTOMER", createdBy: id });
    await db.doc("customers/" + id).set({ email: u.email, organizationName: name, status: "active" });
  }
  await db.doc(`organizationAppSubscriptions/${orgA}_bizzux-attendance`).set({ organizationId: orgA, appId: "bizzux-attendance", status: "ACTIVE" });
});

// ---------- invitations ----------
test("invite tokens: only the emailed token works before sign-in, the stored id does not, and an accepted invite cannot be replayed", async () => {
  const invitee = await signIn("paInvitee-" + rnd() + "@example.test");
  const { token, id } = newInviteToken();
  const mem = await db.collection(`customers/${orgA}/team`).add({ email: invitee.email, status: "invited", firstName: "In", lastName: "Vitee" });
  await db.doc("invites/" + id).set({ tokenHashed: true, accountId: orgA, teamMemberId: mem.id, email: invitee.email, profile: "Staff/Shopkeeper", role: "", used: false, expiresAt: Timestamp.fromMillis(Date.now() + 3600e3) });
  assert.equal((await acceptRoute.GET(new Request("http://x/a?invite=" + token))).status, 200);
  assert.equal((await acceptRoute.GET(new Request("http://x/a?invite=" + id))).status, 404, "the stored hash is not a link");
  assert.equal((await acceptRoute.GET(new Request("http://x/a?invite=" + token + "x"))).status, 404);

  const other = await signIn("paWrong-" + rnd() + "@example.test");
  assert.equal((await call(acceptRoute.POST, other, "a", { invite: token })).status, 403, "a different signed-in email is refused");
  assert.equal((await db.doc("invites/" + id).get()).data().used, false, "...and the refusal does not burn the invite");

  const [r1, r2] = await Promise.all([call(acceptRoute.POST, invitee, "a", { invite: token }), call(acceptRoute.POST, invitee, "a", { invite: token })]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 410], "two simultaneous accepts: exactly one wins");
  assert.equal((await call(acceptRoute.POST, invitee, "a", { invite: token })).status, 410, "replay is refused");
  const m = await db.doc(`organizationMemberships/${orgA}_${invitee.uid}`).get();
  assert.equal(m.exists, true);
});

test("expired invites and old-style (raw id) invites", async () => {
  const invitee = await signIn("paInv2-" + rnd() + "@example.test");
  const { token, id } = newInviteToken();
  await db.doc("invites/" + id).set({ tokenHashed: true, accountId: orgA, teamMemberId: "x", email: invitee.email, used: false, expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  assert.equal((await acceptRoute.GET(new Request("http://x/a?invite=" + token))).status, 410);
  const legacy = "legacy-" + rnd();
  await db.doc("invites/" + legacy).set({ accountId: orgA, teamMemberId: "x", email: invitee.email, used: false, expiresAt: Timestamp.fromMillis(Date.now() + 3600e3) });
  assert.equal((await acceptRoute.GET(new Request("http://x/a?invite=" + legacy))).status, 200, "invites sent before this change still work");
});

// ---------- usernames ----------
test("one namespace: a name used by Attendance cannot be created in the portal", async () => {
  const name = "pa.shared." + rnd();
  await db.doc("attUsernames/" + name).set({ username: name, accountId: "someorg", uid: "att_x", status: "active" });
  await assert.rejects(createUsernameUser({ username: name, password: PW, displayName: "X", organizationId: orgA }), (e) => e.status === 409);
  const ok = await createUsernameUser({ username: "pa.free." + rnd(), password: PW, displayName: "Free", organizationId: orgA });
  assert.ok(ok.uid);
});

// ---------- link requests ----------
let person, personName;
test("a company admin requests; the answer is identical whether or not the username exists", async () => {
  personName = "pa.person." + rnd();
  person = await createUsernameUser({ username: personName, password: PW, displayName: "Link Person", organizationId: orgB, mustChangePassword: false });
  const real = await call(unameRoute.POST, ownerA, "u", { action: "requestLink", username: personName, profile: "Staff/Shopkeeper", apps: [] });
  const ghost = await call(unameRoute.POST, ownerA, "u", { action: "requestLink", username: "pa.ghost." + rnd(), profile: "Staff/Shopkeeper", apps: [] });
  assert.equal(real.status, 200); assert.equal(ghost.status, 200);
  assert.deepEqual(real.body, ghost.body, "no way to tell who has an account");
  assert.equal((await db.doc(`organizationMemberships/${orgA}_${person.uid}`).get()).exists, false, "nothing changes until they accept");
});

test("entitlement, tenant and role limits on requests", async () => {
  assert.equal((await call(unameRoute.POST, ownerA, "u", { action: "requestLink", username: personName, apps: ["bizzux-crm"] })).status, 400, "an app the company does not own");
  assert.equal((await call(unameRoute.POST, ownerA, "u", { action: "requestLink", organizationId: orgB, username: personName })).status, 403, "a company admin cannot send requests for another company");
  assert.equal((await call(unameRoute.POST, outsider, "u", { action: "requestLink", username: personName })).status >= 400, true, "a non-admin cannot send requests");
  assert.equal((await call(unameRoute.POST, ownerA, "u", { action: "requestLink", username: "A B" })).status, 400);
});

test("only the named person sees and answers the request", async () => {
  const me = await tokenFor(person.uid);
  const mine = await call(linkRoute.GET, me, "l");
  assert.equal(mine.body.requests.length, 1);
  assert.equal(mine.body.requests[0].organizationName, "Provision Co A");
  const id = mine.body.requests[0].id;
  assert.equal((await call(linkRoute.GET, outsider, "l")).body.requests.length, 0);
  assert.equal((await call(linkRoute.POST, outsider, "l", { id, accept: true })).status, 404, "someone else cannot accept it");
  assert.equal((await call(linkRoute.POST, ownerA, "l", { id, accept: true })).status, 404, "nor can the requesting admin");
  assert.equal((await db.doc(`organizationMemberships/${orgA}_${person.uid}`).get()).exists, false);

  const [a, b] = await Promise.all([call(linkRoute.POST, me, "l", { id, accept: true }), call(linkRoute.POST, me, "l", { id, accept: true })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 410], "a double tap links once");
  assert.equal((await db.doc(`organizationMemberships/${orgA}_${person.uid}`).get()).exists, true);
  const team = (await db.collection(`customers/${orgA}/team`).where("uid", "==", person.uid).get()).size;
  assert.equal(team, 1, "exactly one seat is used");
  assert.equal((await call(linkRoute.GET, me, "l")).body.requests.length, 0);
});

test("declined and expired requests do nothing; the seat limit is rechecked at acceptance", async () => {
  const n1 = "pa.dec." + rnd();
  const p1 = await createUsernameUser({ username: n1, password: PW, displayName: "Decliner", organizationId: orgB, mustChangePassword: false });
  await call(unameRoute.POST, ownerA, "u", { action: "requestLink", username: n1 });
  const t1 = await tokenFor(p1.uid);
  const id1 = (await call(linkRoute.GET, t1, "l")).body.requests[0].id;
  assert.equal((await call(linkRoute.POST, t1, "l", { id: id1, accept: false })).body.status, "declined");
  assert.equal((await db.doc(`organizationMemberships/${orgA}_${p1.uid}`).get()).exists, false);
  assert.equal((await call(linkRoute.POST, t1, "l", { id: id1, accept: true })).status, 410, "a declined request cannot be revived by the person");

  const n2 = "pa.exp." + rnd();
  const p2 = await createUsernameUser({ username: n2, password: PW, displayName: "Late", organizationId: orgB, mustChangePassword: false });
  await call(unameRoute.POST, ownerA, "u", { action: "requestLink", username: n2 });
  const t2 = await tokenFor(p2.uid);
  const id2 = (await call(linkRoute.GET, t2, "l")).body.requests[0].id;
  await db.doc("linkRequests/" + id2).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  assert.equal((await call(linkRoute.GET, t2, "l")).body.requests.length, 0);
  assert.equal((await call(linkRoute.POST, t2, "l", { id: id2, accept: true })).status, 410);

  const n3 = "pa.cap." + rnd();
  const p3 = await createUsernameUser({ username: n3, password: PW, displayName: "Capped", organizationId: orgB, mustChangePassword: false });
  await call(unameRoute.POST, ownerA, "u", { action: "requestLink", username: n3 });
  const t3 = await tokenFor(p3.uid);
  const id3 = (await call(linkRoute.GET, t3, "l")).body.requests[0].id;
  const have = (await db.collection(`customers/${orgA}/team`).count().get()).data().count;
  await db.doc("customers/" + orgA).update({ allowedUsers: have + 1 });
  const r = await call(linkRoute.POST, t3, "l", { id: id3, accept: true });
  assert.equal(r.status, 400); assert.match(r.body.error, /limit/i);
  assert.equal((await db.doc(`organizationMemberships/${orgA}_${p3.uid}`).get()).exists, false, "no seat taken past the limit");
  assert.equal((await db.doc("linkRequests/" + id3).get()).data().status, "pending", "the request stays open so the admin can fix the cause");
  await db.doc("customers/" + orgA).update({ allowedUsers: have + 5 });
  assert.equal((await call(linkRoute.POST, t3, "l", { id: id3, accept: true })).status, 200);
});

test("a Platform Admin can still link directly, with the same duplicate check", async () => {
  const n = "pa.direct." + rnd();
  const p = await createUsernameUser({ username: n, password: PW, displayName: "Direct", organizationId: orgB, mustChangePassword: false });
  assert.equal((await call(unameRoute.POST, platform, "u", { action: "linkUser", username: n, organizationId: orgA, profile: "Staff/Shopkeeper", apps: [] })).status, 200);
  assert.equal((await call(unameRoute.POST, platform, "u", { action: "linkUser", username: n, organizationId: orgA, profile: "Staff/Shopkeeper", apps: [] })).status, 409, "no duplicate membership or seat");
  assert.equal((await call(unameRoute.POST, ownerA, "u", { action: "linkUser", username: n, organizationId: orgA })).status, 403, "a company admin cannot link directly");
});

// ---------- expiry and employment type ----------
test("account expiry and employment type on provisioning; expired logins are refused", async () => {
  const name = "pa.contract." + rnd();
  const yesterday = new Date(Date.now() - 36 * 3600e3).toISOString().slice(0, 10);
  const bad = await call(unameRoute.POST, ownerA, "u", { action: "create", fullName: "C T", username: name, password: PW, accountExpiresAt: "31/12/2026" });
  assert.equal(bad.status, 400);
  const created = await call(unameRoute.POST, ownerA, "u", { action: "create", fullName: "Con Tractor", username: name, password: PW, mustChangePassword: false, employmentType: "Contractor", accountExpiresAt: "2099-12-31", apps: [] });
  assert.equal(created.status, 200);
  const rec = (await db.doc("usernames/" + name).get()).data();
  assert.equal(rec.employmentType, "Contractor"); assert.equal(rec.accountExpiresAt, "2099-12-31");
  assert.ok((await usernameLogin({ username: name, password: PW, ip: "9.9.9." + rnd() })).token);
  const set = await call(unameRoute.POST, ownerA, "u", { action: "setExpiry", uid: created.body.uid, accountExpiresAt: yesterday });
  assert.equal(set.status, 200);
  await assert.rejects(usernameLogin({ username: name, password: PW, ip: "9.9.9." + rnd() }), (e) => e.status === 403 && /expired/i.test(e.message));
  assert.equal((await call(unameRoute.POST, ownerB, "u", { action: "setExpiry", uid: created.body.uid, accountExpiresAt: "" })).status, 403, "another company's admin cannot change it");
  await call(unameRoute.POST, ownerA, "u", { action: "setExpiry", uid: created.body.uid, accountExpiresAt: "" });
  assert.ok((await usernameLogin({ username: name, password: PW, ip: "9.9.9." + rnd() })).token, "clearing the date restores access");
  const audit = (await db.collection("auditLogs").where("targetId", "==", created.body.uid).get()).docs.map((d) => d.data().action);
  assert.ok(audit.includes("user.set_expiry") && audit.includes("user.create_username"));
});

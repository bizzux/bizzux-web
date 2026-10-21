// Cross-app: the REAL Attendance IAM client (bizzux-attendance/lib/iamClient.js) against the REAL portal routes, on the emulators, in one process.
// Only the network hop is simulated (fetch to IAM_SERVICE_ORIGIN is dispatched to the route handlers). Synthetic companies only.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run against the emulators only");
process.env.IAM_SERVICE_ORIGIN = "http://iam.test";

const fa = await import("../lib/firebaseAdmin.js");
const routes = {
  "/api/iam/identities": await import("../app/api/iam/identities/route.js"),
  "/api/auth/username-login": await import("../app/api/auth/username-login/route.js"),
  "/api/auth/username-set-password": await import("../app/api/auth/username-set-password/route.js"),
  "/api/auth/username-recover": await import("../app/api/auth/username-recover/route.js"),
};
const client = await import("../../bizzux-attendance/lib/iamClient.js");
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.origin !== "http://iam.test") return realFetch(url, init);
  const handler = routes[u.pathname]?.[(init.method || "GET").toUpperCase()];
  assert.ok(handler, "no route for " + u.pathname);
  return handler(new Request(String(url), init));
};
const db = fa.adminDb();
const RUN = Math.random().toString(36).slice(2, 7);
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const post = async (p, b) => (await realFetch(`${AUTH}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function person(label) {
  const u = await fa.adminAuth().createUser({ email: `${label}-${RUN}@x.test`, emailVerified: true, password: "Passw0rd-" + RUN, displayName: label });
  return { uid: u.uid, token: (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(u.uid), returnSecureToken: true })).idToken };
}
const un = (s) => `${s}${RUN}`;
let owner, other, staff, made;
before(async () => {
  owner = await person("attOwner"); other = await person("otherOwner"); staff = await person("attStaff");
  await db.doc("customers/" + owner.uid).set({ status: "active", organizationName: "Att Co" });
  await db.doc(`organizationMemberships/${owner.uid}_${owner.uid}`).set({ organizationId: owner.uid, userId: owner.uid, role: "OWNER", status: "active" });
  await db.doc("customers/" + other.uid).set({ status: "active", organizationName: "No Att Co" });
  await db.doc(`organizationMemberships/${other.uid}_${other.uid}`).set({ organizationId: other.uid, userId: other.uid, role: "OWNER", status: "active" });
  await db.doc(`organizationAppSubscriptions/${owner.uid}_bizzux-attendance`).set({ organizationId: owner.uid, appId: "bizzux-attendance", status: "ACTIVE" });
  await db.doc("memberships/" + staff.uid).set({ accountId: owner.uid, profile: "Staff/Shopkeeper" });
  await db.doc(`organizationMemberships/${owner.uid}_${staff.uid}`).set({ organizationId: owner.uid, userId: staff.uid, role: "MEMBER", profile: "Staff/Shopkeeper", status: "active" });
});

test("flag: the client is off without IAM_SERVICE_ORIGIN", () => {
  assert.equal(client.iamEnabled(), true);
  const saved = process.env.IAM_SERVICE_ORIGIN; delete process.env.IAM_SERVICE_ORIGIN;
  assert.equal(client.iamEnabled(), false); process.env.IAM_SERVICE_ORIGIN = saved;
});

test("username availability comes from the one platform namespace", async () => {
  assert.equal((await client.iamCheckUsername(owner.token, un("meera"))).ok, true);
  await db.doc("attUsernames/" + un("old")).set({ accountId: owner.uid, uid: "att_1" });
  assert.equal((await client.iamCheckUsername(owner.token, un("old"))).ok, false, "legacy Attendance name is taken");
  await assert.rejects(client.iamCheckUsername(staff.token, un("x")), (e) => e.status === 403, "a non-admin cannot probe names");
});

test("create from Attendance: same identity appears in the central directory with Attendance access", async () => {
  made = await client.iamCreateUsername(owner.token, { fullName: "Meera K", username: un("meera") });
  assert.ok(made.uid && made.password);
  assert.equal((await db.doc(`appAssignments/${owner.uid}_${made.uid}_bizzux-attendance`).get()).data().status, "ACTIVE");
  const dir = await realDirectory(owner);
  assert.ok(dir.users.find((u) => u.uid === made.uid && u.loginKind === "username" && u.apps.includes("bizzux-attendance")), "visible in Central IAM");
  assert.equal((await db.collection("attUsernames").where("uid", "==", made.uid).get()).size, 0, "no second identity store was written");
});
async function realDirectory(w) {
  const dir = await import("../app/api/iam/directory/route.js");
  return (await dir.GET(new Request("http://x/api/iam/directory", { headers: { Authorization: "Bearer " + w.token } }))).json();
}

test("licence and tenant: a company without Attendance cannot grant it; a non-admin cannot create", async () => {
  await assert.rejects(client.iamCreateUsername(other.token, { fullName: "Z", username: un("nolic") }), (e) => e.status === 400 && /Not enabled/.test(e.message));
  assert.equal((await db.doc("usernames/" + un("nolic")).get()).exists, false);
  await assert.rejects(client.iamCreateUsername(staff.token, { fullName: "Z", username: un("staffmade") }), (e) => e.status === 403);
});

test("sign-in relay: temporary password forces a new one; wrong answers are refused; recovery codes shown once", async () => {
  const u = un("meera");
  await assert.rejects(client.iamUsernameSignIn({ action: "login", username: u, password: "wrong" }), (e) => e.status === 401);
  assert.deepEqual(await client.iamUsernameSignIn({ action: "login", username: u, password: made.password }), { mustChange: true });
  await assert.rejects(client.iamUsernameSignIn({ action: "change", username: u, password: "wrong", newPassword: "Better-Pass-77" }), (e) => e.status === 401);
  assert.equal((await db.doc("usernames/" + u).get()).data().mustChangePassword, true, "a wrong current password changed nothing");
  await assert.rejects(client.iamUsernameSignIn({ action: "activate", username: u, code: made.password, newPassword: made.password }), (e) => e.status === 400);
  const act = await client.iamUsernameSignIn({ action: "activate", username: u, code: made.password, newPassword: "Better-Pass-77" });
  assert.ok(act.token && act.recoveryCodes?.length >= 8, "token and one-time recovery codes");
  const again = await client.iamUsernameSignIn({ action: "login", username: u, password: "Better-Pass-77" });
  assert.ok(again.token && !again.mustChange);
  await assert.rejects(client.iamUsernameSignIn({ action: "login", username: u, password: made.password }), (e) => e.status === 401, "old temporary password is dead");
  const signedIn = (await post("accounts:signInWithCustomToken", { token: again.token, returnSecureToken: true })).idToken;
  assert.ok(signedIn, "the token is a real Firebase sign-in for the same uid");
  const rec = await client.iamUsernameSignIn({ action: "recover", username: u, code: act.recoveryCodes[0], newPassword: "Another-Pass-88" });
  assert.ok(rec.token);
  await assert.rejects(client.iamUsernameSignIn({ action: "recover", username: u, code: act.recoveryCodes[0], newPassword: "Third-Pass-99" }), (e) => e.status >= 400, "a recovery code works once");
});

test("suspension ends sign-in everywhere", async () => {
  const u = un("meera");
  await fa.adminAuth().updateUser(made.uid, { disabled: true });
  await assert.rejects(client.iamUsernameSignIn({ action: "login", username: u, password: "Another-Pass-88" }), (e) => e.status === 403);
});

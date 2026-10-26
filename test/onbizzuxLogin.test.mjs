// Final login ID standard (firstname@onbizzux.com): create 2 users per app through the central IAM service, then sign in once as each. Emulators only.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run against the emulators only");

const fa = await import("../lib/firebaseAdmin.js");
const ids = await import("../app/api/iam/identities/route.js");
const login = await import("../app/api/auth/username-login/route.js");
const access = await import("../lib/appAccess.js");
const { slugName, isBizzuxId, toLoginId } = await import("../lib/loginId.js");
const att = await import("../../bizzux-attendance/lib/attUsername.js");
const db = fa.adminDb();
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const post = async (p, b) => (await fetch(`${AUTH}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
const RUN = Math.random().toString(36).slice(2, 6);
let owner, hdr;
before(async () => {
  const u = await fa.adminAuth().createUser({ email: `own-${RUN}@x.test`, emailVerified: true, displayName: "Owner" });
  owner = u.uid;
  const tok = (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(owner), returnSecureToken: true })).idToken;
  hdr = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  await db.doc("customers/" + owner).set({ status: "active", organizationName: "Test Org" });
  await db.doc(`organizationMemberships/${owner}_${owner}`).set({ organizationId: owner, userId: owner, role: "OWNER", status: "active" });
  for (const a of ["bizzux-attendance", "bizzux-crm", "bizzux-projects", "bizzux-pos"]) await db.doc(`organizationAppSubscriptions/${owner}_${a}`).set({ organizationId: owner, appId: a, status: "ACTIVE" });
});

const CASES = [
  ["Admin Center", null, [["Meera", "Nair"], ["Meera", "Iyer"]]],
  ["Attendance", "bizzux-attendance", [["Karthik", "Rao"], ["Divya", "Menon"]]],
  ["CRM", "bizzux-crm", [["Farhan", "Ali"], ["Sneha", "Pillai"]]],
  ["Projects", "bizzux-projects", [["Vikram", "Shah"], ["Anita", "Das"]]],
  ["POS", "bizzux-pos", [["Rohan", "Kapoor"], ["Leela", "Joshi"]]],
];
const results = [];
for (const [appName, appId, people] of CASES) {
  test(`${appName}: 2 users created centrally, 2 sign-ins`, async () => {
    const row = [];
    for (const [first, last] of people) {
      let username = slugName(first);
      const chk = await (await ids.GET(new Request(`http://x/api/iam/identities?checkUsername=${username}&last=${last}`, { headers: hdr }))).json();
      let suggestion = "";
      if (!chk.ok) { suggestion = chk.suggestion; username = chk.suggestion; }
      const r = await ids.POST(new Request("http://x/api/iam/identities", { method: "POST", headers: hdr, body: JSON.stringify({ kind: "username", fullName: `${first} ${last}`, username, apps: appId ? [appId] : [], profile: "Staff/Shopkeeper" }) }));
      assert.equal(r.status, 200, await r.clone().text());
      const c = await r.json();
      const loginId = toLoginId(c.username);
      assert.match(loginId, /^[a-z0-9.]+@onbizzux\.com$/);
      assert.ok(isBizzuxId(loginId));
      // sign out of admin = a fresh anonymous request; sign in as the new user with the generated ID + password
      const lr = await login.POST(new Request("http://x/api/auth/username-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: loginId, password: c.password }) }));
      const ld = await lr.json();
      assert.equal(lr.status, 200, JSON.stringify(ld));
      const sess = await post("accounts:signInWithCustomToken", { token: ld.token, returnSecureToken: true });
      assert.ok(sess.idToken, JSON.stringify(sess));
      const who = (await post("accounts:lookup", { idToken: sess.idToken })).users[0];
      assert.equal(who.localId, c.uid, "signed in as the account that was created");
      assert.equal(who.displayName, `${first} ${last}`);
      const m = (await db.doc(`organizationMemberships/${owner}_${c.uid}`).get()).data();
      assert.equal(m.status, "active");
      if (appId) assert.equal((await db.doc(`appAssignments/${owner}_${c.uid}_${appId}`).get()).data().status, "ACTIVE", "authorized for the app");
      else assert.notEqual(m.role, "OWNER"); // no admin privilege granted to pass the test
      // the legacy and bare forms resolve to the same account
      const bare = await login.POST(new Request("http://x/api/auth/username-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: c.username + "@bizzux", password: c.password }) }));
      assert.equal(bare.status, 200);
      row.push(`${loginId}${suggestion ? " (suggested after clash)" : ""}`);
    }
    results.push([appName, row]);
  });
}
test("Attendance sign-in recognises @onbizzux.com; slug/suggestions", () => {
  assert.equal(att.cleanUsername("Rajthilak@OnBizzux.com"), "rajthilak");
  assert.equal(att.cleanUsername("rajthilak@bizzux"), "rajthilak");
  assert.equal(slugName("Rajthilak"), "rajthilak");
  assert.equal(isBizzuxId("a@gmail.com"), false);
});
test("wrong password is refused", async () => {
  const r = await login.POST(new Request("http://x/api/auth/username-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "meera@onbizzux.com", password: "nope" }) }));
  assert.equal(r.status, 401);
});
test("summary", () => { console.log(JSON.stringify(results, null, 1)); });

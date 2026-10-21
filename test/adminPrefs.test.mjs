// Choose columns: shared catalogue rules (pure) and the per-administrator preference route on the emulators.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run against the emulators only");

const cols = await import("../lib/adminColumns.js");
const fa = await import("../lib/firebaseAdmin.js");
const route = await import("../app/api/iam/prefs/route.js");
const db = fa.adminDb();
const RUN = Math.random().toString(36).slice(2, 7);
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const post = async (p, b) => (await fetch(`${AUTH}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function person(label) {
  const u = await fa.adminAuth().createUser({ email: `${label}-${RUN}@x.test`, emailVerified: true, displayName: label });
  return { uid: u.uid, token: (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(u.uid), returnSecureToken: true })).idToken };
}
const hdr = (w) => ({ ...(w ? { Authorization: "Bearer " + w.token } : {}), "Content-Type": "application/json" });
const get = (w) => route.GET(new Request("http://x/api/iam/prefs", { headers: hdr(w) }));
const put = (w, body) => route.PUT(new Request("http://x/api/iam/prefs", { method: "PUT", headers: hdr(w), body: JSON.stringify(body) }));

test("catalogue rules: locked column always on, catalogue order, unknown names dropped, bad input falls back to default", () => {
  assert.deepEqual(cols.cleanColumns(["status", "name", "created"]), ["name", "status", "created"], "ordered by the catalogue, not by input");
  assert.deepEqual(cols.cleanColumns(["status"]), ["name", "status"], "name is always included");
  assert.deepEqual(cols.cleanColumns(["status", "passwordHash", "__proto__", 5, null]), ["name", "status"], "unknown names are dropped");
  for (const bad of [undefined, null, "x", {}, [], ["nonsense"]]) assert.deepEqual(cols.cleanColumns(bad), cols.DEFAULT_COLUMNS, JSON.stringify(bad));
  assert.ok(cols.DEFAULT_COLUMNS[0] === "name" && cols.DEFAULT_COLUMNS.includes("orgRole"));
  for (const c of cols.USER_COLUMNS) assert.ok(!/password|hash|token|secret|recovery|mobile|address|ip/i.test(c.key + c.label) || c.key === "apps", "no sensitive column: " + c.key);
});

let A, B, member, orgA;
before(async () => {
  A = await person("adminA"); B = await person("adminB"); member = await person("member");
  orgA = A.uid;
  await db.doc("customers/" + A.uid).set({ status: "active" });
  await db.doc("customers/" + B.uid).set({ status: "active" });
  await db.doc("memberships/" + member.uid).set({ accountId: orgA, profile: "Staff/Shopkeeper" });
});

test("anonymous 401, non-admin 403", async () => {
  assert.equal((await get(null)).status, 401);
  assert.equal((await put(member, { activeUsers: { columns: ["name"] } })).status, 403);
  assert.equal((await get(member)).status, 403);
});

test("an administrator saves, reads back, resets; invalid input is sanitised server-side", async () => {
  const first = await (await get(A)).json();
  assert.deepEqual(first.activeUsers.columns, cols.DEFAULT_COLUMNS, "new admin starts on the default");
  assert.ok(first.catalog.some((c) => c.key === "name" && c.locked));
  const saved = await (await put(A, { activeUsers: { columns: ["created", "status", "department", "evil", "name"] } })).json();
  assert.deepEqual(saved.activeUsers.columns, ["name", "status", "created", "department"]);
  assert.deepEqual((await (await get(A)).json()).activeUsers.columns, ["name", "status", "created", "department"]);
  const stored = (await db.doc("users/" + A.uid).get()).data().adminPrefs.activeUsers;
  assert.deepEqual(stored.columns, ["name", "status", "created", "department"], "what is stored is the sanitised list");
  assert.ok(!JSON.stringify(stored).includes("evil"));
  await put(A, { activeUsers: { columns: "nonsense" } });
  assert.deepEqual((await (await get(A)).json()).activeUsers.columns, cols.DEFAULT_COLUMNS, "garbage becomes the default, never an error or a partial list");
  await put(A, { activeUsers: { columns: ["status", "created"] } });
  const r = await (await put(A, { reset: true })).json();
  assert.deepEqual(r.activeUsers.columns, cols.DEFAULT_COLUMNS);
  assert.deepEqual((await (await get(A)).json()).activeUsers.columns, cols.DEFAULT_COLUMNS);
});

test("preferences belong to the caller only: another administrator is unaffected and a uid in the body is ignored", async () => {
  await put(A, { activeUsers: { columns: ["status", "employeeId"] } });
  assert.deepEqual((await (await get(B)).json()).activeUsers.columns, cols.DEFAULT_COLUMNS);
  await put(B, { uid: A.uid, userId: A.uid, activeUsers: { columns: ["created"] } });
  assert.deepEqual((await (await get(A)).json()).activeUsers.columns, ["name", "status", "employeeId"], "A unchanged by B's request");
  assert.deepEqual((await (await get(B)).json()).activeUsers.columns, ["name", "created"]);
});

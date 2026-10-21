// Contacts: a record with no login. Authorization, tenant scope, validation, de-duplication, audit. Emulators, real route.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run against the emulators only");

const fa = await import("../lib/firebaseAdmin.js");
const route = await import("../app/api/iam/contacts/route.js");
const db = fa.adminDb();
const RUN = Math.random().toString(36).slice(2, 7);
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const post = async (p, b) => (await fetch(`${AUTH}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function person(label) {
  const u = await fa.adminAuth().createUser({ email: `${label}-${RUN}@x.test`, emailVerified: true, displayName: label });
  return { uid: u.uid, token: (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(u.uid), returnSecureToken: true })).idToken };
}
const hdr = (w) => ({ ...(w ? { Authorization: "Bearer " + w.token } : {}), "Content-Type": "application/json" });
const call = (m, w, body) => route[m](new Request("http://x/api/iam/contacts", { method: m, headers: hdr(w), body: body ? JSON.stringify(body) : undefined }));
let A, B, mem;
before(async () => {
  A = await person("ownerA"); B = await person("ownerB"); mem = await person("mem");
  for (const w of [A, B]) { await db.doc("customers/" + w.uid).set({ status: "active" }); }
  await db.doc("memberships/" + mem.uid).set({ accountId: A.uid, profile: "Staff/Shopkeeper" });
});

test("create, list, update, delete; validation and duplicate protection", async () => {
  assert.equal((await call("POST", A, { name: "" })).status, 400);
  assert.equal((await call("POST", A, { name: "Sup", email: "nope" })).status, 400);
  const c = await (await call("POST", A, { name: "Supplier One", email: "Sup@Example.com", phone: "123", company: "Acme Supplies" })).json();
  assert.ok(c.id);
  assert.equal((await call("POST", A, { name: "Dup", email: "sup@example.com" })).status, 409, "same email in the same company");
  const list = await (await call("GET", A)).json();
  assert.deepEqual(list.contacts.map((x) => [x.name, x.email]), [["Supplier One", "sup@example.com"]]);
  assert.equal((await call("PUT", A, { id: c.id, name: "Supplier 1", email: "sup@example.com" })).status, 200);
  assert.equal((await (await call("GET", A)).json()).contacts[0].name, "Supplier 1");
  assert.equal((await call("PUT", A, { id: "missing", name: "X" })).status, 404);
  assert.equal((await call("DELETE", A, { id: c.id })).status, 200);
  assert.equal((await (await call("GET", A)).json()).contacts.length, 0);
  const aud = await db.collection("auditLogs").where("action", "in", ["contact.create", "contact.update", "contact.delete"]).get();
  assert.ok(aud.size >= 3, "audited");
});

test("a contact is never an identity: no login, membership or app access is created", async () => {
  const users = (await fa.adminAuth().listUsers(1000)).users.length;
  const mems = (await db.collection("organizationMemberships").get()).size;
  await call("POST", A, { name: "No Login", email: "nologin@example.com" });
  assert.equal((await fa.adminAuth().listUsers(1000)).users.length, users);
  assert.equal((await db.collection("organizationMemberships").get()).size, mems);
  assert.equal((await db.collection("appAssignments").where("userId", "==", "nologin@example.com").get()).size, 0);
});

test("authorization and tenant isolation", async () => {
  assert.equal((await call("GET", null)).status, 401);
  assert.equal((await call("GET", mem)).status, 403);
  assert.equal((await call("POST", mem, { name: "X" })).status, 403);
  const mine = await (await call("POST", A, { name: "Only A", email: "onlya@example.com" })).json();
  assert.equal((await (await call("GET", B)).json()).contacts.length, 0, "company B sees none of A's contacts");
  assert.equal((await call("GET", B)).status, 200);
  assert.equal((await call("DELETE", B, { id: mine.id })).status, 404, "B cannot delete A's contact");
  assert.equal((await call("PUT", B, { id: mine.id, name: "Hijack" })).status, 404, "B cannot edit it");
  assert.equal((await call("POST", B, { name: "Evil", organizationId: A.uid })).status, 403, "naming another company is refused");
  assert.equal((await (await call("GET", A)).json()).contacts.find((x) => x.id === mine.id).name, "Only A");
});

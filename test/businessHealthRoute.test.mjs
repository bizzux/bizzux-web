// Route-level tests (emulator): access control, validation, audit trail, legacy migration.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "test@demo-bizzux.iam.gserviceaccount.com" });
process.env.PLATFORM_OWNER_EMAIL = "owner-bh@bizzux.test";
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run via firebase emulators:exec");

const fa = await import("../lib/firebaseAdmin.js");
const route = await import("../app/api/admin/business-health/route.js");
const db = fa.adminDb();
const rnd = () => Math.random().toString(36).slice(2, 8);
async function signIn(email) {
  const u = await fa.adminAuth().createUser({ email, password: "Passw0rd-" + rnd() });
  const custom = await fa.adminAuth().createCustomToken(u.uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  return { uid: u.uid, email, token: (await r.json()).idToken };
}
const post = async (who, body) => { const r = await route.POST(new Request("http://localhost/x", { method: "POST", headers: { Authorization: "Bearer " + who.token, "Content-Type": "application/json" }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const get = async (who) => { const r = await route.GET(new Request("http://localhost/x", { headers: { Authorization: "Bearer " + who.token } })); return { status: r.status, body: await r.json() }; };
const audits = async (action) => (await db.collection("auditLogs").where("action", "==", action).get()).docs.length;

let owner, admin, nobody;
before(async () => {
  owner = await signIn("owner-bh@bizzux.test");
  await db.doc("platformAdmins/" + owner.uid).set({ email: owner.email, role: "OWNER", status: "active", permissions: null });
  admin = await signIn("bhadmin-" + rnd() + "@bizzux.test");
  await db.doc("platformAdmins/" + admin.uid).set({ email: admin.email, role: "ADMIN", status: "active", permissions: null });
  nobody = await signIn("bhnone-" + rnd() + "@example.test");
});

test("empty state: nothing configured -> cost/profit null, not 0", async () => {
  const r = await get(owner);
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.totalMonthlyCost, null);
  assert.equal(r.body.summary.monthlyProfit, null);
  assert.ok(r.body.dataQuality.length > 0);
});

test("access: admins can view, only the owner can write, strangers get nothing", async () => {
  assert.equal((await get(admin)).status, 200);
  assert.equal((await post(admin, { action: "saveExpense", label: "x", category: "other", cadence: "monthly", amount: 5, startDate: "2026-01-01" })).status, 403);
  assert.equal((await get(nobody)).status, 403);
  assert.equal((await post(nobody, { action: "saveExpense" })).status, 403);
});

test("owner writes are validated, counted, archived and audited", async () => {
  assert.equal((await post(owner, { action: "saveExpense", label: "", category: "other", cadence: "monthly", amount: 5, startDate: "2026-01-01" })).status, 400);
  assert.equal((await post(owner, { action: "saveExpense", label: "Dev salary", category: "employees", cadence: "monthly", amount: 40000, startDate: "2026-01-01" })).status, 200);
  const dep = await post(owner, { action: "saveCapital", label: "Office deposit", type: "deposit", amount: 60000, date: "2026-02-01" });
  assert.equal(dep.status, 200);
  assert.equal((await post(owner, { action: "addCash", balance: 500000, date: "2026-10-01" })).status, 200);
  let r = (await get(owner)).body;
  assert.equal(r.summary.totalMonthlyCost >= 40000, true);
  assert.equal(r.capital.depositsHeld, 60000);
  assert.equal(r.summary.monthlyProfit < 0, true, "deposit must not be treated as an expense");
  assert.equal(r.summary.runwayState, "finite");
  await post(owner, { action: "refundDeposit", id: dep.body.id, refundedOn: "2026-10-05" });
  r = (await get(owner)).body;
  assert.equal(r.capital.depositsHeld, 0);
  assert.equal(r.capital.depositsRefunded, 60000);
  const id = r.expenses[0].id;
  await post(owner, { action: "archiveExpense", id });
  assert.equal((await get(owner)).body.summary.totalMonthlyCost, null, "archived expense stops counting");
  assert.ok(await audits("businessHealth.expense.create") >= 1);
  assert.ok(await audits("businessHealth.expense.archive") >= 1);
  assert.ok(await audits("businessHealth.deposit.refund") >= 1);
});

test("legacy costs: shown as pending, imported once with a category, legacy doc kept", async () => {
  await db.doc("platformFinance/costs").set({ recurring: [{ label: "Rent", amount: 15000 }], oneTime: [{ label: "Laptop", amount: 90000 }], assumedAvgRevenue: 1200 });
  let r = (await get(owner)).body;
  assert.equal(r.legacyPending.recurring.length, 1);
  assert.equal((await post(owner, { action: "importLegacy", rows: [{ source: "recurring", index: 0 }] })).status, 400, "category required");
  const ok = await post(owner, { action: "importLegacy", rows: [{ source: "recurring", index: 0, category: "office" }, { source: "oneTime", index: 0 }] });
  assert.equal(ok.status, 200);
  r = (await get(owner)).body;
  assert.equal(r.legacyPending, null);
  assert.equal(r.opex.byCategory.office.total, 15000);
  assert.equal(r.capital.invested, 90000);
  assert.equal(r.settings.assumedArpa, 1200);
  assert.equal((await post(owner, { action: "importLegacy", rows: [] })).status, 409, "no double import");
  assert.equal((await db.doc("platformFinance/costs").get()).data().recurring.length, 1, "legacy record untouched");
});

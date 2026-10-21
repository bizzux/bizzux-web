// The shared profile menu: pure persona matrix and the real route on the emulators.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { shapeMenu, MENU_APPS } from "../lib/shell/menuModel.js";
import { effectiveOrgRole } from "../lib/authz/policy.js";

const sub = (extra = {}) => ({ status: "ACTIVE", subscriptionType: "PAID", ...extra });
const ASG = (role = "MEMBER", status = "ACTIVE") => ({ status, role });
const allSubs = Object.fromEntries(MENU_APPS.map((a) => [a.appId, sub()]));
const keys = (m) => m.apps.map((a) => a.key).sort();
const base = { person: { name: "Pat Person", email: "pat@x.test" }, organization: { id: "o1", name: "Org One" }, subscriptions: allSubs, membership: { status: "active" } };
const subject = (profile, canonical) => ({ ...effectiveOrgRole({ profile, canonical }), permissions: canonical?.permissions || [] });

test("persona matrix (pure): Employee, Manager, Attendance Admin, Org Admin, Owner", () => {
  const att = { "bizzux-attendance": ASG("MEMBER") }, crm = { "bizzux-crm": ASG("MEMBER") };
  const employee = shapeMenu({ ...base, orgSubject: subject("Staff/Shopkeeper"), assignments: att });
  assert.deepEqual(keys(employee), ["attendance"], "only apps they can open");
  assert.deepEqual([employee.admin.show, employee.addEmployee.central], [false, false]);
  const manager = shapeMenu({ ...base, orgSubject: subject("Manager"), assignments: { ...att, ...crm } });
  assert.deepEqual(keys(manager), ["attendance", "crm"]);
  assert.deepEqual([manager.admin.show, manager.addEmployee.central], [false, false]);
  const attAdmin = shapeMenu({ ...base, orgSubject: subject("Staff/Shopkeeper"), assignments: { "bizzux-attendance": ASG("ADMIN") } });
  assert.equal(attAdmin.apps[0].appRole, "ADMIN");
  assert.deepEqual([attAdmin.admin.show, attAdmin.addEmployee.central], [false, false], "an app admin is not an organization admin");
  const orgAdmin = shapeMenu({ ...base, orgSubject: subject("Admin"), assignments: att });
  assert.deepEqual([orgAdmin.admin.show, orgAdmin.admin.role, orgAdmin.addEmployee.central], [true, "ADMIN", true]);
  const orgAdminExplicit = shapeMenu({ ...base, orgSubject: subject("Staff/Shopkeeper", { role: "ADMIN", roleSource: "explicit", status: "active" }), assignments: {} });
  assert.deepEqual([orgAdminExplicit.admin.show, keys(orgAdminExplicit)], [true, []], "organization admin power does not grant app access");
  const owner = shapeMenu({ ...base, orgSubject: subject("Admin", null), subscriptions: allSubs, assignments: {}, membership: undefined });
  const ownerSubject = { role: "OWNER", source: "owner", active: true, permissions: [] };
  const o = shapeMenu({ ...base, orgSubject: ownerSubject, assignments: {} });
  assert.equal(o.admin.role, "OWNER"); assert.equal(o.apps.length, MENU_APPS.length, "the owner is offered every app the company holds");
  assert.equal(shapeMenu({ ...base, orgSubject: ownerSubject, assignments: {}, subscriptions: { "bizzux-crm": sub() } }).apps.length, 1, "...and no app it does not hold");
  assert.equal(shapeMenu({ ...base, orgSubject: ownerSubject, assignments: {}, subscriptions: {} }).apps.length, MENU_APPS.length, "legacy company with no licence records at all");
  assert.ok(owner.admin.show);
});

test("only openable apps are offered: unlicensed, unassigned, revoked, suspended, expired states", () => {
  const m = (over) => shapeMenu({ ...base, orgSubject: subject("Staff/Shopkeeper"), assignments: { "bizzux-crm": ASG() }, ...over });
  assert.deepEqual(keys(m({})), ["crm"]);
  assert.deepEqual(keys(m({ subscriptions: { ...allSubs, "bizzux-crm": sub({ status: "INACTIVE" }) } })), [], "licence switched off");
  assert.deepEqual(keys(m({ assignments: { "bizzux-crm": ASG("MEMBER", "INACTIVE") } })), [], "assignment revoked");
  assert.deepEqual(keys(m({ membership: { status: "suspended" } })), [], "suspended");
  assert.deepEqual(keys(m({ subscriptions: {} })), [], "no licence record");
});

test("current app is flagged; a person with no company gets only who they are; viewers and suspended organization admins get no Admin Center", () => {
  const cur = shapeMenu({ ...base, orgSubject: subject("Staff/Shopkeeper"), assignments: { "bizzux-crm": ASG() }, currentApp: "crm" });
  assert.equal(cur.apps[0].current, true);
  const none = shapeMenu({ person: { name: "No Company", email: "n@x.test" } });
  assert.deepEqual([none.apps, none.admin.show, none.organization, none.person.initials], [[], false, null, "NC"]);
  assert.equal(shapeMenu({ ...base, orgSubject: subject("Viewer/Auditor"), assignments: {} }).admin.show, false);
  assert.equal(shapeMenu({ ...base, orgSubject: subject("Admin", { role: "ADMIN", status: "suspended" }), assignments: {} }).admin.show, false, "suspended membership has no organization authority");
  assert.equal(shapeMenu({ ...base, orgSubject: subject("Admin"), assignments: {}, isPlatform: true }).admin.show, false, "platform staff use the support flow, not the menu");
});

// ---- the real route ----
process.env.GCLOUD_PROJECT = "demo-bizzux";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
const emu = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST;
const fa = emu ? await import("../lib/firebaseAdmin.js") : null;
const route = emu ? await import("../app/api/shell/menu/route.js") : null;
const RUN = Math.random().toString(36).slice(2, 7);
const AUTH = emu ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1` : "";
const post = async (p, b) => (await fetch(`${AUTH}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function person(label) { const u = await fa.adminAuth().createUser({ email: `${label}-${RUN}@x.test`, emailVerified: true, displayName: label }); return { uid: u.uid, token: (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(u.uid), returnSecureToken: true })).idToken }; }
const get = async (w, q = "") => route.GET(new Request("http://x/api/shell/menu" + q, { headers: w ? { Authorization: "Bearer " + w.token } : {} }));
let O, emp, adm, att, stranger, db;
before(async () => {
  if (!emu) return;
  db = fa.adminDb();
  O = await person("owner"); emp = await person("emp"); adm = await person("adm"); att = await person("attadmin"); stranger = await person("stranger");
  await db.doc("customers/" + O.uid).set({ status: "active", organizationName: "Menu Co" });
  await db.doc(`organizationMemberships/${O.uid}_${O.uid}`).set({ organizationId: O.uid, userId: O.uid, role: "OWNER", status: "active" });
  for (const a of ["attendance", "crm", "projects"]) await db.doc(`organizationAppSubscriptions/${O.uid}_bizzux-${a}`).set({ organizationId: O.uid, appId: "bizzux-" + a, status: "ACTIVE" });
  const mk = async (w, profile, apps) => {
    await db.doc("memberships/" + w.uid).set({ accountId: O.uid, profile });
    await db.doc(`organizationMemberships/${O.uid}_${w.uid}`).set({ organizationId: O.uid, userId: w.uid, role: "MEMBER", status: "active" });
    for (const [a, role] of apps) await db.doc(`appAssignments/${O.uid}_${w.uid}_bizzux-${a}`).set({ organizationId: O.uid, userId: w.uid, appId: "bizzux-" + a, role, status: "ACTIVE" });
  };
  await mk(emp, "Staff/Shopkeeper", [["attendance", "MEMBER"]]); await mk(adm, "Admin", [["attendance", "MEMBER"], ["crm", "MEMBER"]]); await mk(att, "Staff/Shopkeeper", [["attendance", "ADMIN"]]);
});

test("route: anonymous 401; each persona gets exactly its menu; a stranger gets a minimal menu; revocation is visible after the cache window", { skip: !emu }, async () => {
  assert.equal((await get(null)).status, 401);
  const j = async (w, q) => (await get(w, q)).json();
  const e = await j(emp, "?app=attendance");
  assert.deepEqual([e.apps.map((a) => a.key), e.admin.show, e.addEmployee.central, e.apps[0].current, e.organization.name], [["attendance"], false, false, true, "Menu Co"]);
  const a = await j(adm); assert.deepEqual([a.apps.map((x) => x.key).sort(), a.admin.show, a.admin.role, a.addEmployee.central], [["attendance", "crm"], true, "ADMIN", true]);
  const t = await j(att); assert.deepEqual([t.apps[0].appRole, t.admin.show, t.addEmployee.central], ["ADMIN", false, false]);
  const o = await j(O); assert.deepEqual([o.admin.role, o.apps.length], ["OWNER", 3]);
  const s = await j(stranger); assert.deepEqual([s.apps, s.admin.show, s.organization], [[], false, null]);
  await db.doc(`appAssignments/${O.uid}_${emp.uid}_bizzux-attendance`).set({ status: "INACTIVE" }, { merge: true });
  assert.deepEqual((await j(emp)).apps, [], "a revoked assignment drops the app from the menu");
  await db.doc(`organizationMemberships/${O.uid}_${adm.uid}`).set({ role: "MEMBER", roleSource: "explicit" }, { merge: true });
  assert.equal((await j(adm)).admin.show, false, "an explicit demotion removes Admin Center at once (read live)");
});

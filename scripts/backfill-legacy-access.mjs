// Delta backfill to run BEFORE deploying app-entitlement enforcement
// (appEntitlementDenial in lib/appAccess.js on shop-sso, pos-sso, app-sso
// and the Notes/Files APIs). It only ADDS missing records so nobody who has
// access today loses it; it never changes or removes an existing record:
//   1. Non-admin-provisioned organizations: any app with no subscription doc
//      gets an ACTIVE/TRIAL one (admin-provisioned companies already carry
//      explicit entitlements and are skipped).
//   2. Team members (memberships/{uid}) with no organizationMemberships doc
//      get one (e.g. created through the legacy createTeamMember path).
//   3. Members who hold ZERO appAssignments get ACTIVE assignments for every
//      ACTIVE subscription of their org — i.e. exactly the access they have
//      today. Members with any assignment are left as the admin set them.
// Dry run by default:   node scripts/backfill-legacy-access.mjs
// Write for real:       node scripts/backfill-legacy-access.mjs --apply
// (Honors FIRESTORE_EMULATOR_HOST for testing.)
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fs from "fs";
import { APP_IDS } from "../lib/appCatalog.js";

const APPLY = process.argv.includes("--apply");

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) return JSON.parse(raw);
  const envContent = fs.readFileSync(".env.local", "utf8");
  const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT=(.*)/);
  if (!match) throw new Error("FIREBASE_SERVICE_ACCOUNT not found in .env.local");
  let value = match[1].trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"');
  return JSON.parse(value);
}

const creds = loadServiceAccount();
if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, "\n");
const db = getFirestore(initializeApp({ credential: cert(creds) }));

function roleFromProfile(profile) {
  if (profile === "Global Admin" || profile === "Admin") return "ADMIN";
  if (profile === "Viewer/Auditor") return "VIEWER";
  return "MEMBER";
}

const stats = { orgsChecked: 0, subsAdded: 0, membershipsAdded: 0, membersGranted: 0, assignmentsAdded: 0 };
const log = (...a) => console.log(APPLY ? "[apply]" : "[dry-run]", ...a);
const write = async (fn) => { if (APPLY) await fn(); };

// 1. subscriptions
const customers = await db.collection("customers").get();
const adminOrgs = new Set(customers.docs.filter((c) => c.data().createdByAdmin).map((c) => c.id));
for (const c of customers.docs) {
  if (c.data().createdByAdmin) continue;
  stats.orgsChecked++;
  for (const appId of APP_IDS) {
    const ref = db.doc(`organizationAppSubscriptions/${c.id}_${appId}`);
    if ((await ref.get()).exists) continue;
    stats.subsAdded++;
    log("subscription", c.id, appId);
    await write(() => ref.set({ organizationId: c.id, appId, status: "ACTIVE", subscriptionType: "TRIAL", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
  }
}

// 2 + 3. members
const members = await db.collection("memberships").get();
for (const m of members.docs) {
  const { accountId, profile } = m.data();
  // Admin-provisioned companies manage access explicitly: a member with no
  // assignments there is intentional, not legacy.
  if (!accountId || adminOrgs.has(accountId)) continue;
  const omRef = db.doc(`organizationMemberships/${accountId}_${m.id}`);
  if (!(await omRef.get()).exists) {
    stats.membershipsAdded++;
    log("organizationMembership", accountId, m.id);
    await write(() => omRef.set({ organizationId: accountId, userId: m.id, role: roleFromProfile(profile), status: "active", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
  }
  const existing = await db.collection("appAssignments").where("organizationId", "==", accountId).where("userId", "==", m.id).limit(1).get();
  if (!existing.empty) continue;
  const subs = await db.collection("organizationAppSubscriptions").where("organizationId", "==", accountId).get();
  // In dry-run, subscriptions step 1 hasn't been written, so fall back to all apps for legacy orgs.
  const active = APPLY ? subs.docs.filter((s) => s.data().status === "ACTIVE").map((s) => s.data().appId)
    : (subs.empty ? APP_IDS : subs.docs.filter((s) => s.data().status === "ACTIVE").map((s) => s.data().appId));
  if (!active.length) continue;
  stats.membersGranted++;
  for (const appId of active) {
    stats.assignmentsAdded++;
    log("assignment", accountId, m.id, appId);
    await write(() => db.doc(`appAssignments/${accountId}_${m.id}_${appId}`).set({ organizationId: accountId, userId: m.id, appId, role: null, status: "ACTIVE", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
  }
}
console.log(stats);
if (!APPLY) console.log("Dry run only. Re-run with --apply to write.");

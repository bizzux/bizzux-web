// Builds / rebuilds organizationDirectory/{orgId} (the Organizations search
// index) from organizations + customers + active OWNER memberships. It only
// writes the derived index; it never touches organizations, customers,
// memberships, subscriptions or entitlements.
//
//   node ... scripts/backfill-organization-directory.mjs             estimate only (count queries, ~2 reads)
//   node ... scripts/backfill-organization-directory.mjs --dry-run   reads everything, reports, WRITES NOTHING
//   node ... scripts/backfill-organization-directory.mjs --apply     reads everything and writes the index
// Run through tsx so the lib imports resolve:  npx tsx scripts/backfill-organization-directory.mjs
// Honors FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST for testing.
import fs from "fs";

function loadEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return;
  const envContent = fs.readFileSync(".env.local", "utf8");
  const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT=(.*)/);
  if (!match) throw new Error("FIREBASE_SERVICE_ACCOUNT not found in .env.local");
  let value = match[1].trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"');
  process.env.FIREBASE_SERVICE_ACCOUNT = value;
}
loadEnv();

const { adminDb } = await import("../lib/firebaseAdmin.js");
const { buildDirectoryEntry, DIRECTORY_COLLECTION } = await import("../lib/orgDirectory.js");
const { resolveOrgOwners } = await import("../lib/orgOwners.js");

const APPLY = process.argv.includes("--apply");
const DRY = process.argv.includes("--dry-run");
const db = adminDb();

const orgCount = (await db.collection("organizations").count().get()).data().count;
const memberCount = (await db.collection("organizationMemberships").where("status", "==", "active").count().get()).data().count;
const estReads = orgCount * 2 + memberCount; // organizations + customers + OWNER membership scans (reads active members of each org)
console.log(`organizations: ${orgCount}   active memberships: ${memberCount}`);
console.log(`Estimated Firestore reads for a ${APPLY ? "real run" : "dry run"}: about ${estReads} (+ ${orgCount} index writes when applying).`);
if (!APPLY && !DRY) {
  console.log("Estimate only - nothing was read beyond the two count queries. Re-run with --dry-run or --apply.");
  process.exit(0);
}

let done = 0, written = 0, noOwner = 0;
let last = null;
for (;;) {
  let q = db.collection("organizations").orderBy("__name__").limit(100);
  if (last) q = q.startAfter(last);
  const snap = await q.get();
  if (snap.empty) break;
  last = snap.docs[snap.docs.length - 1];
  const typed = snap.docs.filter((d) => d.data().type);
  const custSnaps = typed.length ? await db.getAll(...typed.map((d) => db.doc("customers/" + d.id))) : [];
  const customers = Object.fromEntries(custSnaps.map((s) => [s.id, s.exists ? s.data() : null]));
  const owners = await resolveOrgOwners(snap.docs.map((d) => d.id));
  const batch = db.batch();
  for (const d of snap.docs) {
    const owner = owners[d.id]?.owner || null;
    if (!owner && d.data().type) noOwner++;
    const entry = buildDirectoryEntry({ id: d.id, org: d.data(), customer: customers[d.id] || null, owner });
    done++;
    if (APPLY) { batch.set(db.doc(DIRECTORY_COLLECTION + "/" + d.id), entry); written++; }
  }
  if (APPLY) await batch.commit();
}
console.log(`${APPLY ? "[apply]" : "[dry-run]"} processed ${done} organizations, ${written} index documents written, ${noOwner} real organizations have no active OWNER membership (left unassigned, nothing invented).`);

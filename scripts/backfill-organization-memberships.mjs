// One-off, manually-run backfill for the Organization + OrganizationMembership
// model (see lib/organization.js and lib/organizationMembership.js).
// Populates organizations/{id} and organizationMemberships/{organizationId}_
// {userId} for every organization and membership that already existed
// before those collections did, so existing customers aren't left out of
// the new model. Idempotent — safe to re-run; upsertOrganizationMembership()
// never creates duplicates, and upsertOrganization() here skips any
// organizations/ doc that already exists rather than overwriting it.
//
// Run from the bizzux-web project root:
//   node scripts/backfill-organization-memberships.mjs
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fs from "fs";

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) return JSON.parse(raw);
  // Falls back to reading .env.local directly since this script runs
  // outside Next.js's own env loading.
  const envContent = fs.readFileSync(".env.local", "utf8");
  const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT=(.*)/);
  if (!match) throw new Error("FIREBASE_SERVICE_ACCOUNT not found in .env.local");
  let value = match[1].trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  return JSON.parse(value);
}

const creds = loadServiceAccount();
if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, "\n");

const app = initializeApp({ credential: cert(creds) });
const db = getFirestore(app);

function roleFromProfile(profile, isOwner) {
  if (isOwner) return "OWNER";
  if (profile === "Global Admin" || profile === "Admin") return "ADMIN";
  if (profile === "Viewer/Auditor") return "VIEWER";
  return "MEMBER";
}

async function upsert(organizationId, userId, role, status) {
  const id = organizationId + "_" + userId;
  const ref = db.collection("organizationMemberships").doc(id);
  const snap = await ref.get();
  await ref.set(
    {
      organizationId,
      userId,
      role,
      status,
      updatedAt: FieldValue.serverTimestamp(),
      ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );
}

async function upsertOrganization(id, data) {
  const ref = db.collection("organizations").doc(id);
  const snap = await ref.get();
  if (snap.exists) return; // don't overwrite anything already backfilled/created
  await ref.set({
    id,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...data,
  });
}

async function main() {
  let ownerCount = 0;
  let orgCount = 0;
  const customersSnap = await db.collection("customers").get();
  for (const doc of customersSnap.docs) {
    const c = doc.data();
    await upsertOrganization(doc.id, {
      name: c.organizationName || c.companyName || c.email || null,
      type: "CUSTOMER", // existing accounts predate the platform-admin/INTERNAL distinction; adjust manually if needed
      status: "active",
      createdBy: doc.id,
    });
    orgCount++;
    await upsert(doc.id, doc.id, "OWNER", "active");
    ownerCount++;
  }
  console.log(`Backfilled ${orgCount} organizations/ and ${ownerCount} OWNER memberships from customers/`);

  let memberCount = 0;
  const membershipsSnap = await db.collection("memberships").get();
  for (const doc of membershipsSnap.docs) {
    const m = doc.data();
    if (!m.accountId) continue;
    await upsert(m.accountId, doc.id, roleFromProfile(m.profile, false), "active");
    memberCount++;
  }
  console.log(`Backfilled ${memberCount} member memberships from memberships/`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

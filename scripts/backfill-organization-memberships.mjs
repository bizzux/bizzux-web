// One-off, manually-run backfill for the Organization / OrganizationMembership
// / OrganizationAppSubscription / AppAssignment model (see lib/organization.js,
// lib/organizationMembership.js, lib/appAccess.js). Populates every one of
// those collections for organizations, memberships and apps that already
// existed before this model did, so existing customers aren't left out —
// every existing member ends up assigned to every app their organization is
// marked subscribed to, matching exactly what they could already do before
// this backfill ran (nothing reads AppAssignment for real access control
// yet). Idempotent — safe to re-run.
//
// Run from the bizzux-web project root:
//   node scripts/backfill-organization-memberships.mjs
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fs from "fs";
import { APP_IDS } from "../lib/appCatalog.js";

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) return JSON.parse(raw);
  // Falls back to reading .env.local directly since this script runs
  // outside Next.js's own env loading.
  const envContent = fs.readFileSync(".env.local", "utf8");
  const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT=(.*)/);
  if (!match) throw new Error("FIREBASE_SERVICE_ACCOUNT not found in .env.local");
  let value = match[1].trim();
  // A dotenv-style quoted value (e.g. as `vercel env pull` writes it) has
  // its own inner double-quotes backslash-escaped so the whole value stays
  // on one line — strip the wrapping quotes, then undo that escaping,
  // rather than just slicing off the wrapper and leaving literal \" pairs
  // behind for JSON.parse to choke on.
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"');
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

async function upsertSubscription(organizationId, appId, status, subscriptionType) {
  const id = organizationId + "_" + appId;
  const ref = db.collection("organizationAppSubscriptions").doc(id);
  const snap = await ref.get();
  await ref.set(
    {
      organizationId, appId, status, subscriptionType,
      updatedAt: FieldValue.serverTimestamp(),
      ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );
}

async function upsertAssignment(organizationId, userId, appId, role, status) {
  const id = organizationId + "_" + userId + "_" + appId;
  const ref = db.collection("appAssignments").doc(id);
  const snap = await ref.get();
  await ref.set(
    {
      organizationId, userId, appId, role, status,
      updatedAt: FieldValue.serverTimestamp(),
      ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );
}

async function isPlatformOrg(uid, email) {
  const superEmails = (process.env.SUPER_ADMIN_EMAIL || "").split(",").map((e) => e.toLowerCase().trim()).filter(Boolean);
  if (superEmails.includes((email || "").toLowerCase())) return true;
  const snap = await db.collection("platformAdmins").doc(uid).get();
  return snap.exists && snap.data().status !== "disabled";
}

async function main() {
  let ownerCount = 0;
  let orgCount = 0;
  const orgTypeById = new Map();
  const customersSnap = await db.collection("customers").get();
  for (const doc of customersSnap.docs) {
    const c = doc.data();
    const type = (await isPlatformOrg(doc.id, c.email)) ? "INTERNAL" : "CUSTOMER";
    orgTypeById.set(doc.id, type);
    await upsertOrganization(doc.id, {
      name: c.organizationName || c.companyName || c.email || null,
      type,
      status: "active",
      createdBy: doc.id,
    });
    orgCount++;
    await upsert(doc.id, doc.id, "OWNER", "active");
    ownerCount++;
    for (const appId of APP_IDS) {
      await upsertSubscription(doc.id, appId, "ACTIVE", type === "INTERNAL" ? "INTERNAL" : "TRIAL");
      await upsertAssignment(doc.id, doc.id, appId, "OWNER", "ACTIVE");
    }
  }
  console.log(`Backfilled ${orgCount} organizations/ (+ app subscriptions) and ${ownerCount} OWNER memberships/assignments from customers/`);

  let memberCount = 0;
  const membershipsSnap = await db.collection("memberships").get();
  for (const doc of membershipsSnap.docs) {
    const m = doc.data();
    if (!m.accountId) continue;
    await upsert(m.accountId, doc.id, roleFromProfile(m.profile, false), "active");
    memberCount++;
    // Grandfather every existing team member into every app their org is
    // marked subscribed to — matches exactly what they could already do
    // (all apps, gated only by the org's trial/plan) before this model
    // existed. New invites going forward are NOT auto-assigned; assigning
    // them is now an explicit action via Team > Apps > Manage Users.
    for (const appId of APP_IDS) {
      await upsertAssignment(m.accountId, doc.id, appId, roleFromProfile(m.profile, false), "ACTIVE");
    }
  }
  console.log(`Backfilled ${memberCount} member memberships (+ app assignments) from memberships/`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

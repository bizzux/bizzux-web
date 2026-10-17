// SERVER ONLY. Backward-compatible migration of existing organizations to the
// requester / business owner / primary admin model (contactsVersion 2).
//
// Rules (each one covered by a test):
//  - Idempotent: an organization already at contactsVersion 2 is skipped, so a
//    rerun changes nothing and a half-finished run can be resumed.
//  - Never infers a Business Owner. The legacy "owner / administrator" text is
//    preserved verbatim in legacyOwnerAdministrator; businessOwner stays null.
//  - Never changes anyone's access: memberships, roles, subscriptions, seats,
//    entitlements, app assignments and audit history are not touched. The
//    primary-admin pointer is only SET when it matches an existing active member.
//  - Never creates users, and never invents a requester.
//  - Dry run by default: nothing is written unless { apply: true }.
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";
import { loadOrgMembers } from "./orgContactsAdmin";

export const MIGRATION_ID = "org-contacts-v1";

function legacyCreatedBy(org) {
  if (org.createdBy && typeof org.createdBy === "object") return org.createdBy;
  if (org.provisionedBy) return { actorUserId: org.provisionedBy, actorType: "platform_admin", actorEmail: org.provisionedByEmail || null };
  if (typeof org.createdBy === "string" && org.createdBy) return { actorUserId: org.createdBy, actorType: "customer", actorEmail: null };
  return null;
}

// Pure planning step: what we would write, and what needs a human.
export function planMigration({ id, org, customer, members }) {
  const issues = [];
  const adminUid = org.adminUid || null;
  const adminMember = adminUid ? members.find((m) => m.uid === adminUid && m.status === "active") : null;
  const owners = members.filter((m) => m.role === "OWNER" && m.status === "active");

  let primaryAdmin = null;
  let target = adminMember || (owners.length === 1 ? owners[0] : null);
  if (target) {
    primaryAdmin = {
      userId: target.uid, invitationId: null,
      displayName: (target.uid === adminUid ? org.adminName : "") || target.name || "",
      loginIdentifier: (target.uid === adminUid ? org.adminUsername || org.adminContact : "") || target.username || target.email || "",
      status: target.disabled ? "suspended" : target.lastLoginAt ? "active" : "pending_activation",
    };
  } else {
    issues.push(adminUid ? "administrator_not_a_member" : owners.length > 1 ? "multiple_owner_memberships" : "no_administrator_identity");
  }

  const onboardingMethod = org.provisionedVia === "platform-admin" || customer?.createdByAdmin ? "bizzux_managed" : "self_service";
  const text = org.adminName || customer?.owner?.name || null;
  const patch = {
    contactsVersion: 2,
    onboardingMethod,
    requester: null,
    requesterIsPrimaryAdmin: false,
    businessOwner: null,
    businessOwnerStatus: "not_provided",
    primaryAdmin,
    // Existing customers keep exactly the access they had; nothing is newly pending.
    authorizationStatus: "not_required",
    restrictedAccess: false,
    createdBy: legacyCreatedBy(org),
    migration: { id: MIGRATION_ID, needsAdminReview: !primaryAdmin, issues },
    migratedAt: FieldValue.serverTimestamp(),
  };
  if (text && !org.legacyOwnerAdministrator) patch.legacyOwnerAdministrator = text;
  if (typeof org.createdBy === "string" && !org.legacyCreatedBy) patch.legacyCreatedBy = org.createdBy;
  return { patch, issues, needsReview: issues.length > 0 };
}

export async function migrateOrganization(id, { apply = false } = {}) {
  const db = adminDb();
  const [orgSnap, custSnap] = await Promise.all([db.doc("organizations/" + id).get(), db.doc("customers/" + id).get()]);
  if (!orgSnap.exists) return { id, outcome: "failed", error: "organization not found" };
  const org = orgSnap.data();
  if (!org.type) return { id, outcome: "skipped", reason: "placeholder" };
  if (org.contactsVersion === 2) return { id, outcome: "skipped", reason: "already_migrated" };
  const customer = custSnap.exists ? custSnap.data() : null;
  const members = await loadOrgMembers(id, customer);
  const { patch, issues, needsReview } = planMigration({ id, org, customer, members });
  if (apply) await orgSnap.ref.set(patch, { merge: true });
  return { id, outcome: needsReview ? "review" : "migrated", issues, applied: !!apply };
}

// Walks organizations in id order. Resumable via `after`; bounded by `limit`.
export async function migrateAll({ apply = false, limit = 500, after = null } = {}) {
  const db = adminDb();
  let q = db.collection("organizations").orderBy("__name__").limit(limit);
  if (after) q = q.startAfter(db.doc("organizations/" + after));
  const snap = await q.get();
  const report = {
    apply, inspected: 0, migrated: 0, skipped: 0, needsReview: 0, failed: 0,
    missingAdminMapping: [], reviewIds: [], failures: [], lastId: null, done: snap.size < limit,
  };
  for (const d of snap.docs) {
    report.inspected++; report.lastId = d.id;
    let r;
    try { r = await migrateOrganization(d.id, { apply }); } catch (e) { r = { id: d.id, outcome: "failed", error: String(e?.message || e).slice(0, 200) }; }
    if (r.outcome === "migrated") report.migrated++;
    else if (r.outcome === "skipped") report.skipped++;
    else if (r.outcome === "review") {
      // Written (the safe fields are in place) but an admin identity needs a human.
      report.migrated++; report.needsReview++; report.reviewIds.push(d.id);
      if (r.issues.some((i) => i.includes("administrator") || i.includes("owner_membership"))) report.missingAdminMapping.push(d.id);
    } else { report.failed++; report.failures.push({ id: d.id, error: r.error }); }
  }
  return report;
}

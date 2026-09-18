// Phase 1 of the Organization Membership model. Deliberately additive: it
// introduces a queryable record of who belongs to which organization,
// alongside — not instead of — the existing customers/{accountId}/team +
// memberships/{uid} records that resolveAccount() and every other route
// still read for actual access control. Nothing here changes who can
// access what yet.
//
// Why a new collection at all: memberships/{uid} is keyed BY uid, so a
// user can only ever point at one accountId — there's no way to represent
// "belongs to two organizations." organizationMemberships/{organizationId}_
// {userId} is a plain top-level collection queryable by either
// organizationId or userId, so a future second membership for the same
// user is just another document, not a schema change.
//
// "Organization" is not a new collection — customers/{accountId} already
// IS the organization record (name, billing, trial, plan); its doc id is
// the organizationId used here. Introducing a separate Organization
// collection now would mean migrating every existing reference to it
// across 4+ apps for zero functional gain in this phase.
import { adminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { ORGANIZATION_ROLES } from "./roles";

export { ORGANIZATION_ROLES };

// Maps a bizzux-apps business profile (lib/roles.js's PROFILES — Global
// Admin, Admin, Manager, Staff/Shopkeeper, Viewer/Auditor) to the
// coarser organization-level role tier requested for this model. The
// business profile remains the actual permission source of truth in
// Phase 1 — this is a classification, not a new enforcement path.
export function roleFromProfile(profile, isOwner) {
  if (isOwner) return "OWNER";
  if (profile === "Global Admin" || profile === "Admin") return "ADMIN";
  if (profile === "Viewer/Auditor") return "VIEWER";
  return "MEMBER"; // Manager, Staff/Shopkeeper, or anything unrecognized
}

function collection() {
  return adminDb().collection("organizationMemberships");
}

function membershipDocId(organizationId, userId) {
  return organizationId + "_" + userId;
}

// Upsert — safe to call repeatedly for the same (organizationId, userId)
// pair without creating duplicates or clobbering the original createdAt.
export async function upsertOrganizationMembership({ organizationId, userId, role, status }) {
  if (!ORGANIZATION_ROLES.includes(role)) throw new Error("Invalid organization role: " + role);
  const ref = collection().doc(membershipDocId(organizationId, userId));
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

export async function setOrganizationMembershipStatus(organizationId, userId, status) {
  await collection()
    .doc(membershipDocId(organizationId, userId))
    .set({ status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

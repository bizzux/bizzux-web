// Phase 1 of the Organization model (see lib/organizationMembership.js for
// its companion). A real, minimal Organization record — separate from
// customers/{accountId}, which stays the billing/trial/plan record it
// always was. organizations/{id} uses the SAME id as the matching
// customers/{accountId} doc, so the two never drift into needing their own
// cross-reference field; id IS the shared organizationId everywhere.
import { adminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const ORGANIZATION_TYPES = ["INTERNAL", "CUSTOMER"];

export async function createOrganization({ id, name, type, createdBy }) {
  if (!ORGANIZATION_TYPES.includes(type)) throw new Error("Invalid organization type: " + type);
  await adminDb()
    .doc("organizations/" + id)
    .set({
      id,
      name: name || null,
      type,
      status: "active",
      createdBy,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

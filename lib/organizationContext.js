// The multi-organization "current context" layer (Bizzux rules 2, 6, 7, 9).
// Deliberately separate from resolveAccount()/memberships (lib/firebaseAdmin.js)
// — those remain exactly as they were for Team management, business
// Profiles, and Shop's role mapping, none of which this phase touches.
// This is a parallel, additive resolver used specifically for
// organization/app-access decisions (dashboard, canAccessApp), built on
// organizationMemberships, which was already correctly multi-org-capable
// (one doc per organizationId+userId) — the piece that was actually
// missing was a way to pick and remember WHICH of a user's organizations
// is "current."
import { adminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

// Every organization the user has an ACTIVE membership in, richest-first
// (their own OWNER organizations first) — used by the switcher and to pick
// a sensible default current organization.
export async function getUserOrganizations(userId) {
  const snap = await adminDb()
    .collection("organizationMemberships")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .get();
  const memberships = snap.docs.map((d) => d.data());
  if (memberships.length === 0) return [];

  const orgSnaps = await Promise.all(memberships.map((m) => adminDb().doc("organizations/" + m.organizationId).get()));
  return memberships
    .map((m, i) => ({
      organizationId: m.organizationId,
      role: m.role,
      name: orgSnaps[i].exists ? orgSnaps[i].data().name : m.organizationId,
      type: orgSnaps[i].exists ? orgSnaps[i].data().type : null,
    }))
    .sort((a, b) => (a.role === "OWNER" ? -1 : b.role === "OWNER" ? 1 : 0));
}

// Resolves (and lazily persists) which organization is "current" for this
// user. Returns null if they belong to no organization at all (rule 1/8's
// legitimate state — not an error). If their stored currentOrganizationId
// is no longer one of their active memberships (removed, or never set),
// falls back to their first organization (their own OWNER org if they
// have one, per getUserOrganizations' sort) and persists that as current.
export async function resolveCurrentOrganization(userId) {
  const orgs = await getUserOrganizations(userId);
  if (orgs.length === 0) return null;

  const userRef = adminDb().doc("users/" + userId);
  const userSnap = await userRef.get();
  const storedId = userSnap.exists ? userSnap.data().currentOrganizationId : null;
  const current = orgs.find((o) => o.organizationId === storedId) || orgs[0];

  if (storedId !== current.organizationId) {
    await userRef.set({ currentOrganizationId: current.organizationId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return current;
}

// Explicit switch — validates the target is actually one of the user's
// active memberships before persisting it, so a stale/forged
// organizationId can never become "current."
export async function setCurrentOrganization(userId, organizationId) {
  const orgs = await getUserOrganizations(userId);
  if (!orgs.some((o) => o.organizationId === organizationId)) {
    throw { status: 403, message: "You don't belong to that organization" };
  }
  await adminDb()
    .doc("users/" + userId)
    .set({ currentOrganizationId: organizationId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

// Rule 7: only OWNER/ADMIN may start a trial or otherwise touch billing —
// kept as a single, named check (not inlined at each call site) so adding
// a future BILLING_ADMIN role is a one-line change here, not a hunt across
// every route that currently gates on OWNER/ADMIN.
export function canManageBilling(role) {
  return role === "OWNER" || role === "ADMIN";
}

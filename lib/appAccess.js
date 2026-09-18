// Phase 2 of the Organization model: OrganizationAppSubscription (does the
// ORG have this app at all) and AppAssignment (is this SPECIFIC member let
// into it). Both purely additive — see the note at the top of
// lib/organizationMembership.js for why this pattern (deterministic ids,
// upsert helpers, nothing wired into live access control yet) keeps every
// phase safe to ship without touching existing behavior.
//
// canAccessApp() below implements the 4-step rule as a ready-to-use, pure
// function, but nothing in the app calls it yet — app-sso/shop-sso and the
// split apps' own SSO gates still only check trial/plan status, exactly as
// before Phase 2. Wiring canAccessApp() into those is intentionally a
// separate, later phase: doing it now would lock out every existing team
// member, since no AppAssignment records existed before this backfill.
import { adminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const SUBSCRIPTION_STATUSES = ["ACTIVE", "INACTIVE"];
export const SUBSCRIPTION_TYPES = ["PAID", "TRIAL", "INTERNAL"];
export const ASSIGNMENT_STATUSES = ["ACTIVE", "INACTIVE"];

function subscriptionDocId(organizationId, appId) {
  return organizationId + "_" + appId;
}
function assignmentDocId(organizationId, userId, appId) {
  return organizationId + "_" + userId + "_" + appId;
}

function subscriptionsCollection() {
  return adminDb().collection("organizationAppSubscriptions");
}
function assignmentsCollection() {
  return adminDb().collection("appAssignments");
}

export async function upsertOrganizationAppSubscription({ organizationId, appId, status, subscriptionType }) {
  if (!SUBSCRIPTION_STATUSES.includes(status)) throw new Error("Invalid subscription status: " + status);
  if (!SUBSCRIPTION_TYPES.includes(subscriptionType)) throw new Error("Invalid subscription type: " + subscriptionType);
  const ref = subscriptionsCollection().doc(subscriptionDocId(organizationId, appId));
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

export async function getOrganizationAppSubscriptions(organizationId) {
  const snap = await subscriptionsCollection().where("organizationId", "==", organizationId).get();
  return snap.docs.map((d) => d.data());
}

// Subscriptions aren't a real paywall yet (see the file comment) — an org
// that predates this model, or was created outside /api/organizations'
// "create" action, can end up with no subscription doc at all for an app,
// which silently blocked every grant of that app to a teammate (a real bug:
// the admin checks the box in the invite wizard, gets no error, and the
// grant just never happens). This backfills the subscription on demand, at
// the moment someone actually tries to use it, instead of requiring a
// separate manual "activate this app" step that doesn't exist anywhere in
// the UI.
export async function ensureAppSubscriptionActive(organizationId, appId) {
  const ref = subscriptionsCollection().doc(subscriptionDocId(organizationId, appId));
  const snap = await ref.get();
  if (snap.exists && snap.data().status === "ACTIVE") return;
  await upsertOrganizationAppSubscription({ organizationId, appId, status: "ACTIVE", subscriptionType: "TRIAL" });
}

export async function upsertAppAssignment({ organizationId, userId, appId, role, status }) {
  if (!ASSIGNMENT_STATUSES.includes(status)) throw new Error("Invalid assignment status: " + status);
  const ref = assignmentsCollection().doc(assignmentDocId(organizationId, userId, appId));
  const snap = await ref.get();
  await ref.set(
    {
      organizationId, userId, appId, role: role || null, status,
      updatedAt: FieldValue.serverTimestamp(),
      ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );
}

export async function getAppAssignmentsForOrgApp(organizationId, appId) {
  const snap = await assignmentsCollection()
    .where("organizationId", "==", organizationId)
    .where("appId", "==", appId)
    .get();
  return snap.docs.map((d) => d.data());
}

// The 4-step access rule from the Organization/App-access model. Not
// called anywhere in a live route yet (see the file-level comment) — this
// exists so a future phase wires enforcement by calling one function
// instead of re-deriving this logic at each of the several SSO endpoints
// across bizzux-web and the 3 split apps.
export async function canAccessApp({ organizationId, userId, appId }) {
  const [membershipSnap, subscriptionSnap, assignmentSnap] = await Promise.all([
    adminDb().doc(`organizationMemberships/${organizationId}_${userId}`).get(),
    subscriptionsCollection().doc(subscriptionDocId(organizationId, appId)).get(),
    assignmentsCollection().doc(assignmentDocId(organizationId, userId, appId)).get(),
  ]);
  if (!membershipSnap.exists || membershipSnap.data().status !== "active") return false;
  if (!subscriptionSnap.exists || subscriptionSnap.data().status !== "ACTIVE") return false;
  if (!assignmentSnap.exists || assignmentSnap.data().status !== "ACTIVE") return false;
  return true;
}

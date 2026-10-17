// SERVER ONLY. Post-creation changes to who owns / requested / administers an
// organization. Every function:
//   - takes the actor from the authenticated session (never from the request),
//   - checks a server-side platform permission,
//   - writes an audit event with before/after,
//   - stamps updatedBy / updatedAt with server values.
// Business Owner and Requested By are CONTACTS; Primary Organization Admin is an
// ACCESS assignment that must point at a real member of THIS organization.
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "./firebaseAdmin";
import { logAuditEvent } from "./audit";
import { safeSyncDirectory } from "./orgDirectory";
import { upsertOrganizationMembership } from "./organizationMembership";
import { usernameForUid } from "./usernameAuth";
import { assertOrgPermission, loadOrg, requireReason, str } from "./orgProvisioning";
import { parseContact, AUTH_STATUS, buildOwnershipView, seatMetrics, deriveOnboardingStatus } from "./orgContacts";

const sameContact = (a, b) =>
  (a?.name || "").toLowerCase() === (b?.name || "").toLowerCase() && (a?.email || "") === (b?.email || "");

const stamp = (actor) => ({ updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });

// --- members (for the Overview) ---------------------------------------------
// Everyone with a membership in this organization, with their sign-in facts.
// Tenant-scoped: queries are filtered by organizationId, and Auth is asked only
// for those uids.
export async function loadOrgMembers(orgId, customer) {
  const db = adminDb();
  const [mem, names] = await Promise.all([
    db.collection("organizationMemberships").where("organizationId", "==", orgId).get(),
    db.collection("usernames").where("organizationId", "==", orgId).get(),
  ]);
  const uname = {};
  names.docs.forEach((d) => { uname[d.data().uid] = { username: d.id, ...d.data() }; });
  const rows = mem.docs.map((d) => d.data()).filter((m) => m.userId);
  const auth = {};
  for (let i = 0; i < rows.length; i += 100) {
    try {
      const r = await adminAuth().getUsers(rows.slice(i, i + 100).map((m) => ({ uid: m.userId })));
      r.users.forEach((u) => { auth[u.uid] = u; });
    } catch { /* best effort: identity facts are display only */ }
  }
  return rows.map((m) => {
    const u = auth[m.userId];
    const n = uname[m.userId];
    // Firebase reports a never-used account's sign-in time as its creation time
    // (or the epoch); only a sign-in clearly after creation counts as a login.
    const lastIn = u?.metadata?.lastSignInTime ? new Date(u.metadata.lastSignInTime).getTime() : 0;
    const created = u?.metadata?.creationTime ? new Date(u.metadata.creationTime).getTime() : 0;
    const signedIn = lastIn > 86400000 && lastIn - created > 1500 ? new Date(lastIn).toISOString() : null;
    const ownerSeen = m.userId === orgId && customer?.lastLoginAt
      ? (customer.lastLoginAt.toDate ? customer.lastLoginAt.toDate().toISOString() : new Date(customer.lastLoginAt).toISOString()) : null;
    const lastLoginAt = [signedIn, ownerSeen].filter(Boolean).sort().pop() || null;
    return {
      uid: m.userId, role: m.role, status: m.status || "active",
      name: u?.displayName || "", email: u?.email && !n ? u.email : (customer?.owner?.email && m.userId === orgId ? customer.owner.email : ""),
      username: n?.username || null,
      disabled: !!(u?.disabled || n?.disabled),
      mustChangePassword: !!n?.mustChangePassword,
      lastLoginAt,
    };
  });
}

// Everything the Overview needs, in one tenant-scoped call.
export async function getOwnershipOverview(orgId) {
  const { org, customer } = await loadOrg(orgId);
  const members = await loadOrgMembers(orgId, customer);
  const ownership = buildOwnershipView({ org, customer, members });
  ownership.onboardingStatus = deriveOnboardingStatus({ org, primaryAdmin: ownership.primaryAdmin });
  const metrics = seatMetrics({ members, licensedSeats: org.allowedUsers ?? customer?.allowedUsers ?? null });
  return { ownership, metrics, members: members.map((m) => ({ uid: m.uid, name: m.name, role: m.role, login: m.username || m.email, status: m.status })) };
}

// --- Business Owner contact -------------------------------------------------
// Editing a DECLARED owner is a contact update. Anything that would change a
// VERIFIED owner is an ownership transfer and goes through transferBusinessOwner.
export async function updateBusinessOwner({ actor, organizationId, owner, reason }) {
  await assertOrgPermission(actor, "organizations.manage");
  const why = requireReason(reason);
  const { id, org, orgRef } = await loadOrg(organizationId);
  const before = org.businessOwner || null;
  const next = owner ? parseContact(owner, "Business Owner", { required: true }) : null;
  if (before?.status === "verified" && !(next && sameContact(before, next))) {
    throw { status: 403, message: "This Business Owner is verified. Changing them is an ownership transfer, which only the Platform Owner can do." };
  }
  const businessOwner = next ? { ...next, status: before?.status === "verified" ? "verified" : "declared" } : null;
  await orgRef.set({ businessOwner, businessOwnerStatus: businessOwner ? businessOwner.status : "not_provided", ...stamp(actor) }, { merge: true });
  await logAuditEvent({
    action: "organization.business_owner_updated", actor, targetType: "organization", targetId: id,
    details: { reason: why, before: before ? { name: before.name, email: before.email, status: before.status } : null, after: businessOwner ? { name: businessOwner.name, email: businessOwner.email, status: businessOwner.status } : null },
  });
  await safeSyncDirectory(id);
  return { ok: true, businessOwnerStatus: businessOwner ? businessOwner.status : "not_provided" };
}

// --- Verification -----------------------------------------------------------
export async function setAuthorizationStatus({ actor, organizationId, status, reason }) {
  await assertOrgPermission(actor, "organizations.verify");
  if (!AUTH_STATUS.includes(status)) throw { status: 400, message: "Unknown verification status" };
  const why = requireReason(reason);
  const { id, org, orgRef } = await loadOrg(organizationId);
  const from = org.authorizationStatus || "not_required";
  await orgRef.set({
    authorizationStatus: status, authorizationReviewedBy: actor.uid, authorizationReviewedAt: FieldValue.serverTimestamp(),
    // Verified authority lifts the "restricted" stage; a rejection keeps/sets it.
    restrictedAccess: status === "verified" ? false : status === "rejected" ? true : !!org.restrictedAccess,
    ...stamp(actor),
  }, { merge: true });
  await logAuditEvent({ action: "organization.authorization_changed", actor, targetType: "organization", targetId: id, details: { from, to: status, reason: why } });
  return { ok: true, authorizationStatus: status };
}

export async function verifyBusinessOwner({ actor, organizationId, reason }) {
  await assertOrgPermission(actor, "organizations.verify");
  const why = requireReason(reason);
  const { id, org, orgRef } = await loadOrg(organizationId);
  if (!org.businessOwner) throw { status: 400, message: "There is no Business Owner on record to verify" };
  await orgRef.set({ businessOwner: { ...org.businessOwner, status: "verified" }, businessOwnerStatus: "verified", ...stamp(actor) }, { merge: true });
  await logAuditEvent({ action: "organization.business_owner_verified", actor, targetType: "organization", targetId: id, details: { reason: why, owner: org.businessOwner.name } });
  return { ok: true };
}

// --- Ownership transfer -----------------------------------------------------
// Platform Owner only, and only after the organization's authority has been
// verified. A customer admin (or a Platform Admin) can never reach this.
export async function transferBusinessOwner({ actor, organizationId, newOwner, reason }) {
  await assertOrgPermission(actor, "organizations.transfer_ownership");
  const why = requireReason(reason);
  const { id, org, orgRef } = await loadOrg(organizationId);
  if ((org.authorizationStatus || "not_required") !== "verified") {
    throw { status: 400, message: "Verify this organization's authorization before transferring ownership" };
  }
  const next = parseContact(newOwner, "New Business Owner", { required: true });
  const before = org.businessOwner || null;
  const businessOwner = { ...next, status: "verified" };
  await orgRef.set({ businessOwner, businessOwnerStatus: "verified", ownershipTransferredAt: FieldValue.serverTimestamp(), ...stamp(actor) }, { merge: true });
  await logAuditEvent({
    action: "organization.ownership_transferred", actor, targetType: "organization", targetId: id,
    details: { reason: why, from: before ? { name: before.name, email: before.email } : null, to: { name: next.name, email: next.email } },
  });
  await safeSyncDirectory(id);
  return { ok: true };
}

// --- Primary Organization Admin --------------------------------------------
// Moves the "primary" designation to another EXISTING member of this
// organization. It never creates an account, never moves a user between
// tenants, and never raises someone's role unless the organization's authority
// is already verified (restricted organizations cannot gain new admins).
export async function reassignPrimaryAdmin({ actor, organizationId, newAdminUid, reason }) {
  await assertOrgPermission(actor, "organizations.manage");
  const why = requireReason(reason);
  const uid = str(newAdminUid, 128);
  if (!uid) throw { status: 400, message: "Choose the new Primary Organization Admin" };
  const { id, org, orgRef, customer } = await loadOrg(organizationId);
  const memRef = adminDb().doc("organizationMemberships/" + id + "_" + uid);
  const mem = await memRef.get();
  if (!mem.exists || mem.data().organizationId !== id || mem.data().status !== "active") {
    throw { status: 404, message: "That person is not an active member of this organization" };
  }
  const role = mem.data().role;
  const isAdminRole = role === "OWNER" || role === "ADMIN";
  if (!isAdminRole) {
    if (org.restrictedAccess && (org.authorizationStatus || "not_required") !== "verified") {
      throw { status: 403, message: "This organization's authority is not verified yet, so no one can be given administrator access" };
    }
  }
  const [user, nameDoc] = await Promise.all([adminAuth().getUser(uid).catch(() => null), usernameForUid(uid)]);
  const displayName = user?.displayName || customer?.owner?.name || "";
  const loginIdentifier = nameDoc?.id || user?.email || "";
  const lastLogin = user?.metadata?.lastSignInTime || null;
  const before = org.primaryAdmin || (org.adminUid ? { userId: org.adminUid, displayName: org.adminName } : null);
  if (before?.userId === uid) throw { status: 400, message: "That person is already the Primary Organization Admin" };

  if (!isAdminRole) await upsertOrganizationMembership({ organizationId: id, userId: uid, role: "ADMIN", status: "active" });
  await orgRef.set({
    primaryAdmin: { userId: uid, invitationId: null, displayName, loginIdentifier, status: lastLogin ? "active" : "pending_activation" },
    requesterIsPrimaryAdmin: false,
    ...stamp(actor),
  }, { merge: true });
  await logAuditEvent({
    action: "organization.primary_admin_reassigned", actor, targetType: "organization", targetId: id,
    details: { reason: why, from: before ? { userId: before.userId, name: before.displayName } : null, to: { userId: uid, name: displayName }, roleRaised: !isAdminRole },
  });
  await safeSyncDirectory(id);
  return { ok: true };
}

// SERVER ONLY. Attach an administrator to an existing organization that was
// created without one ("Organization only", status pending_admin).
//
// The organization id never changes: the new admin becomes a Global Admin
// MEMBER of the existing org (memberships/{uid} -> accountId = org id,
// organizationMemberships role ADMIN), so nothing keyed by the org id has to
// move. A customers/{orgId} record is created so the organization can sign in
// and the trial/plan gates work, exactly as for admin-created organizations.
//
// Safety: Platform permission organizations.manage + a recorded reason; a
// restricted (unverified) organization can't gain an admin; an atomic lock makes
// a double click or retry impossible to apply twice; everything written is rolled
// back on failure; the temporary password is returned once and never stored.
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "./firebaseAdmin";
import { logAuditEvent } from "./audit";
import { safeSyncDirectory } from "./orgDirectory";
import {
  assertOrgPermission, requireReason, loadOrg, isAdminManaged, parsePerson, createIdentity, writeMember,
  sendOrgInviteEmail, str,
} from "./orgProvisioning";

const LOCKS = "orgAdminAssignLocks";

// The billing/trial fields customers/{id} needs, same shape admin-created
// organizations get (lib/orgProvisioning.js).
function customerFields({ org, person, actor, mustChange }) {
  const now = Timestamp.now();
  const plan = org.planType || "TRIAL";
  const free = plan === "TEST" || plan === "INTERNAL";
  const end = org.expiresAt && org.expiresAt.toMillis ? org.expiresAt : Timestamp.fromMillis(Date.now() + 30 * 864e5);
  return {
    organizationName: org.organizationName || org.name, companyName: org.organizationName || org.name,
    companyCode: org.companyCode || "BZ" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    industry: org.industry || "", state: org.state || "", city: org.city || "",
    countryCode: org.countryCode || "", country: org.countryName || "",
    phone: org.contactPhone || "", phoneVerified: false, email: org.contactEmail || person.email || "",
    owner: { name: person.fullName, username: person.username || "", phone: person.phone || "", phoneVerified: false, email: person.email || "", loginMethod: person.loginMethod },
    timezone: org.timezone || "", currency: org.currency || "",
    planType: plan, allowedUsers: org.allowedUsers || 1, companyStatus: "active",
    ...(free
      ? { status: "active", billing: "complimentary", planId: "", planName: plan === "TEST" ? "Test" : "Internal", isTestAccount: plan === "TEST", isInternal: plan === "INTERNAL", trialStartDate: now }
      : { status: "trial", planId: "", planName: plan === "PAID" ? "Admin-provisioned (paid)" : "Trial", isTestAccount: false, isInternal: false, trialStartDate: now, trialEndDate: end }),
    onboarded: false, verifyEmailRequired: false, verifyMobileRequired: false,
    createdByAdmin: true, createdByAdminEmail: actor.email || "", mustChangePassword: mustChange,
    createdAt: FieldValue.serverTimestamp(),
  };
}

export async function assignOrgAdmin({ actor, organizationId, admin, reason, origin }, deps = {}) {
  const sendInvite = deps.sendInvite || sendOrgInviteEmail;
  await assertOrgPermission(actor, "organizations.manage");
  const why = requireReason(reason);
  const { id, org, orgRef, customer } = await loadOrg(organizationId);
  if (!isAdminManaged(org, customer) || !org.type) throw { status: 400, message: "Administrators are assigned here only for organizations created by Bizzux staff" };
  if (org.adminUid || org.primaryAdmin?.userId) throw { status: 409, message: "This organization already has an administrator. Use Reassign to change who is primary." };
  if (["suspended", "archived"].includes(org.status)) throw { status: 400, message: "Reactivate the organization before assigning an administrator" };
  if (org.restrictedAccess && (org.authorizationStatus || "not_required") !== "verified") {
    throw { status: 403, message: "This organization's authority is not verified yet, so no one can be given administrator access" };
  }
  const person = parsePerson(admin, "Administrator");
  const db = adminDb();

  // Atomic: only one assignment can ever run for an organization.
  const lock = db.doc(LOCKS + "/" + id);
  try { await lock.create({ by: actor.uid, createdAt: FieldValue.serverTimestamp() }); }
  catch { throw { status: 409, message: "An administrator is already being assigned to this organization" }; }

  const written = { authUids: [], usernames: [], refs: [] };
  let createdCustomer = false;
  try {
    const mustChange = person.loginMethod === "USERNAME_TEMP" && person.requirePasswordChange;
    const ident = await createIdentity(person, { organizationId: id, actor, written });
    if (!customer) {
      const cref = db.doc("customers/" + id);
      await cref.set(customerFields({ org, person, actor, mustChange }));
      written.refs.push(cref); createdCustomer = true;
    }
    await writeMember({ actor, orgId: id, u: { ...person, profile: "Global Admin", apps: org.apps || [] }, uid: ident.uid, written });

    const requesterEmail = String(org.requester?.email || "").toLowerCase();
    const display = person.fullName;
    const loginIdentifier = person.username || person.email;
    const emailInvite = person.loginMethod === "EMAIL_INVITE";
    await orgRef.set({
      adminUid: ident.uid, adminName: display, adminLoginMethod: person.loginMethod,
      adminContact: person.email || person.username, adminUsername: person.username || null,
      status: "active",
      // contacts model (Business Owner is a separate contact and is never touched here)
      primaryAdmin: { userId: ident.uid, invitationId: null, displayName: display, loginIdentifier, status: "pending_activation" },
      requesterIsPrimaryAdmin: !!requesterEmail && requesterEmail === (person.email || "").toLowerCase(),
      onboardingStatus: emailInvite ? "pending_activation" : "awaiting_first_login",
      updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid,
    }, { merge: true });

    let invite = null;
    if (emailInvite) {
      try { await sendInvite({ email: person.email, orgName: org.organizationName || org.name, origin }); invite = { email: person.email, sent: true }; }
      catch (e) { invite = { email: person.email, sent: false, error: String(e?.message || e).slice(0, 200) }; }
    }
    await logAuditEvent({
      action: "organization.admin_assigned", actor, targetType: "organization", targetId: id,
      details: { reason: why, adminUid: ident.uid, adminName: display, loginMethod: person.loginMethod, assignedLater: true },
    });
    await safeSyncDirectory(id);
    return { ok: true, uid: ident.uid, credential: ident.credential, invite };
  } catch (e) {
    // undo everything this call created, then release the lock so it can be retried
    for (const uid of written.authUids) {
      const team = await db.collection("customers/" + id + "/team").where("uid", "==", uid).get().catch(() => null);
      if (team) await Promise.all(team.docs.map((d) => d.ref.delete().catch(() => {})));
      const asg = await db.collection("appAssignments").where("userId", "==", uid).get().catch(() => null);
      if (asg) await Promise.all(asg.docs.filter((d) => d.data().organizationId === id).map((d) => d.ref.delete().catch(() => {})));
      await db.doc("organizationMemberships/" + id + "_" + uid).delete().catch(() => {});
    }
    await Promise.all(written.refs.map((r) => r.delete().catch(() => {})));
    await Promise.all(written.usernames.map((n) => db.doc("usernames/" + n).delete().catch(() => {})));
    await Promise.all(written.authUids.map((u) => adminAuth().deleteUser(u).catch(() => {})));
    await lock.delete().catch(() => {});
    throw e;
  }
}

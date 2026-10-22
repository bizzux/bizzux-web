// Removing a person from a COMPANY (not from Bizzux). The central identity (Firebase user, username record, other companies' memberships) is never touched:
// only this company's membership ends. What is removed is snapshotted under customers/{org}/teamRemoved so the person can be restored within the
// retention window, with identity links and the audit trail intact. Replaces the old behaviour that deleted the Firebase user itself.
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "../firebaseAdmin";
import { logAuditEvent } from "../audit";
import { setOrganizationMembershipStatus } from "../organizationMembership";
import { effectiveOrgRole, orgCan } from "../authz/policy.js";
import { loadOrgSubject } from "../authz/orgAuthz";

export const RETENTION_DAYS = 60;
const DAY = 86_400_000;

async function actorSubject(c, organizationId) {
  if (c.isSuper) return null;
  return c.orgSubject || loadOrgSubject(adminDb(), { accountId: organizationId, isOwner: c.isOwner, profile: c.profile }, c.uid);
}
function assertCan(c, subject, permission) {
  if (c.isSuper) return;
  if (!orgCan(subject, permission)) throw { status: 403, message: "You don't have permission for this" };
}

export async function removeMember({ actor: c, organizationId, teamDocId }) {
  const db = adminDb();
  const subject = await actorSubject(c, organizationId);
  assertCan(c, subject, "users.remove");
  const ref = db.doc(`customers/${organizationId}/team/${teamDocId}`);
  const snap = await ref.get();
  if (!teamDocId || teamDocId === organizationId) throw { status: 400, message: "Can't remove the account owner" };
  if (!snap.exists) throw { status: 404, message: "Not found" };
  const t = snap.data();
  const uid = t.uid || "";
  if (uid && uid === organizationId) throw { status: 400, message: "Can't remove the account owner" };
  if (uid && uid === c.uid) throw { status: 400, message: "You can't remove yourself" };
  let canonical = null, legacyProfile = t.profile || "";
  if (uid) {
    const [m, l] = await Promise.all([db.doc(`organizationMemberships/${organizationId}_${uid}`).get(), db.doc("memberships/" + uid).get()]);
    canonical = m.exists ? m.data() : null;
    if (l.exists && l.data().accountId === organizationId) legacyProfile = l.data().profile || legacyProfile;
    const target = effectiveOrgRole({ isOwner: false, canonical, profile: legacyProfile });
    if (target.role === "ADMIN" && !c.isSuper && !orgCan(subject, "roles.assign_admin")) throw { status: 403, message: "Only the Owner can remove an Admin" };
  }
  const now = Date.now();
  await db.doc(`customers/${organizationId}/teamRemoved/${teamDocId}`).set({
    ...t, teamDocId, removedAt: FieldValue.serverTimestamp(), removedAtMs: now, removedBy: c.uid, restoreUntilMs: now + RETENTION_DAYS * DAY,
    snapshot: { canonicalRole: canonical?.role || "", canonicalSource: canonical?.roleSource || "", permissions: canonical?.permissions || [], legacyProfile },
  });
  if (uid) {
    await setOrganizationMembershipStatus(organizationId, uid, "removed");
    const as = await db.collection("appAssignments").where("organizationId", "==", organizationId).where("userId", "==", uid).get();
    await Promise.all(as.docs.map((d) => d.ref.update({ status: "INACTIVE", updatedAt: FieldValue.serverTimestamp() })));
    // The legacy pointer is removed only when it points at THIS company; a person homed in another company keeps theirs.
    const l = await db.doc("memberships/" + uid).get();
    if (l.exists && l.data().accountId === organizationId) await l.ref.delete();
  }
  await ref.delete();
  await logAuditEvent({ action: "team.remove", actor: c, targetType: "organization", targetId: organizationId, details: { email: t.email || null, uid: uid || null, retentionDays: RETENTION_DAYS } });
  return { ok: true };
}
export async function listRemoved({ actor: c, organizationId }) {
  const subject = await actorSubject(c, organizationId);
  assertCan(c, subject, "users.view");
  const snap = await adminDb().collection(`customers/${organizationId}/teamRemoved`).limit(500).get();
  const now = Date.now();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id, name: [x.firstName, x.lastName].filter(Boolean).join(" ") || x.username || x.email || "", email: x.email || "", username: x.username || "",
      removedAtMs: x.removedAtMs || 0, restoreUntilMs: x.restoreUntilMs || 0, daysLeft: Math.max(0, Math.ceil(((x.restoreUntilMs || 0) - now) / DAY)), recoverable: (x.restoreUntilMs || 0) > now,
    };
  }).sort((a, b) => b.removedAtMs - a.removedAtMs);
}

// Restores the membership (and the Users record). It does NOT re-grant application access: access is a separate decision for an administrator.
export async function restoreMember({ actor: c, organizationId, id }) {
  const db = adminDb();
  const subject = await actorSubject(c, organizationId);
  assertCan(c, subject, "users.create");
  const ref = db.doc(`customers/${organizationId}/teamRemoved/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: "Not found" };
  const x = snap.data();
  if (!(x.restoreUntilMs > Date.now())) throw { status: 410, message: "The recovery period for this person has ended" };
  const org = await db.doc("customers/" + organizationId).get();
  if (!org.exists || ["suspended", "closed"].includes(org.data().status)) throw { status: 400, message: "Company is not active" };
  if (org.data().allowedUsers) {
    const team = await db.collection(`customers/${organizationId}/team`).count().get();
    if (team.data().count + 1 >= org.data().allowedUsers) throw { status: 400, message: "User limit reached for this company's subscription" };
  }
  const uid = x.uid || "";
  if (uid) { try { await adminAuth().getUser(uid); } catch { throw { status: 409, message: "This person's account no longer exists, so they can't be restored" }; } }
  const { teamDocId, removedAt, removedAtMs, removedBy, restoreUntilMs, snapshot, ...rest } = x;
  await db.doc(`customers/${organizationId}/team/${id}`).set({ ...rest, restoredAt: FieldValue.serverTimestamp(), restoredBy: c.uid });
  if (uid) {
    await setOrganizationMembershipStatus(organizationId, uid, "active");
    const l = await db.doc("memberships/" + uid).get();
    if (!l.exists) {
      const profile = snapshot?.legacyProfile || x.profile || "Staff/Shopkeeper";
      await l.ref.set({ accountId: organizationId, profile, role: profile, ...(x.username ? { username: x.username } : {}), restoredAt: FieldValue.serverTimestamp() });
    }
  }
  await ref.delete();
  await logAuditEvent({ action: "team.restore", actor: c, targetType: "organization", targetId: organizationId, details: { uid: uid || null, appAccessRestored: false } });
  return { ok: true, uid, appAccessRestored: false };
}

// LEFTOVER records: a membership / app assignment for this company whose person has NO team record (left behind by an earlier removal or an invitation that was never
// completed). "Delete permanently" removes ONLY this company's records for that user id: the organization membership, its app assignments and a legacy company pointer
// that names this company. It never deletes the Firebase identity, a username record, another company's membership, or any Attendance (or other app) business record.
// A person who still has a team record must be removed with "Remove from company" (restorable for 60 days). Owners and the caller cannot be deleted; an Admin
// can be deleted only by someone allowed to manage Admins. What was deleted is written to the audit log first.
export async function purgeLeftover({ actor: c, organizationId, uid }) {
  const db = adminDb();
  const subject = await actorSubject(c, organizationId);
  assertCan(c, subject, "users.remove");
  uid = String(uid || "").trim();
  if (uid.length < 3 || uid.length > 128 || uid.includes("/")) throw { status: 400, message: "Missing person" };
  if (uid === organizationId) throw { status: 400, message: "Can't delete the account owner" };
  if (uid === c.uid) throw { status: 400, message: "You can't delete yourself" };
  const [team, mems, asg, legacy] = await Promise.all([
    db.collection(`customers/${organizationId}/team`).where("uid", "==", uid).limit(1).get(),
    db.collection("organizationMemberships").where("organizationId", "==", organizationId).where("userId", "==", uid).get(),
    db.collection("appAssignments").where("organizationId", "==", organizationId).where("userId", "==", uid).get(),
    db.doc("memberships/" + uid).get(),
  ]);
  if (!team.empty) throw { status: 409, message: "This person has a company record. Use Remove from company instead; it can be restored for 60 days." };
  const legacyHere = legacy.exists && legacy.data().accountId === organizationId;
  if (mems.empty && asg.empty && !legacyHere) throw { status: 404, message: "Nothing left to delete for this person" };
  const role = mems.docs[0]?.data().role || "";
  if (role === "OWNER") throw { status: 400, message: "Can't delete the account owner" };
  if (role === "ADMIN" && !c.isSuper && !orgCan(subject, "roles.assign_admin")) throw { status: 403, message: "Only the Owner can delete an Admin" };
  const summary = { uid, role, status: mems.docs[0]?.data().status || "", membershipDocs: mems.size, appAssignments: asg.docs.map((d) => `${d.data().appId}:${d.data().status}`), legacyPointer: legacyHere };
  await logAuditEvent({ action: "team.purge_leftover", actor: c, targetType: "organization", targetId: organizationId, details: summary });
  await Promise.all([...mems.docs, ...asg.docs].map((d) => d.ref.delete()));
  if (legacyHere) await legacy.ref.delete();
  return { ok: true, deleted: summary };
}

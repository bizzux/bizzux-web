// Binds an Attendance employee record to a Bizzux identity once that identity has joined the company (for example after accepting a link request).
// Tenant-scoped by construction (the path is customers/{organizationId}/attEmployees/{id}, and the organization comes from the verified request),
// idempotent (binding to the same uid again is a no-op), and it NEVER moves a record that is already bound to someone else or that signs in by email.
import { adminDb } from "../firebaseAdmin";
import { logAuditEvent } from "../audit";

export async function bindEmployeeToIdentity({ organizationId, employeeId, uid, username, actor, via }) {
  if (!organizationId || !employeeId || !uid) return { bound: false, reason: "missing" };
  const ref = adminDb().doc(`customers/${organizationId}/attEmployees/${employeeId}`);
  const out = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { bound: false, reason: "employee_missing" };
    const d = snap.data();
    if (d.userId === uid) return { bound: true, already: true };
    if (d.userId) return { bound: false, reason: "bound_to_other" };
    if (d.loginEmail) return { bound: false, reason: "has_email_login" };
    // One identity maps to ONE employee record per company: a second binding would make "who is this person" ambiguous.
    const other = await tx.get(adminDb().collection(`customers/${organizationId}/attEmployees`).where("userId", "==", uid).limit(2));
    if (other.docs.some((x) => x.id !== employeeId)) return { bound: false, reason: "identity_already_bound" };
    tx.update(ref, { userId: uid, loginUsername: username || "", loginKind: "username", updatedAt: new Date().toISOString(), boundVia: via || "link_request" });
    return { bound: true };
  });
  if (out.bound && !out.already) {
    await logAuditEvent({ action: "user.bind_employee", actor: actor || { uid }, targetType: "user", targetId: uid, details: { organizationId, employeeId, via: via || "link_request" } }).catch(() => {});
  }
  return out;
}

// A request may only name an employee of the caller's own company that is still unbound.
export async function assertBindable(organizationId, employeeId, uid = "") {
  const snap = await adminDb().doc(`customers/${organizationId}/attEmployees/${employeeId}`).get();
  if (!snap.exists) throw { status: 404, message: "That person was not found in your company" };
  const d = snap.data();
  if (uid && d.userId === uid) return; // already this person: a repeat is a no-op
  if (d.userId || d.loginEmail) throw { status: 409, message: "That person already has a sign-in" };
}

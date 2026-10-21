// Contacts: people and businesses your company deals with who do NOT sign in to Bizzux (suppliers, external staff, advisers). A contact is never an
// identity: nothing here creates a login, a membership or app access. Tenant-scoped by path (customers/{org}/contacts), authorized by the
// organization role (users.view to read, users.create to change), audited.
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../firebaseAdmin";
import { logAuditEvent } from "../audit";
import { loadOrgSubject } from "../authz/orgAuthz";
import { orgCan } from "../authz/policy.js";
import { resolveOrganizationId } from "./identityService";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const t = (v, n) => String(v || "").trim().slice(0, n);

async function guard(c, requestedOrg, permission) {
  const organizationId = resolveOrganizationId(c, requestedOrg);
  if (!c.isSuper) {
    const subject = c.orgSubject || (await loadOrgSubject(adminDb(), { accountId: organizationId, isOwner: c.isOwner, profile: c.profile }, c.uid));
    if (!orgCan(subject, permission)) throw { status: 403, message: "You don't have permission for this" };
  }
  return organizationId;
}
const col = (org) => adminDb().collection(`customers/${org}/contacts`);

export function cleanContact(b) {
  const name = t(b.name, 120);
  if (!name) throw { status: 400, message: "Name is required" };
  const email = t(b.email, 200).toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw { status: 400, message: "Enter a valid email address" };
  return { name, email, phone: t(b.phone, 40), company: t(b.company, 120), notes: t(b.notes, 500) };
}

export async function listContacts({ actor: c, organizationId: requested }) {
  const org = await guard(c, requested, "users.view");
  const snap = await col(org).limit(1000).get();
  return snap.docs.map((d) => { const x = d.data(); return { id: d.id, name: x.name || "", email: x.email || "", phone: x.phone || "", company: x.company || "", notes: x.notes || "", createdAtMs: x.createdAtMs || 0 }; })
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

export async function saveContact({ actor: c, organizationId: requested, id, data }) {
  const org = await guard(c, requested, "users.create");
  const clean = cleanContact(data || {});
  if (clean.email) {
    const dup = await col(org).where("email", "==", clean.email).limit(2).get();
    if (dup.docs.some((d) => d.id !== id)) throw { status: 409, message: "A contact with that email already exists" };
  }
  if (id) {
    const ref = col(org).doc(String(id));
    if (!(await ref.get()).exists) throw { status: 404, message: "Not found" };
    await ref.set({ ...clean, updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid }, { merge: true });
    await logAuditEvent({ action: "contact.update", actor: c, targetType: "contact", targetId: String(id), details: { organizationId: org } });
    return { ok: true, id: String(id) };
  }
  const ref = await col(org).add({ ...clean, createdAt: FieldValue.serverTimestamp(), createdAtMs: Date.now(), createdBy: c.uid });
  await logAuditEvent({ action: "contact.create", actor: c, targetType: "contact", targetId: ref.id, details: { organizationId: org } });
  return { ok: true, id: ref.id };
}

export async function deleteContact({ actor: c, organizationId: requested, id }) {
  const org = await guard(c, requested, "users.create");
  const ref = col(org).doc(String(id || ""));
  if (!id || !(await ref.get()).exists) throw { status: 404, message: "Not found" };
  await ref.delete();
  await logAuditEvent({ action: "contact.delete", actor: c, targetType: "contact", targetId: String(id), details: { organizationId: org } });
  return { ok: true };
}

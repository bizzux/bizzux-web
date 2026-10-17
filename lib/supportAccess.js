// SERVER ONLY. Approved, scoped, time-limited, audited support access.
//
// Replaces the old unrestricted "open as organization" (?asOrg=) hand-off.
// A support person can only open a customer's app through a GRANT:
//   supportAccessGrants/{id} {
//     organizationId, organizationName,
//     requestedBy{Uid,Email,Role}, reason,
//     apps[]            which apps the grant covers (scope)
//     minutes           how long access lasts once approved
//     status            pending | approved | denied | revoked
//     approvedBy{Uid,Email}, approvedAt, expiresAt   (set on approval)
//     requestExpiresAt  an unanswered request lapses after 24h
//     useCount, lastUsedAt, autoApproved
//   }
// Approval is Platform Owner only (support.access.approve is never delegable).
// When the Owner requests access for themself it is approved immediately, but
// still creates a grant so every open is scoped, time-limited and audited.
//
// What this enforces: no hand-off token is minted without a valid grant for
// that exact organization, app and requester, inside its window. What it does
// NOT do (and the UI says so): the opened app opens as the organization's
// owner, so it cannot be made read-only, and once opened the app's own
// session policy governs how long that browser session lasts. Tokens carry the
// grant id and expiry so apps can honour them.
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";
import { logAuditEvent } from "./audit";
import { hasPermission } from "./platformRoles";

export const GRANTS = "supportAccessGrants";
export const SUPPORT_DURATIONS = [15, 30, 60, 120];
export const SUPPORT_APPS = [
  "business", "pos", "notes", "files", "projects", "chat", "crm", "mail", "capture", "attendance", "finance",
];
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

const str = (v, n) => String(v ?? "").trim().slice(0, n);
const ms = (t) => (t?.toMillis ? t.toMillis() : t?.toDate ? t.toDate().getTime() : t ? new Date(t).getTime() : 0);
const toIso = (t) => (ms(t) ? new Date(ms(t)).toISOString() : null);

async function storedPermissions(actor) {
  if (!actor.platformRole || actor.platformRole === "OWNER") return null;
  const snap = await adminDb().doc("platformAdmins/" + actor.uid).get();
  return snap.exists ? snap.data().permissions : null;
}
async function assertPerm(actor, perm) {
  if (!hasPermission(actor.platformRole, await storedPermissions(actor), perm)) {
    throw { status: 403, message: perm === "support.access.approve" ? "Only the Platform Owner can approve support access" : "You don't have permission for this action (" + perm + ")" };
  }
}

// Effective state, computed from the stored record and the clock.
export function grantState(g, now = Date.now()) {
  if (g.status === "approved") return ms(g.expiresAt) > now ? "active" : "expired";
  if (g.status === "pending") return ms(g.requestExpiresAt) > now ? "pending" : "lapsed";
  return g.status; // denied | revoked
}

function publicGrant(id, g) {
  return {
    id, organizationId: g.organizationId, organizationName: g.organizationName || "",
    requestedByUid: g.requestedByUid, requestedByEmail: g.requestedByEmail, requestedByRole: g.requestedByRole,
    reason: g.reason, apps: g.apps, minutes: g.minutes, status: g.status, state: grantState(g),
    approvedByEmail: g.approvedByEmail || null, approvedAt: toIso(g.approvedAt), expiresAt: toIso(g.expiresAt),
    requestedAt: toIso(g.requestedAt), autoApproved: !!g.autoApproved,
    useCount: g.useCount || 0, lastUsedAt: toIso(g.lastUsedAt), deniedReason: g.deniedReason || null,
  };
}

export async function requestSupportAccess({ actor, organizationId, apps, minutes, reason }) {
  await assertPerm(actor, "support.access.request");
  const orgId = str(organizationId, 128);
  const why = str(reason, 300);
  if (why.length < 3) throw { status: 400, message: "A reason is required (it is recorded in the audit log)" };
  const scope = [...new Set(Array.isArray(apps) ? apps : [])];
  if (!scope.length) throw { status: 400, message: "Choose at least one application" };
  const bad = scope.filter((a) => !SUPPORT_APPS.includes(a));
  if (bad.length) throw { status: 400, message: "Unknown application: " + bad.join(", ") };
  const mins = parseInt(minutes, 10);
  if (!SUPPORT_DURATIONS.includes(mins)) throw { status: 400, message: "Choose a duration: " + SUPPORT_DURATIONS.join(", ") + " minutes" };

  const db = adminDb();
  const cust = await db.doc("customers/" + orgId).get();
  if (!cust.exists) throw { status: 404, message: "This organization has no customer account to open apps for" };

  // One open request per person per organization: return it instead of stacking.
  const mine = await db.collection(GRANTS).where("organizationId", "==", orgId).where("requestedByUid", "==", actor.uid).get();
  const open = mine.docs.find((d) => ["pending", "active"].includes(grantState(d.data())));
  if (open) return { ...publicGrant(open.id, open.data()), existing: true };

  const now = Date.now();
  const owner = actor.platformRole === "OWNER";
  const grant = {
    organizationId: orgId, organizationName: cust.data().organizationName || cust.data().companyName || "",
    requestedByUid: actor.uid, requestedByEmail: actor.email || "", requestedByRole: actor.platformRole || null,
    reason: why, apps: scope, minutes: mins, requestedAt: FieldValue.serverTimestamp(),
    requestExpiresAt: Timestamp.fromMillis(now + REQUEST_TTL_MS), useCount: 0, autoApproved: false,
    ...(owner
      ? { status: "approved", autoApproved: true, approvedByUid: actor.uid, approvedByEmail: actor.email || "", approvedAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + mins * 60000) }
      : { status: "pending" }),
  };
  const ref = await db.collection(GRANTS).add(grant);
  await logAuditEvent({
    action: "support_access.requested", actor, targetType: "organization", targetId: orgId,
    details: { grantId: ref.id, apps: scope, minutes: mins, reason: why, autoApproved: owner },
  });
  if (owner) {
    await logAuditEvent({
      action: "support_access.approved", actor, targetType: "organization", targetId: orgId,
      details: { grantId: ref.id, apps: scope, minutes: mins, autoApproved: true },
    });
  }
  const saved = await ref.get();
  return publicGrant(ref.id, saved.data());
}

async function loadGrant(grantId) {
  const id = str(grantId, 128);
  if (!id) throw { status: 400, message: "Grant id required" };
  const ref = adminDb().doc(GRANTS + "/" + id);
  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: "Support access request not found" };
  return { id, ref, g: snap.data() };
}

export async function approveSupportAccess({ actor, grantId, minutes }) {
  await assertPerm(actor, "support.access.approve");
  const { id, ref, g } = await loadGrant(grantId);
  if (grantState(g) !== "pending") throw { status: 409, message: "This request is no longer pending" };
  let mins = g.minutes;
  if (minutes !== undefined && minutes !== null && minutes !== "") {
    mins = parseInt(minutes, 10);
    if (!SUPPORT_DURATIONS.includes(mins) || mins > g.minutes) throw { status: 400, message: "Approved time can't exceed what was requested (" + g.minutes + " min)" };
  }
  const now = Date.now();
  await ref.update({
    status: "approved", approvedByUid: actor.uid, approvedByEmail: actor.email || "",
    approvedAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + mins * 60000), minutes: mins,
  });
  await logAuditEvent({
    action: "support_access.approved", actor, targetType: "organization", targetId: g.organizationId,
    details: { grantId: id, requestedBy: g.requestedByEmail, apps: g.apps, minutes: mins, reason: g.reason },
  });
  return { ok: true };
}

export async function denySupportAccess({ actor, grantId, reason }) {
  await assertPerm(actor, "support.access.approve");
  const { id, ref, g } = await loadGrant(grantId);
  if (grantState(g) !== "pending") throw { status: 409, message: "This request is no longer pending" };
  await ref.update({ status: "denied", deniedReason: str(reason, 300) || null, deniedByEmail: actor.email || "", deniedAt: FieldValue.serverTimestamp() });
  await logAuditEvent({
    action: "support_access.denied", actor, targetType: "organization", targetId: g.organizationId,
    details: { grantId: id, requestedBy: g.requestedByEmail, reason: str(reason, 300) || null },
  });
  return { ok: true };
}

// The requester may end their own access early; the Owner may end any.
export async function revokeSupportAccess({ actor, grantId }) {
  const { id, ref, g } = await loadGrant(grantId);
  if (g.requestedByUid !== actor.uid) await assertPerm(actor, "support.access.approve");
  else await assertPerm(actor, "support.access.request");
  if (!["pending", "approved"].includes(g.status)) throw { status: 409, message: "This access has already ended" };
  await ref.update({ status: "revoked", revokedByEmail: actor.email || "", revokedAt: FieldValue.serverTimestamp() });
  await logAuditEvent({
    action: "support_access.revoked", actor, targetType: "organization", targetId: g.organizationId,
    details: { grantId: id, requestedBy: g.requestedByEmail },
  });
  return { ok: true };
}

// organizationId given: that organization's grants (Owner sees everyone's,
// others only their own). pending: the Owner's approval queue.
export async function listSupportAccess({ actor, organizationId, pending }) {
  const db = adminDb();
  const owner = actor.platformRole === "OWNER";
  if (pending) {
    await assertPerm(actor, "support.access.approve");
    const snap = await db.collection(GRANTS).where("status", "==", "pending").limit(50).get();
    return { grants: snap.docs.map((d) => publicGrant(d.id, d.data())).filter((g) => g.state === "pending") };
  }
  await assertPerm(actor, "support.access.request");
  const orgId = str(organizationId, 128);
  if (!orgId) throw { status: 400, message: "Organization required" };
  const snap = await db.collection(GRANTS).where("organizationId", "==", orgId).limit(100).get();
  const grants = snap.docs
    .filter((d) => owner || d.data().requestedByUid === actor.uid)
    .map((d) => publicGrant(d.id, d.data()))
    .sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")))
    .slice(0, 30);
  return { grants };
}

// Called by the SSO hand-off routes. Succeeds only for the requester, inside
// the approved window, for an app in scope; records the use. Returns the grant
// so the route can stamp the token with the grant id and expiry.
export async function consumeGrantForOpen({ actor, organizationId, appKey, grantId }) {
  const deny = (message) => ({ status: 403, code: "support_access_required", message });
  // The holder must still be staff with the request permission right now.
  await assertPerm(actor, "support.access.request");
  if (!grantId) throw deny("Opening a customer's app now requires approved support access. Request it under Organizations > Support.");
  const snap = await adminDb().doc(GRANTS + "/" + String(grantId).slice(0, 128)).get();
  if (!snap.exists) throw deny("Support access grant not found.");
  const g = snap.data();
  if (g.requestedByUid !== actor.uid) throw deny("This support access was granted to someone else.");
  if (g.organizationId !== organizationId) throw deny("This support access is for a different organization.");
  const state = grantState(g);
  if (state !== "active") throw deny(state === "pending" ? "Support access is still waiting for the Platform Owner's approval." : "This support access is " + state + ".");
  if (!g.apps.includes(appKey)) throw deny("This support access does not include that application.");
  await snap.ref.update({ useCount: FieldValue.increment(1), lastUsedAt: FieldValue.serverTimestamp() });
  await logAuditEvent({
    action: "support_access.used", actor, targetType: "organization", targetId: organizationId,
    details: { grantId: snap.id, app: appKey, expiresAt: toIso(g.expiresAt), reason: g.reason },
  });
  return { id: snap.id, expiresAtMs: ms(g.expiresAt) };
}

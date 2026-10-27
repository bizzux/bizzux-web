// SERVER ONLY — platform administrator access: invitations, role changes,
// revocation and the roster. Every grant goes through here so the rules live
// in one place:
//   - only the Platform Owner (platform.roles.manage is Owner-only) grants
//   - OWNER can never be granted, changed or removed through any request
//   - an invitation works for one email, once, until it expires; only a hash
//     of the token is stored; no password is ever created or emailed
//   - accepting needs a verified email that matches the invitation and
//     completed two-step verification; only then does the backend activate
//     platformAdmins/{uid}
//   - every change is written to auditLogs
import { createHash, randomBytes } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { Resend } from "resend";
import { adminAuth, adminDb } from "./firebaseAdmin";
import { logAuditEvent } from "./audit";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "./platformRoles";
import { platformInviteEmailHtml } from "./emailTemplates";

export const INVITE_TTL_DAYS = 7;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const iso = (ts) => (ts && typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts || null);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw { status: 400, message: "Enter a valid email address." };
  return email;
}

export function assertAssignableRole(role) {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw { status: 400, message: role === "OWNER" ? "The Platform Owner role can't be assigned." : "Choose a valid role." };
  }
  return role;
}

async function adminDocsByEmail(email) {
  return (await adminDb().collection("platformAdmins").where("email", "==", email).get()).docs;
}

// A platformAdmins record is keyed by Firebase Auth uid. If that sign-in was deleted (for example in the Firebase
// console) and the person signed up again, they have a new uid and the old record is an orphan nobody can use.
// Any lookup error other than "not found" counts as "exists", so a transient failure never unblocks anything.
async function authUserMissing(uid) {
  try { await adminAuth().getUser(uid); return false; } catch (e) { return e?.code === "auth/user-not-found"; }
}

async function sendInviteEmail({ email, role, actor, token, origin }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw { status: 500, message: "Email delivery isn't configured (RESEND_API_KEY)." };
  const from = process.env.RESEND_FROM_EMAIL || "Bizzux <verify@verify.bizzux.com>";
  const { error } = await new Resend(apiKey).emails.send({
    from, to: email, subject: "You're invited to the Bizzux platform team",
    html: platformInviteEmailHtml({
      roleLabel: ROLE_LABELS[role], invitedBy: actor.email, expiresDays: INVITE_TTL_DAYS,
      acceptUrl: `${origin}/accept-platform-invite?token=${token}`,
    }),
  });
  if (error) throw { status: 502, message: "The invitation was saved but the email could not be sent: " + (error.message || "unknown error") };
}

// Creates (or replaces) the single pending invitation for an email.
// `send` is injectable so tests don't need an email provider.
export async function createInvitation({ actor, email, role, origin, send = sendInviteEmail }) {
  email = normalizeEmail(email);
  assertAssignableRole(role);
  const existing = await adminDocsByEmail(email);
  if (existing.some((d) => d.data().role === "OWNER")) throw { status: 400, message: "That account is the Platform Owner." };
  // An orphaned record (its sign-in no longer exists) doesn't block: accepting replaces it.
  for (const d of existing) {
    if (d.data().status !== "disabled" && !(await authUserMissing(d.id))) {
      throw { status: 409, message: "That person is already a platform administrator. Use Change role instead." };
    }
  }
  const db = adminDb();
  // One pending invitation per email: a new one supersedes (revokes) the old.
  const pending = await db.collection("platformInvitations").where("email", "==", email).where("status", "==", "pending").get();
  const token = randomBytes(32).toString("base64url");
  const ref = db.doc("platformInvitations/" + sha(token));
  const batch = db.batch();
  pending.docs.forEach((d) => batch.update(d.ref, { status: "revoked", revokedAt: FieldValue.serverTimestamp(), supersededBy: ref.id }));
  batch.set(ref, {
    email, role, status: "pending", invitedByUid: actor.uid, invitedBy: actor.email,
    createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_DAYS * 86400000),
    resendOf: pending.empty ? null : pending.docs[0].id,
  });
  await batch.commit();
  await logAuditEvent({
    action: pending.empty ? "platform_admin.invite" : "platform_admin.invite_resend", actor,
    targetType: "platformInvitation", targetId: ref.id, details: { email, role },
  });
  try {
    await send({ email, role, actor, token, origin });
  } catch (e) {
    await ref.update({ status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokeReason: "email_failed" });
    throw e;
  }
  return { id: ref.id, email, role, token };
}

export async function revokeInvitation({ actor, id }) {
  const ref = adminDb().doc("platformInvitations/" + String(id || ""));
  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: "Invitation not found." };
  if (snap.data().status !== "pending") throw { status: 400, message: "That invitation is no longer pending." };
  await ref.update({ status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokedBy: actor.email });
  await logAuditEvent({ action: "platform_admin.invite_revoke", actor, targetType: "platformInvitation", targetId: ref.id, details: { email: snap.data().email, role: snap.data().role } });
}

// What a signed-in visitor sees before accepting (no secrets).
export async function inspectInvitation(token) {
  const snap = await adminDb().doc("platformInvitations/" + sha(String(token || ""))).get();
  if (!snap.exists) return { state: "invalid" };
  const d = snap.data();
  if (d.status === "accepted") return { state: "used" };
  if (d.status !== "pending") return { state: "invalid" };
  if (d.expiresAt.toMillis() < Date.now()) return { state: "expired" };
  return { state: "ok", email: d.email, role: d.role, roleLabel: ROLE_LABELS[d.role] };
}

// Activates the approved assignment for the signed-in caller `c` (from
// requireUser). `mfaEnabled(uid)` is injectable for tests.
export async function acceptInvitation({ c, token, mfaEnabled }) {
  const ref = adminDb().doc("platformInvitations/" + sha(String(token || "")));
  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: "This invitation is invalid." };
  const inv = snap.data();
  if (inv.status !== "pending") throw { status: 410, message: inv.status === "accepted" ? "This invitation was already used." : "This invitation is no longer valid." };
  if (inv.expiresAt.toMillis() < Date.now()) throw { status: 410, message: "This invitation has expired. Ask the Platform Owner to resend it." };
  if (c.email !== inv.email) throw { status: 403, message: `This invitation is for ${inv.email}. Sign in with that address.` };
  if (!c.emailVerified) throw { status: 403, code: "email_unverified", message: "Verify your email address first, then accept the invitation." };
  const ok = mfaEnabled ? await mfaEnabled(c.uid) : (await adminDb().doc("twoFactor/" + c.uid).get()).data()?.enabled === true;
  if (!ok) throw { status: 403, code: "mfa_required", message: "Turn on two-step verification, then accept the invitation again." };

  const adminRef = adminDb().doc("platformAdmins/" + c.uid);
  // Orphaned records for this email (their sign-in was deleted) are replaced by this one, so the roster
  // doesn't keep a dead entry and a later invite isn't confused by it. Never an OWNER record.
  const stale = [];
  for (const d of await adminDocsByEmail(inv.email)) {
    if (d.id !== c.uid && d.data().role !== "OWNER" && (await authUserMissing(d.id))) stale.push({ uid: d.id, role: d.data().role });
  }
  await adminDb().runTransaction(async (tx) => {
    const [cur, fresh] = await Promise.all([tx.get(adminRef), tx.get(ref)]);
    if (fresh.data().status !== "pending") throw { status: 410, message: "This invitation was already used." };
    if (cur.exists && cur.data().role === "OWNER") throw { status: 400, message: "That account is the Platform Owner." };
    stale.forEach((s) => tx.delete(adminDb().doc("platformAdmins/" + s.uid)));
    tx.set(adminRef, {
      email: inv.email, role: inv.role, status: "active", permissions: null,
      createdBy: inv.invitedBy, invitedBy: inv.invitedBy, invitedAt: inv.createdAt,
      createdAt: cur.exists ? cur.data().createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      activatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(ref, { status: "accepted", acceptedAt: FieldValue.serverTimestamp(), acceptedByUid: c.uid });
  });
  await logAuditEvent({
    action: "platform_admin.invite_accept", actor: { uid: c.uid, email: c.email, platformRole: inv.role },
    targetType: "platformAdmin", targetId: c.uid, details: { email: inv.email, role: inv.role, grantedBy: inv.invitedBy },
  });
  for (const s of stale) {
    await logAuditEvent({
      action: "platform_admin.orphan_replaced", actor: { uid: c.uid, email: c.email, platformRole: inv.role },
      targetType: "platformAdmin", targetId: s.uid, details: { email: inv.email, role: s.role, replacedByUid: c.uid },
    });
  }
  return { role: inv.role };
}

export async function changeRole({ actor, uid, role }) {
  assertAssignableRole(role);
  const ref = adminDb().doc("platformAdmins/" + String(uid || ""));
  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: "Administrator not found." };
  const cur = snap.data();
  if (cur.role === "OWNER") throw { status: 400, message: "The Platform Owner's role can't be changed." };
  if (cur.role === role) return { unchanged: true };
  await ref.update({ role, permissions: null, updatedAt: FieldValue.serverTimestamp(), roleChangedBy: actor.email });
  await logAuditEvent({ action: "platform_admin.role_change", actor, targetType: "platformAdmin", targetId: uid, details: { email: cur.email, from: cur.role, to: role } });
  return { ok: true };
}

// Disable (revoke access) or reactivate. Disabling also invalidates the
// person's refresh tokens so existing sessions stop quickly; platform
// permissions are re-read from Firestore on every request regardless.
export async function setAccess({ actor, uid, enable }) {
  const ref = adminDb().doc("platformAdmins/" + String(uid || ""));
  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: "Administrator not found." };
  if (snap.data().role === "OWNER") throw { status: 400, message: "The Platform Owner can't be disabled." };
  await ref.update({ status: enable ? "active" : "disabled", updatedAt: FieldValue.serverTimestamp() });
  if (!enable) {
    try { await adminAuth().revokeRefreshTokens(uid); } catch (e) { console.error("revokeRefreshTokens failed", e?.message || e); }
  }
  await logAuditEvent({
    action: enable ? "platform_admin.reactivate" : "platform_admin.disable", actor,
    targetType: "platformAdmin", targetId: uid, details: { email: snap.data().email, role: snap.data().role },
  });
}

// Remove a platform administrator record entirely (the person can be invited again later). Never the Owner. Their sign-in sessions are revoked
// and their account is untouched, so they keep any company they own.
export async function removeAdmin({ actor, uid }) {
  const ref = adminDb().doc("platformAdmins/" + String(uid || ""));
  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: "Administrator not found." };
  if (snap.data().role === "OWNER") throw { status: 400, message: "The Platform Owner can't be removed." };
  await ref.delete();
  try { await adminAuth().revokeRefreshTokens(String(uid)); } catch (e) { console.error("revokeRefreshTokens failed", e?.message || e); }
  await logAuditEvent({
    action: "platform_admin.remove", actor, targetType: "platformAdmin", targetId: String(uid),
    details: { email: snap.data().email, role: snap.data().role },
  });
}

export async function listAdministrators({ includeInvitations }) {
  const db = adminDb();
  const snap = await db.collection("platformAdmins").orderBy("createdAt", "asc").get();
  const uids = snap.docs.map((d) => d.id);
  const authUsers = new Map();
  const missing = new Set(); // only uids Auth positively reported as not found; a failed lookup flags nothing
  for (let i = 0; i < uids.length; i += 100) {
    try {
      const r = await adminAuth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
      r.users.forEach((u) => authUsers.set(u.uid, u));
      r.notFound.forEach((id) => missing.add(id.uid));
    } catch (e) { console.error("getUsers failed", e?.message || e); }
  }
  const mfa = new Map();
  if (uids.length) {
    const docs = await db.getAll(...uids.map((u) => db.doc("twoFactor/" + u)));
    docs.forEach((d) => mfa.set(d.id, d.exists && d.data().enabled === true));
  }
  const admins = snap.docs.map((d) => {
    const x = d.data();
    const u = authUsers.get(d.id);
    return {
      uid: d.id, email: x.email, displayName: u?.displayName || null, role: x.role, roleLabel: ROLE_LABELS[x.role] || x.role,
      status: x.status || "active", signInDeleted: missing.has(d.id),
      lastSignIn: u?.metadata?.lastSignInTime || null, mfaEnabled: mfa.get(d.id) === true,
      invitedBy: x.invitedBy || x.createdBy || null, invitedAt: iso(x.invitedAt) || iso(x.createdAt), createdAt: iso(x.createdAt),
    };
  });
  let invitations = [];
  if (includeInvitations) {
    const q = await db.collection("platformInvitations").where("status", "==", "pending").get();
    invitations = q.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id, email: x.email, role: x.role, roleLabel: ROLE_LABELS[x.role], invitedBy: x.invitedBy,
        invitedAt: iso(x.createdAt), expiresAt: iso(x.expiresAt), expired: x.expiresAt.toMillis() < Date.now(),
      };
    }).sort((a, b) => String(b.invitedAt).localeCompare(String(a.invitedAt)));
  }
  return { admins, invitations };
}

export async function adminHistory(uid) {
  const q = await adminDb().collection("auditLogs").where("targetType", "==", "platformAdmin").where("targetId", "==", String(uid)).limit(100).get();
  return q.docs.map((d) => {
    const x = d.data();
    return { id: d.id, action: x.action, actorEmail: x.actorEmail, details: x.details || {}, createdAt: iso(x.createdAt) };
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

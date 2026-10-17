// SERVER ONLY. Post-creation management of an organization's details and
// users from Super Admin -> Organizations -> Manage. Everything is tenant
// scoped (the target uid must belong to the organization in the request),
// permission checked (organizations.manage) and audited. Only admin-managed
// organizations can be edited; self-service organizations manage themselves.
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb, generateTempPassword } from "./firebaseAdmin";
import { COUNTRIES } from "./countries";
import { PROFILE_VALUES, DEFAULT_PROFILE } from "./roles";
import { logAuditEvent } from "./audit";
import { upsertOrganizationMembership, roleFromProfile } from "./organizationMembership";
import { upsertAppAssignment } from "./appAccess";
import { safeSyncDirectory } from "./orgDirectory";
import { resolveOrgOwners } from "./orgOwners";
import { usernameForUid, setUsernamePassword, tempExpiry } from "./usernameAuth";
import {
  assertOrgPermission, loadOrg, isAdminManaged, lockRef, nameKeyFor, parseApps, parsePerson,
  createIdentity, writeMember, sendOrgInviteEmail, str, INDUSTRIES,
} from "./orgProvisioning";

async function loadManaged(actor, organizationId) {
  await assertOrgPermission(actor, "organizations.manage");
  const ctx = await loadOrg(organizationId);
  if (!isAdminManaged(ctx.org, ctx.customer)) {
    throw { status: 400, message: "Self-service organizations manage their own details and users" };
  }
  return ctx;
}

async function teamDocFor(orgId, uid) {
  const snap = await adminDb().collection("customers/" + orgId + "/team").where("uid", "==", uid).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

// The uid must be the organization's admin or one of its team members.
async function requireMember(ctx, uid) {
  uid = str(uid, 128);
  if (!uid) throw { status: 400, message: "User required" };
  if (ctx.org.adminUid && uid === ctx.org.adminUid) return { isAdmin: true, teamDoc: null, uid };
  const teamDoc = await teamDocFor(ctx.id, uid);
  if (!teamDoc) throw { status: 404, message: "User not found in this organization" };
  return { isAdmin: false, teamDoc, uid };
}

// --- Organization details -----------------------------------------------
export async function updateOrganizationDetails({ actor, organizationId, body }) {
  const { id, org, orgRef, customer, custRef } = await loadManaged(actor, organizationId);
  const orgPatch = { updatedAt: FieldValue.serverTimestamp() };
  const custPatch = {};
  const changed = [];

  if (body.organizationName !== undefined) {
    const name = str(body.organizationName, 160);
    if (!name) throw { status: 400, message: "Organization name is required" };
    const current = org.organizationName || org.name;
    if (name !== current) {
      const countryCode = str(body.countryCode ?? org.countryCode, 2).toUpperCase();
      // Real companies keep the unique-name lock; Test organizations have none.
      if (org.nameKey) {
        const key = nameKeyFor(name, countryCode);
        if (key !== org.nameKey) {
          try {
            await lockRef(key).create({ requestId: "rename-" + id, nameKey: key, createdAt: FieldValue.serverTimestamp() });
          } catch {
            throw { status: 409, message: "An organization with this name already exists in that country" };
          }
          await lockRef(org.nameKey).delete().catch(() => {});
          orgPatch.nameKey = key;
        }
      }
      orgPatch.organizationName = name; orgPatch.name = name;
      custPatch.organizationName = name; custPatch.companyName = name;
      changed.push("organizationName");
    }
  }
  if (body.industry !== undefined) {
    const v = str(body.industry, 60);
    if (!INDUSTRIES.includes(v)) throw { status: 400, message: "Choose a valid industry" };
    orgPatch.industry = v; custPatch.industry = v; changed.push("industry");
  }
  if (body.countryCode !== undefined) {
    const code = str(body.countryCode, 2).toUpperCase();
    const country = COUNTRIES.find(([c]) => c === code);
    if (!country) throw { status: 400, message: "Choose a valid country" };
    orgPatch.countryCode = code; orgPatch.countryName = country[1];
    custPatch.countryCode = code; custPatch.country = country[1]; changed.push("country");
  }
  for (const [k, n] of [["state", 100], ["city", 100], ["timezone", 60]]) {
    if (body[k] !== undefined) { const v = str(body[k], n); orgPatch[k] = v; custPatch[k] = v; changed.push(k); }
  }
  if (body.currency !== undefined) {
    const v = str(body.currency, 10).toUpperCase();
    if (!v) throw { status: 400, message: "Currency is required" };
    orgPatch.currency = v; custPatch.currency = v; changed.push("currency");
  }
  if (body.businessType !== undefined) { const v = str(body.businessType, 60) || null; orgPatch.businessType = v; changed.push("businessType"); }
  if (body.employeeCount !== undefined) {
    const n = body.employeeCount === "" || body.employeeCount === null ? null : parseInt(body.employeeCount, 10);
    if (n !== null && !(n >= 0 && n <= 10000000)) throw { status: 400, message: "Employee count is not valid" };
    orgPatch.employeeCount = n; changed.push("employeeCount");
  }
  orgPatch.updatedBy = actor.uid;
  if (body.contactEmail !== undefined) { const v = str(body.contactEmail, 200).toLowerCase(); orgPatch.contactEmail = v; custPatch.email = v; changed.push("contactEmail"); }
  if (body.contactPhone !== undefined) { const v = str(body.contactPhone, 20); orgPatch.contactPhone = v; custPatch.phone = v; changed.push("contactPhone"); }

  await orgRef.set(orgPatch, { merge: true });
  if (customer && Object.keys(custPatch).length) await custRef.set(custPatch, { merge: true });
  await logAuditEvent({
    action: "organization.details_updated", actor, targetType: "organization", targetId: id,
    details: { fields: changed, ...(orgPatch.organizationName ? { from: org.organizationName || org.name, to: orgPatch.organizationName } : {}) },
  });
  await safeSyncDirectory(id);
  return { ok: true };
}

// --- Users ---------------------------------------------------------------
export async function listOrgUsers({ actor, organizationId, readOnly = false }) {
  // readOnly: any organization (including self-service), view permission only.
  let ctx;
  if (readOnly) { await assertOrgPermission(actor, "organizations.view"); ctx = await loadOrg(organizationId); }
  else ctx = await loadManaged(actor, organizationId);
  const { id, org, customer } = ctx;
  const canEdit = !readOnly && isAdminManaged(org, customer);
  const db = adminDb();
  const [names, team, assigns] = await Promise.all([
    db.collection("usernames").where("organizationId", "==", id).get(),
    db.collection("customers/" + id + "/team").get(),
    db.collection("appAssignments").where("organizationId", "==", id).get(),
  ]);
  const byUid = {};
  names.docs.forEach((d) => { byUid[d.data().uid] = { username: d.id, ...d.data() }; });
  const apps = {};
  assigns.docs.forEach((a) => { const x = a.data(); if (x.status === "ACTIVE") (apps[x.userId] ||= []).push(x.appId); });
  const now = Date.now();
  const info = (uid) => {
    const u = byUid[uid];
    return {
      username: u?.username || null, hasUsernameLogin: !!u,
      disabled: !!u?.disabled, mustChangePassword: !!u?.mustChangePassword,
      locked: !!(u?.lockedUntil && u.lockedUntil.toMillis() > now),
    };
  };
  const users = [];
  if (customer && !org.adminUid) {
    // Self-service organization: the owner is whoever holds the active OWNER membership.
    const o = (await resolveOrgOwners([id]))[id]?.owner;
    if (o) {
      users.push({
        uid: o.uid, isAdmin: true, name: o.name || "", email: o.email || "", phone: customer.phone || "",
        profile: "Organization Owner", apps: apps[o.uid] || [], status: "active", ...info(o.uid),
      });
    }
  }
  if (customer && org.adminUid) {
    users.push({
      uid: org.adminUid, isAdmin: true, name: org.adminName || customer.owner?.name || "",
      email: customer.owner?.email || "", phone: customer.owner?.phone || "",
      profile: "Organization Admin", apps: apps[org.adminUid] || [], status: "active", ...info(org.adminUid),
    });
  }
  for (const t of team.docs) {
    const d = t.data();
    if (!d.uid) continue;
    users.push({
      uid: d.uid, isAdmin: false, name: d.firstName || "", email: d.email || "", phone: d.mobile || "",
      profile: d.profile || d.role || DEFAULT_PROFILE, apps: apps[d.uid] || [],
      status: d.disabled || d.status === "disabled" ? "disabled" : d.status || "active", ...info(d.uid),
    });
  }
  return { users, enabledApps: org.apps || [], seats: org.allowedUsers ?? null, canEdit };
}

async function syncAssignments(orgId, uid, org, apps, role) {
  const enabled = new Set(org.apps || []);
  const wanted = apps.filter((a) => enabled.has(a));
  for (const appId of org.apps || []) {
    await upsertAppAssignment({ organizationId: orgId, userId: uid, appId, role, status: wanted.includes(appId) ? "ACTIVE" : "INACTIVE" });
  }
}

export async function updateOrgUser({ actor, organizationId, uid, body }) {
  const ctx = await loadManaged(actor, organizationId);
  const { id, org, custRef } = ctx;
  const m = await requireMember(ctx, uid);
  const db = adminDb();
  const fullName = body.fullName !== undefined ? str(body.fullName, 80) : null;
  if (fullName !== null && !fullName) throw { status: 400, message: "Name is required" };
  const email = body.email !== undefined ? str(body.email, 200).toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw { status: 400, message: "Enter a valid email address" };
  const phone = body.phone !== undefined ? str(body.phone, 20) : null;
  const apps = body.apps !== undefined ? parseApps(body.apps) : null;
  const disabledByLoginDoc = await usernameForUid(uid);

  if (m.isAdmin) {
    const owner = {};
    if (fullName !== null) owner.name = fullName;
    if (email !== null) owner.email = email;
    if (phone !== null) owner.phone = phone;
    if (Object.keys(owner).length) await custRef.set({ owner }, { merge: true });
    if (fullName !== null) await db.doc("organizations/" + id).set({ adminName: fullName, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (apps) await syncAssignments(id, uid, org, apps, "OWNER");
  } else {
    const profile = body.profile !== undefined ? (PROFILE_VALUES.includes(body.profile) ? body.profile : null) : null;
    if (body.profile !== undefined && !profile) throw { status: 400, message: "Invalid role" };
    const t = {};
    if (fullName !== null) t.firstName = fullName;
    if (email !== null) t.email = email;
    if (phone !== null) t.mobile = phone;
    if (profile) { t.profile = profile; t.role = profile; }
    if (Object.keys(t).length) await m.teamDoc.ref.set(t, { merge: true });
    if (profile) {
      await db.doc("memberships/" + uid).set({ profile, role: profile }, { merge: true });
      await upsertOrganizationMembership({ organizationId: id, userId: uid, role: roleFromProfile(profile, false), status: "active" });
    }
    if (apps) await syncAssignments(id, uid, org, apps, "MEMBER");
  }
  if (fullName !== null) {
    await adminAuth().updateUser(uid, { displayName: fullName }).catch(() => {});
    if (disabledByLoginDoc) await disabledByLoginDoc.ref.update({ displayName: fullName });
  }
  await logAuditEvent({
    action: "organization.user_updated", actor, targetType: "user", targetId: uid,
    details: { organizationId: id, fields: Object.keys(body).filter((k) => ["fullName", "email", "phone", "profile", "apps"].includes(k)) },
  });
  if (m.isAdmin) await safeSyncDirectory(id);
  return { ok: true };
}

export async function resetOrgUserPassword({ actor, organizationId, uid, password, requirePasswordChange = true }) {
  const ctx = await loadManaged(actor, organizationId);
  const m = await requireMember(ctx, uid);
  const doc = await usernameForUid(uid);
  if (!doc) throw { status: 400, message: "This person signs in by email; use their email invitation or the sign-in page's reset instead" };
  const manual = !!String(password || "").trim();
  const pw = manual ? String(password).trim() : generateTempPassword();
  if (pw.length < 8 || pw.length > 100) throw { status: 400, message: "Password must be 8-100 characters" };
  const must = requirePasswordChange !== false;
  await setUsernamePassword(uid, pw, must, { tempExpiresAt: must ? tempExpiry() : null });
  await doc.ref.update({ failedCount: 0, lockedUntil: null });
  // an administrator assigned later is a member (memberships/{uid}); the original owner has no membership doc
  if (m.isAdmin) await ctx.custRef.set({ mustChangePassword: must }, { merge: true });
  if (!m.isAdmin || uid !== ctx.id) await adminDb().doc("memberships/" + uid).set({ mustChangePassword: must }, { merge: true });
  await logAuditEvent({
    action: m.isAdmin ? "organization.admin_password_reset" : "organization.user_password_reset", actor,
    targetType: "user", targetId: uid,
    details: { organizationId: ctx.id, source: manual ? "MANUAL" : "GENERATED", requirePasswordChange: must },
  });
  return { ok: true, username: doc.id, mustChangePassword: must, ...(manual ? {} : { temporaryPassword: pw }) };
}

export async function setOrgUserDisabled({ actor, organizationId, uid, disabled }) {
  const ctx = await loadManaged(actor, organizationId);
  const m = await requireMember(ctx, uid);
  if (m.isAdmin) throw { status: 400, message: "To block the administrator, suspend the organization instead" };
  disabled = !!disabled;
  const doc = await usernameForUid(uid);
  if (doc) await doc.ref.update({ disabled });
  await adminAuth().updateUser(uid, { disabled }).catch(() => {});
  if (disabled) await adminAuth().revokeRefreshTokens(uid).catch(() => {});
  await m.teamDoc.ref.set({ disabled, status: disabled ? "disabled" : "active" }, { merge: true });
  await logAuditEvent({
    action: disabled ? "organization.user_disabled" : "organization.user_enabled", actor,
    targetType: "user", targetId: uid, details: { organizationId: ctx.id },
  });
  return { ok: true };
}

export async function deleteOrgUser({ actor, organizationId, uid }, deps = {}) {
  const ctx = await loadManaged(actor, organizationId);
  const m = await requireMember(ctx, uid);
  if (m.isAdmin) throw { status: 400, message: "The organization administrator can't be deleted here. Reassign or suspend the organization instead." };
  const purge = deps.purgeUser || (await import("./userPurge")).purgeUser;
  const d = m.teamDoc.data();
  const report = await purge({ uid, email: d.email || "", ownsBusiness: false, memberOf: { accountId: ctx.id } });
  const doc = await usernameForUid(uid);
  if (doc) await doc.ref.delete();
  await m.teamDoc.ref.delete().catch(() => {});
  await logAuditEvent({
    action: "organization.user_deleted", actor, targetType: "user", targetId: uid,
    details: { organizationId: ctx.id, name: d.firstName || "", skipped: report?.skipped || [] },
  });
  return { ok: true, skipped: report?.skipped || [] };
}

export async function addOrgUser({ actor, organizationId, body, origin }, deps = {}) {
  const sendInvite = deps.sendInvite || sendOrgInviteEmail;
  const ctx = await loadManaged(actor, organizationId);
  const { id, org } = ctx;
  if (["suspended", "archived"].includes(org.status)) throw { status: 400, message: "Reactivate the organization before adding users" };
  const person = parsePerson(body, "User");
  const profile = PROFILE_VALUES.includes(body.profile) ? body.profile : DEFAULT_PROFILE;
  const enabled = new Set(org.apps || []);
  const apps = parseApps(body.apps).filter((a) => enabled.has(a));
  const u = { ...person, profile, apps };
  const db = adminDb();
  if (org.allowedUsers) {
    const active = (await db.collection("organizationMemberships").where("organizationId", "==", id).where("status", "==", "active").count().get()).data().count;
    if (active + 1 > org.allowedUsers) throw { status: 400, message: "Licensed seats (" + org.allowedUsers + ") are all used. Increase seats in Plan & access first." };
  }
  const written = { authUids: [], usernames: [], refs: [], orgId: null };
  let ident;
  try {
    ident = await createIdentity(u, { organizationId: id, actor, written });
    await writeMember({ actor, orgId: id, u, uid: ident.uid, written });
  } catch (e) {
    const uid = written.authUids[0];
    if (uid) {
      const team = await teamDocFor(id, uid);
      if (team) await team.ref.delete().catch(() => {});
      const asg = await db.collection("appAssignments").where("userId", "==", uid).get();
      await Promise.all(asg.docs.filter((d) => d.data().organizationId === id).map((d) => d.ref.delete()));
      await db.doc("organizationMemberships/" + id + "_" + uid).delete().catch(() => {});
    }
    await Promise.all(written.refs.map((r) => r.delete().catch(() => {})));
    await Promise.all(written.usernames.map((n) => db.doc("usernames/" + n).delete().catch(() => {})));
    await Promise.all(written.authUids.map((x) => adminAuth().deleteUser(x).catch(() => {})));
    throw e;
  }
  let invite = null;
  if (!ident.credential) {
    try {
      await sendInvite({ email: u.email, orgName: org.organizationName || org.name, origin });
      invite = { email: u.email, sent: true };
    } catch (e) {
      invite = { email: u.email, sent: false, error: String(e?.message || e).slice(0, 200) };
    }
  }
  await logAuditEvent({
    action: "organization.user_added", actor, targetType: "user", targetId: ident.uid,
    details: { organizationId: id, profile, loginMethod: u.loginMethod, apps },
  });
  return { ok: true, uid: ident.uid, credential: ident.credential, invite };
}

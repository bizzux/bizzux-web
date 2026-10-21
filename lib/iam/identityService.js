// Shared IAM service. ONE place that creates identities, links them to companies and grants application access, so the portal Users page, the Admin
// Center and every other app (Attendance Add Person included) go through the same tenant check, seat limit, entitlement check, audit trail and
// canonical-membership write. Extracted from /api/admin/username-users, behaviour unchanged. No second identity store: usernames/{u} + Firebase Auth
// + organizationMemberships + appAssignments (+ the existing team/memberships records legacy readers still use).
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb, generateTempPassword } from "../firebaseAdmin";
import { PROFILE_VALUES, DEFAULT_PROFILE } from "../roles";
import { logAuditEvent } from "../audit";
import { upsertOrganizationMembership, roleFromProfile } from "../organizationMembership";
import { getOrganizationAppSubscriptions, upsertAppAssignment } from "../appAccess";
import { APP_IDS } from "../appCatalog";
import { createUsernameUser } from "../usernameAuth";
import { createLinkRequest } from "../linkRequests";
import { cleanExpiry, cleanEmploymentType } from "../accountExpiry";
import { validatePassword } from "../passwordPolicy";

// c = the caller as returned by requireOrgManager(). A company admin is confined to their own company; a Platform Admin may act on any.
export function assertTenant(c, organizationId) {
  if (c.isSuper) return;
  if (c.accountId !== organizationId) throw { status: 403, message: "You can only manage users in your own company" };
}

export const resolveOrganizationId = (c, requested) => {
  const organizationId = String(requested || c.accountId || "").trim();
  if (!organizationId) throw { status: 400, message: "Select a company" };
  assertTenant(c, organizationId);
  return organizationId;
};

export async function enabledAppIds(organizationId) {
  const subs = await getOrganizationAppSubscriptions(organizationId);
  return new Set(subs.filter((s) => s.status === "ACTIVE").map((s) => s.appId));
}

// Only apps the company actually holds can be granted.
export async function checkedApps(organizationId, requested) {
  const apps = (Array.isArray(requested) ? requested : []).filter((a) => APP_IDS.includes(a));
  const enabled = await enabledAppIds(organizationId);
  const denied = apps.filter((a) => !enabled.has(a));
  if (denied.length) throw { status: 400, message: "Not enabled for this company: " + denied.join(", ") };
  return apps;
}

// Create a NEW Bizzux username login (no email needed, no fake mailbox). The temporary password is returned once and never stored in plain text.
export async function createUsernameIdentity({ actor: c, organizationId: requestedOrg, fullName, username, password, profile, apps, mustChangePassword, accountExpiresAt, employmentType, employeeId, department, branch, designation, mobile }) {
  const organizationId = resolveOrganizationId(c, requestedOrg);
  const org = await adminDb().doc("customers/" + organizationId).get();
  if (!org.exists) throw { status: 404, message: "Company not found" };
  if (["suspended", "closed"].includes(org.data().status)) throw { status: 400, message: "Company is not active" };
  if (org.data().allowedUsers) {
    const team = await adminDb().collection("customers/" + organizationId + "/team").count().get();
    if (team.data().count + 1 >= org.data().allowedUsers) throw { status: 400, message: "User limit reached for this company's subscription" };
  }
  const name = String(fullName || "").trim().slice(0, 80);
  if (!name) throw { status: 400, message: "Full name is required" };
  const prof = PROFILE_VALUES.includes(profile) ? profile : DEFAULT_PROFILE;
  const pw = String(password || "").trim() || generateTempPassword();
  const problem = await validatePassword(organizationId, pw);
  if (problem) throw { status: 400, message: problem };
  const appList = await checkedApps(organizationId, apps);
  const expiry = cleanExpiry(accountExpiresAt);
  if (!expiry.ok) throw { status: 400, message: expiry.message };
  const empType = cleanEmploymentType(employmentType);
  const mustChange = mustChangePassword !== false;
  const { uid, username: uname } = await createUsernameUser({
    accountExpiresAt: expiry.value, employmentType: empType, username, password: pw, displayName: name, organizationId,
    mustChangePassword: mustChange, createdBy: c.uid,
  });
  const memberRef = await adminDb().collection("customers/" + organizationId + "/team").add({
    firstName: name, lastName: "", email: "", username: uname, role: prof, profile: prof,
    employeeId: String(employeeId || "").slice(0, 40), employmentType: empType, accountExpiresAt: expiry.value,
    department: String(department || "").slice(0, 80), branch: String(branch || "").slice(0, 80), designation: String(designation || "").slice(0, 80),
    mobile: String(mobile || "").slice(0, 20), mobileVerified: false,
    status: "active", uid, invitedBy: c.email || c.uid, invitedAt: FieldValue.serverTimestamp(), joinedAt: FieldValue.serverTimestamp(),
  });
  await adminDb().doc("memberships/" + uid).set({
    accountId: organizationId, profile: prof, role: prof, username: uname, joinedAt: FieldValue.serverTimestamp(), mustChangePassword: mustChange,
  });
  await upsertOrganizationMembership({ organizationId, userId: uid, role: roleFromProfile(prof, false), status: "active" });
  await Promise.all(appList.map((appId) => upsertAppAssignment({ organizationId, userId: uid, appId, role: "MEMBER", status: "ACTIVE" })));
  await logAuditEvent({ action: "user.create_username", actor: c, targetType: "user", targetId: uid, details: { organizationId, username: uname, profile: prof, apps: appList } });
  return { uid, teamMemberId: memberRef.id, username: uname, password: pw };
}

// Ask an EXISTING username login to join this company; the person must accept. Always answers the same way (no account discovery).
export async function requestLinkToOrganization({ actor: c, organizationId: requestedOrg, username, profile, apps }) {
  const organizationId = resolveOrganizationId(c, requestedOrg);
  return createLinkRequest({ actor: c, organizationId, username, profile, apps });
}

// Replace a person's application access (only company-held apps; the rest are switched off). Scoped to the target's membership in THIS company.
export async function setUserApps({ actor: c, organizationId: requestedOrg, uid, apps }) {
  const organizationId = resolveOrganizationId(c, requestedOrg);
  if (!uid) throw { status: 400, message: "uid required" };
  const member = await adminDb().doc(`organizationMemberships/${organizationId}_${uid}`).get();
  if (!member.exists) throw { status: 404, message: "That person is not a member of this company" };
  const want = new Set(await checkedApps(organizationId, apps));
  await Promise.all(APP_IDS.map((appId) =>
    want.has(appId)
      ? upsertAppAssignment({ organizationId, userId: uid, appId, role: "MEMBER", status: "ACTIVE" })
      : adminDb().doc(`appAssignments/${organizationId}_${uid}_${appId}`).get().then((s) => s.exists && s.ref.update({ status: "INACTIVE", updatedAt: FieldValue.serverTimestamp() }))));
  await logAuditEvent({ action: "user.set_apps", actor: c, targetType: "user", targetId: uid, details: { organizationId, apps: [...want] } });
  return { ok: true, apps: [...want] };
}

// The unified user list for ONE company, read from the canonical organizationMemberships record and joined with the login, the apps and the
// Attendance username records. Never returns hashes, codes or tokens.
export async function listDirectory({ actor: c, organizationId: requestedOrg }) {
  const organizationId = resolveOrganizationId(c, requestedOrg);
  const db = adminDb();
  const [mems, assigns, attLogins, enabled] = await Promise.all([
    db.collection("organizationMemberships").where("organizationId", "==", organizationId).limit(1000).get(),
    db.collection("appAssignments").where("organizationId", "==", organizationId).get(),
    db.collection("attUsernames").where("accountId", "==", organizationId).get(),
    enabledAppIds(organizationId),
  ]);
  const ids = mems.docs.map((d) => d.data().userId).filter(Boolean);
  const authBy = {};
  for (let i = 0; i < ids.length; i += 100) {
    const r = await adminAuth().getUsers(ids.slice(i, i + 100).map((uid) => ({ uid })));
    r.users.forEach((u) => { authBy[u.uid] = u; });
  }
  const unames = {};
  for (let i = 0; i < ids.length; i += 30) {
    const q = await db.collection("usernames").where("uid", "in", ids.slice(i, i + 30)).get();
    q.docs.forEach((d) => {
      const x = d.data();
      unames[x.uid] = { username: d.id, displayName: x.displayName || "", locked: !!(x.lockedUntil && x.lockedUntil.toMillis() > Date.now()), mustChange: !!x.mustChangePassword };
    });
  }
  const att = {};
  attLogins.docs.forEach((d) => { att[d.data().uid] = { username: d.id, status: d.data().status }; });
  const apps = {};
  assigns.docs.forEach((a) => { const x = a.data(); if (x.status === "ACTIVE") (apps[x.userId] ||= []).push(x.appId); });
  const users = mems.docs.map((d) => {
    const m = d.data(); const a = authBy[m.userId]; const u = unames[m.userId]; const l = att[m.userId];
    const loginKind = u ? "username" : l ? "attendance-username" : a?.providerData?.some((p) => p.providerId === "google.com") ? "google" : a?.email ? "email" : "unknown";
    return {
      uid: m.userId, name: a?.displayName || u?.displayName || "", email: a?.email || "", username: u?.username || l?.username || "",
      loginKind, orgRole: m.role || "MEMBER", profile: m.profile || "", status: m.status || "active", permissions: Array.isArray(m.permissions) ? m.permissions : [],
      disabled: !!a?.disabled || m.status === "suspended", locked: !!u?.locked, pendingActivation: !!u?.mustChange || l?.status === "pending",
      apps: (apps[m.userId] || []).sort(), lastSignIn: a?.metadata?.lastSignInTime || null,
    };
  }).sort((x, y) => (x.name || x.username || x.email).localeCompare(y.name || y.username || y.email));
  return { organizationId, users, enabledApps: [...enabled].sort() };
}

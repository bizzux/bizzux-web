// Bizzux central authorization policy. PURE (no imports, no I/O) so the SAME file runs in the portal and in every app (copied byte-for-byte by
// scripts/sync-authz-policy.mjs; a test fails if any copy drifts). Decisions are deny-by-default and tenant-scoped: every input is already about ONE
// company, and nothing here reads or trusts anything the browser sent.
//
// FIVE DISTINCT LAYERS (none implies another):
//   1. Platform role        Bizzux staff (platformAdmins). Bypasses company gates. Never granted by a company.
//   2. Organization role    OWNER | ADMIN | MEMBER | VIEWER (organizationMemberships.role). Controls ORGANIZATION operations only: users, invitations,
//                           links, app assignment, role assignment. It never grants any application permission.
//   3. Application role     assignment.role (ADMIN | MEMBER) of ONE app (appAssignments). Controls that application's permissions. It never grants
//                           organization permissions.
//   4. Business relationship Employee / Contractor / Vendor... (person type, employment type). Descriptive only: it can never grant or remove access.
//   5. License entitlement  organizationAppSubscriptions (+ company trial/plan state). Whether the company may use an app at all.
//
// Legacy compatibility: until a role is set EXPLICITLY through the central service (roleSource "explicit"), the organization role is derived from the
// existing business profile exactly as before, so nothing changes for existing people until an administrator acts.

export const ORG_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
export const APP_ROLES = ["ADMIN", "MEMBER"];
export const RELATIONSHIPS = ["Employee", "Contractor", "Freelancer", "Intern / Trainee", "Daily Wage Worker", "Consultant", "Vendor Staff", "Volunteer", "Business Owner / Partner", "External Member"];
// How long an app may keep serving a person after access was revoked, suspended or changed (the apps cache the decision per process).
export const REVOCATION_CACHE_MS = 30_000;

export const ORG_PERMISSIONS = {
  OWNER: ["org.settings", "org.billing", "org.transfer", "org.delete", "users.view", "users.create", "users.invite", "users.link", "users.suspend", "users.remove", "users.reset_password", "apps.assign", "roles.assign_member", "roles.assign_admin", "members.approve", "audit.view"],
  ADMIN: ["users.view", "users.create", "users.invite", "users.link", "users.suspend", "users.remove", "users.reset_password", "apps.assign", "roles.assign_member", "audit.view"],
  MEMBER: [],
  VIEWER: [],
};
// An administrator may be handed these individually by the Owner (today: join-request approval). Never honoured for MEMBER or VIEWER.
export const GRANTABLE_ADMIN_PERMISSIONS = ["members.approve"];

const LEGACY_ADMIN_PROFILES = ["Global Admin", "Admin"];

// -> { role: OWNER|ADMIN|MEMBER|VIEWER|NONE, source, active }.  `canonical` = the organizationMemberships document (or null when there is none).
export function effectiveOrgRole({ isOwner = false, canonical = null, profile = "" } = {}) {
  if (isOwner) return { role: "OWNER", source: "owner", active: true };
  if (canonical && canonical.status && canonical.status !== "active") return { role: "NONE", source: "membership-" + canonical.status, active: false };
  if (canonical && canonical.roleSource === "explicit" && ORG_ROLES.includes(canonical.role) && canonical.role !== "OWNER") return { role: canonical.role, source: "explicit", active: true };
  // Legacy: derived from the business profile, exactly the old behaviour.
  const role = LEGACY_ADMIN_PROFILES.includes(profile) ? "ADMIN" : profile === "Viewer/Auditor" ? "VIEWER" : "MEMBER";
  return { role, source: "legacy-profile", active: true };
}

export function orgPermissionsOf(subject) {
  if (!subject || !subject.active) return [];
  const base = ORG_PERMISSIONS[subject.role] || [];
  const extra = subject.role === "ADMIN" ? (subject.permissions || []).filter((p) => GRANTABLE_ADMIN_PERMISSIONS.includes(p)) : [];
  return [...base, ...extra];
}
export const orgCan = (subject, permission) => orgPermissionsOf(subject).includes(permission);
export const isOrgAdmin = (subject) => !!subject && subject.active && (subject.role === "OWNER" || subject.role === "ADMIN");

// Who may change whose ORGANIZATION role. Escalation rules: only an Owner (or a Platform Admin) can create or remove an ADMIN; nobody changes their
// own role or the Owner's; OWNER cannot be assigned here. -> { ok, reason }
export function canChangeOrgRole({ actor, actorIsPlatform = false, actorUid, targetUid, target, newRole }) {
  if (!["ADMIN", "MEMBER", "VIEWER"].includes(newRole)) return { ok: false, reason: "invalid_role" };
  if (!actorIsPlatform && !orgCan(actor, "roles.assign_member")) return { ok: false, reason: "not_authorized" };
  if (!actorIsPlatform && actorUid && actorUid === targetUid) return { ok: false, reason: "self_change" };
  if (!target || !target.active) return { ok: false, reason: "target_not_active_member" };
  if (target.role === "OWNER") return { ok: false, reason: "owner_is_fixed" };
  const touchesAdmin = newRole === "ADMIN" || target.role === "ADMIN";
  if (touchesAdmin && !actorIsPlatform && !orgCan(actor, "roles.assign_admin")) return { ok: false, reason: "only_owner_changes_admins" };
  return { ok: true, reason: "" };
}

// ---- License entitlement + assignment: may this person use this app in this company? --------------------------------------------------------------
// policyMode "legacy" (default, current production behaviour):
//   * a subscription record that exists and is not ACTIVE blocks EVERYONE, owners included;
//   * a MISSING subscription record is tolerated for the Owner only (companies that pre-date the model);
//   * non-owners need an active membership (a missing legacy membership is tolerated), an ACTIVE subscription record and an ACTIVE assignment.
// policyMode "strict" (proposed, OFF until migrated and reviewed): additionally
//   * the Owner needs an ACTIVE subscription record too (no more missing-record bypass);
//   * a TRIAL subscription past its expiresAt is refused for everyone;
//   * an Owner/ADMIN does not need an assignment (organization ownership is not an app role), everyone else does.
// Returns { allowed, code, status, message, appRole, source }. Platform admins are handled by the caller (they bypass company gates).
export function appAccessDecision({ appId = "", label = "this application", isOwner = false, isPlatform = false, subscription = null, membership, assignment = null, policyMode = "legacy", now = Date.now() } = {}) {
  const deny = (code, message, status = 403) => ({ allowed: false, code, status, message, appRole: null, source: "denied" });
  if (isPlatform) return { allowed: true, code: "", status: 200, message: "", appRole: "ADMIN", source: "platform" };
  const subExists = !!subscription;
  if (subExists && subscription.status !== "ACTIVE") return deny("app_not_enabled", "This application is not enabled for your company.");
  if (policyMode === "strict") {
    if (!subExists) return deny("app_not_licensed", "Your company does not have a license for " + label + ".");
    const exp = subscription.expiresAt && (typeof subscription.expiresAt.toMillis === "function" ? subscription.expiresAt.toMillis() : Date.parse(subscription.expiresAt));
    if (subscription.subscriptionType === "TRIAL" && exp && exp < now) return deny("app_trial_expired", "The trial for " + label + " has ended.");
  }
  if (isOwner) return { allowed: true, code: "", status: 200, message: "", appRole: "ADMIN", source: "owner" };
  // membership === undefined means "not looked up" (owner path); null means looked up and absent (tolerated: legacy accounts).
  if (membership && membership.status && membership.status !== "active") return deny("user_suspended", "Your access has been suspended. Contact your administrator.");
  const assigned = !!assignment && assignment.status === "ACTIVE";
  if (!subExists || subscription.status !== "ACTIVE" || !assigned) return deny("app_not_assigned", "You don't have access to " + label + " yet — ask your admin to grant it under Team > Apps.");
  return { allowed: true, code: "", status: 200, message: "", appRole: assignment.role === "ADMIN" ? "ADMIN" : "MEMBER", source: "assignment" };
}

// What the Admin Center shows for one person: organization role and, per app, effective access with its source and reason.
export function explainAccess({ orgSubject, apps = [], subscriptions = {}, assignments = {}, membership = null, policyMode = "legacy", now = Date.now() }) {
  return {
    orgRole: orgSubject.role, orgRoleSource: orgSubject.source,
    apps: apps.map((appId) => {
      const d = appAccessDecision({ appId, isOwner: orgSubject.role === "OWNER", subscription: subscriptions[appId] || null, membership, assignment: assignments[appId] || null, policyMode, now });
      return { appId, access: d.allowed, appRole: d.appRole, source: d.source, reason: d.allowed ? "" : d.code };
    }),
  };
}

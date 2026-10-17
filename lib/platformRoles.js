// Platform (Bizzux staff) roles and permissions. Pure data and functions, safe
// to import anywhere; the request guard at the bottom is server-only.
//
// Storage is unchanged: platformAdmins/{uid} { role, status, permissions }.
//   role         OWNER | ADMIN | SUPPORT_AGENT | BILLING_ADMIN
//   permissions  null = the role's defaults; an array = exactly those
//                (minus anything that is Owner-only by design).
// Existing OWNER and ADMIN documents keep working with identical effective
// access to before. Roles beyond OWNER/ADMIN get NO access through the older
// admin routes (their guards only admit OWNER/ADMIN); they are used only by
// routes migrated to requirePlatformPermission, so assigning one can never
// silently widen what that person can reach.
import { adminDb, requireUser, resolvePlatformRole } from "./firebaseAdmin";

export const PLATFORM_ROLES = ["OWNER", "ADMIN", "SUPPORT_AGENT", "BILLING_ADMIN"];

export const PERMISSIONS = [
  "organizations.view", "organizations.create", "organizations.manage", "organizations.suspend",
  "organizations.archive", "organizations.delete_test", "organizations.delete",
  "subscription.view", "subscription.manage",
  "billing.view", "billing.manage",
  "support.tickets", "support.access.request", "support.access.approve",
  "audit.view",
];

// Never delegable, whatever a stored permissions array says.
export const OWNER_ONLY = ["organizations.delete", "support.access.approve"];

const ADMIN_DEFAULTS = [
  "organizations.view", "organizations.create", "organizations.manage", "organizations.suspend",
  "organizations.archive", "organizations.delete_test",
  "subscription.view", "subscription.manage", "billing.view",
  "support.tickets", "support.access.request", "audit.view",
];

export const ROLE_DEFAULTS = {
  OWNER: PERMISSIONS,
  ADMIN: ADMIN_DEFAULTS,
  SUPPORT_AGENT: ["organizations.view", "subscription.view", "support.tickets", "support.access.request"],
  BILLING_ADMIN: ["organizations.view", "subscription.view", "subscription.manage", "billing.view", "billing.manage"],
};

export function effectivePermissions(role, stored) {
  if (role === "OWNER") return PERMISSIONS;
  if (!PLATFORM_ROLES.includes(role)) return [];
  const base = Array.isArray(stored) ? stored.filter((p) => PERMISSIONS.includes(p)) : ROLE_DEFAULTS[role];
  return base.filter((p) => !OWNER_ONLY.includes(p));
}

export const hasPermission = (role, stored, perm) => effectivePermissions(role, stored).includes(perm);

// Resolves the caller's platform role and checks one permission. Throws
// { status, message } (401 not signed in, 403 not allowed). A caller with no
// platform role (including every customer-side admin) is always refused.
export async function requirePlatformPermission(req, perm) {
  const c = await requireUser(req);
  let role = await resolvePlatformRole(c.uid, c.email);
  if (!role && c.isSuper) role = "OWNER"; // legacy SUPER_ADMIN_EMAIL allowlist, as everywhere else
  if (!role) throw { status: 403, message: "Platform access required" };
  let stored = null;
  if (role !== "OWNER") {
    const snap = await adminDb().doc("platformAdmins/" + c.uid).get();
    stored = snap.exists ? snap.data().permissions : null;
  }
  if (!hasPermission(role, stored, perm)) {
    throw { status: 403, message: "You don't have permission for this action (" + perm + ")" };
  }
  return { ...c, isSuper: true, platformRole: role, permissions: effectivePermissions(role, stored) };
}

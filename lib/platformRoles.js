// Platform (Bizzux staff) roles and permissions. Pure data and functions, safe
// to import anywhere; the request guard at the bottom is server-only.
//
// Storage is unchanged: platformAdmins/{uid} { role, status, permissions }.
//   role         one of PLATFORM_ROLES (stored ids OWNER / ADMIN are unchanged;
//                ROLE_LABELS holds the names people see)
//   permissions  null = the role's defaults; an array = exactly those
//                (minus anything that is Owner-only by design).
// Existing OWNER and ADMIN documents keep working with identical effective
// access to before. Roles beyond OWNER/ADMIN get NO access through the older
// admin routes (their guards only admit OWNER/ADMIN); they are used only by
// routes migrated to requirePlatformPermission, so assigning one can never
// silently widen what that person can reach.
import { adminDb, requireUser, resolvePlatformRole } from "./firebaseAdmin";

export const PLATFORM_ROLES = [
  "OWNER", "ADMIN", "CUSTOMER_OPERATIONS_ADMIN", "SUPPORT_AGENT", "BILLING_ADMIN", "PLATFORM_OPERATIONS_ADMIN",
];
// Roles the Owner may hand out. OWNER is never assignable through any request.
export const ASSIGNABLE_ROLES = PLATFORM_ROLES.filter((r) => r !== "OWNER");

export const ROLE_LABELS = {
  OWNER: "Platform Owner",
  ADMIN: "Platform Admin",
  CUSTOMER_OPERATIONS_ADMIN: "Customer Operations Admin",
  SUPPORT_AGENT: "Customer Support Agent",
  BILLING_ADMIN: "Billing & Revenue Admin",
  PLATFORM_OPERATIONS_ADMIN: "Platform Operations Admin",
};
export const ROLE_SUMMARIES = {
  OWNER: "Platform governance, role assignment, sensitive approvals.",
  ADMIN: "Platform operations, customer provisioning, application availability. Cannot assign roles.",
  CUSTOMER_OPERATIONS_ADMIN: "Onboard and manage customer organizations, licences and lifecycle.",
  SUPPORT_AGENT: "Support cases and limited customer account information.",
  BILLING_ADMIN: "SaaS plans, invoices, payment status, adjustments and refunds.",
  PLATFORM_OPERATIONS_ADMIN: "Service health, performance and cloud cost. No customer business records.",
};

export const PERMISSIONS = [
  "organizations.view", "organizations.create", "organizations.manage", "organizations.suspend",
  "organizations.archive", "organizations.delete_test", "organizations.delete",
  "organizations.verify", "organizations.transfer_ownership",
  "subscription.view", "subscription.manage",
  "billing.view", "billing.manage", "billing.refunds.approve",
  // Attendance price book: see it / draft and edit versions / approve (publish) a version. Publishing is Owner-only and, separately,
  // must be done by someone other than whoever drafted the version (see lib/attendancePricing.js approvalProblem).
  "pricing.view", "pricing.manage", "pricing.publish",
  // Attendance rollout flags / kill switch: switching a capability off for customers. Owner only.
  "attendance.flags.manage",
  "support.tickets", "support.access.request", "support.access.approve",
  "audit.view",
  "customers.users.manage",
  "analytics.saas.read",
  "platform.roles.manage", "platform.configuration.manage", "platform.health.read", "platform.finops.read",
  "security.settings.manage", "data.recovery.execute",
];

// The spec's permission names, mapped onto the permissions the existing routes
// already enforce, so there is one source of truth and no second vocabulary
// to drift. hasPermission() accepts either spelling.
export const PERMISSION_ALIASES = {
  "customers.read": "organizations.view",
  "customers.create": "organizations.create",
  "customers.update": "organizations.manage",
  "customers.suspend": "organizations.suspend",
  "support.tickets.read": "support.tickets",
  "support.tickets.manage": "support.tickets",
  "billing.subscriptions.read": "billing.view",
  "billing.subscriptions.manage": "billing.manage",
  "security.audit.read": "audit.view",
};

// Never delegable, whatever a stored permissions array says.
export const OWNER_ONLY = [
  "organizations.delete", "support.access.approve",
  // Confirming a business owner / authority, and moving ownership, are Owner decisions.
  "organizations.verify", "organizations.transfer_ownership",
  "pricing.publish", "attendance.flags.manage",
  "platform.roles.manage", "security.settings.manage", "data.recovery.execute",
];

const ADMIN_DEFAULTS = [
  "organizations.view", "organizations.create", "organizations.manage", "organizations.suspend",
  "organizations.archive", "organizations.delete_test",
  "subscription.view", "subscription.manage", "billing.view", "pricing.view",
  "support.tickets", "support.access.request", "audit.view",
  "customers.users.manage", "platform.configuration.manage", "platform.health.read", "analytics.saas.read",
];

export const ROLE_DEFAULTS = {
  OWNER: PERMISSIONS,
  ADMIN: ADMIN_DEFAULTS,
  CUSTOMER_OPERATIONS_ADMIN: [
    "organizations.view", "organizations.create", "organizations.manage", "organizations.suspend",
    "subscription.view", "subscription.manage", "customers.users.manage",
  ],
  SUPPORT_AGENT: ["organizations.view", "subscription.view", "support.tickets", "support.access.request"],
  BILLING_ADMIN: [
    "organizations.view", "subscription.view", "subscription.manage", "billing.view", "billing.manage",
    "billing.refunds.approve", "analytics.saas.read", "pricing.view", "pricing.manage",
  ],
  PLATFORM_OPERATIONS_ADMIN: ["platform.health.read", "platform.finops.read"],
};

export function effectivePermissions(role, stored) {
  if (role === "OWNER") return PERMISSIONS;
  if (!PLATFORM_ROLES.includes(role)) return [];
  const base = Array.isArray(stored) ? stored.filter((p) => PERMISSIONS.includes(p)) : ROLE_DEFAULTS[role];
  return base.filter((p) => !OWNER_ONLY.includes(p));
}

export const hasPermission = (role, stored, perm) =>
  effectivePermissions(role, stored).includes(PERMISSION_ALIASES[perm] || perm);

// Resolves the caller's platform role and checks one permission. Throws
// { status, message } (401 not signed in, 403 not allowed). A caller with no
// platform role (including every customer-side admin) is always refused.
export async function requirePlatformPermission(req, perm) {
  const c = await requireUser(req);
  let role = await resolvePlatformRole(c.uid, c.trustedEmail);
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

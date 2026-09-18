// Shared role vocabulary for bizzux-apps team members. Client- and
// server-safe (no Node/Firebase-admin imports) — used by the /team UI for
// its dropdown and by API routes for validation/permission checks, so the
// two can never drift out of sync.
//
// This is ONE of three access tiers in the platform, and the only one
// listed here:
//   1. Org user / employee (this file) — a real member of one
//      organization, via memberships/{uid} pointing at that org's
//      accountId. Counts as a paid seat on that org's plan.
//   2. Project collaborator / guest — someone from OUTSIDE the
//      organization, invited to exactly one project (not the org, not
//      even every project in it) and never billed as a seat. Lives
//      entirely in bizzux-projects (customers/{accountId}/pmProjects/
//      {projectId}/collaborators/{email}, see its lib/collaborators.js) —
//      not a PROFILES value, and not assignable from /team.
//   3. Platform Owner/Admin (platformAdmins/{uid}, see resolvePlatformRole
//      in lib/firebaseAdmin.js) — Bizzux staff, not a customer at all;
//      bypasses every org's trial/plan gate everywhere.
//
// Super Admin is NOT here on purpose: it's env-var only (SUPER_ADMIN_EMAIL,
// see lib/firebaseAdmin.js), invisible, and never assignable from /team —
// nobody picks it from a dropdown.
export const PROFILES = [
  {
    value: "Global Admin",
    label: "Global Admin",
    scope: "Entire organisation and all branches",
    desc: "Manages users, branches, modules and configuration for this organisation; cannot transfer ownership or delete the organisation. The right choice for a business partner or co-owner — grants the same day-to-day access as the account owner.",
  },
  {
    value: "Admin",
    label: "Admin",
    scope: "Entire organisation and all branches",
    desc: "Manages users, branches, modules and configuration; cannot transfer ownership or delete the organisation.",
  },
  {
    value: "Manager",
    label: "Manager",
    scope: "Assigned branches",
    desc: "Manages sales, POS, inventory, purchases, CRM, expenses, employees and operational reports.",
  },
  {
    // value stays "Staff/Shopkeeper" — it's already stored on real team
    // member records; only the label (what's actually shown) changes.
    value: "Staff/Shopkeeper",
    label: "Staff",
    scope: "Assigned function and location",
    desc: "Performs daily transactions without configuration or approval authority.",
  },
  {
    value: "Viewer/Auditor",
    label: "Viewer/Auditor",
    scope: "Selected organisation or branch",
    desc: "Read-only reports and records; no data modification.",
  },
];

export const PROFILE_VALUES = PROFILES.map((p) => p.value);

// The generic organization-role tier from the note referenced above — kept
// here (not in lib/organizationMembership.js, which imports the
// server-only Firebase Admin SDK) so client components like /team's page
// can import it too.
export const ORGANIZATION_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

// Profiles that can manage the team (invite/remove teammates, reach /team)
// and account-level configuration. Manager/Staff-Shopkeeper/Viewer-Auditor are
// operational or read-only and don't get that access — matches their
// descriptions above ("cannot transfer ownership", "no configuration or
// approval authority", "no data modification").
export const ACCOUNT_ADMIN_PROFILES = ["Global Admin", "Admin"];

// What a newly-invited teammate gets if nothing else is specified.
export const DEFAULT_PROFILE = "Staff/Shopkeeper";

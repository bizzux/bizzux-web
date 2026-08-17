// Shared role vocabulary for bizzux-apps team members. Client- and
// server-safe (no Node/Firebase-admin imports) — used by the /team UI for
// its dropdown and by API routes for validation/permission checks, so the
// two can never drift out of sync.
//
// Super Admin is NOT here on purpose: it's env-var only (SUPER_ADMIN_EMAIL,
// see lib/firebaseAdmin.js), invisible, and never assignable from /team —
// nobody picks it from a dropdown.
export const PROFILES = [
  {
    value: "Global Admin",
    label: "Global Admin",
    scope: "Entire Bizzux platform",
    desc: "Internal Bizzux team only; manages organisations and permissions, subscriptions and platform configuration.",
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
    value: "Staff/Shopkeeper",
    label: "Staff/Shopkeeper",
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

// Profiles that can manage the team (invite/remove teammates, reach /team)
// and account-level configuration. Manager/Staff-Shopkeeper/Viewer-Auditor are
// operational or read-only and don't get that access — matches their
// descriptions above ("cannot transfer ownership", "no configuration or
// approval authority", "no data modification").
export const ACCOUNT_ADMIN_PROFILES = ["Global Admin", "Admin"];

// What a newly-invited teammate gets if nothing else is specified.
export const DEFAULT_PROFILE = "Staff/Shopkeeper";

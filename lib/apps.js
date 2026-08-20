// Canonical Bizzux app catalog — key, display name, icon. Used by the new
// Admin → Super Admin (SaaS) → Plan Apps tab (components/SuperAdminPanel.jsx)
// to build its per-plan app/feature entitlement editor.
//
// NOTE: app/(saas)/dashboard/page.js and app/(saas)/apps/page.js each keep
// their own richer, hand-written version of this same app list (with SSO
// URLs, marketing descriptions, category groupings) rather than importing
// from here — this file was added alongside the entitlements editor rather
// than risking a refactor of those two already-working pages. Keep the
// `key`/`name`/`icon` values in sync by hand if the app catalog changes;
// consolidating all three into one source is a reasonable future cleanup.
// `features`, where present, is that app's REAL list of main tabs/sections
// (id must match what that app itself expects to receive — for Shop, its
// own app/admin/page.js TABS ids) — the Plan Apps editor renders these as a
// checklist instead of a free-text box, so a Super Admin picks real tab
// names instead of typing ones that silently do nothing. Apps without a
// `features` list here (nothing else has a known tab structure yet) keep
// the old free-text input as a fallback.
export const APP_CATALOG = [
  {
    key: "juicechatjunction", name: "Bizzux Shop", icon: "🏪",
    features: [
      { id: "summary", label: "Summary" },
      { id: "pos", label: "New Sale" },
      { id: "history", label: "Sales History" },
      { id: "menu", label: "Menu Items" },
      { id: "purchases", label: "Purchases" },
      { id: "expenses", label: "Expenses" },
      { id: "inventory", label: "Inventory" },
      { id: "analytics", label: "Analytics" },
      { id: "settings", label: "Settings" },
      { id: "contacts", label: "Contacts" },
    ],
  },
  { key: "pos", name: "Bizzux POS", icon: "🧾" },
  { key: "orders", name: "Bizzux Orders", icon: "📋" },
  { key: "books", name: "Bizzux Books", icon: "📒" },
  { key: "payroll", name: "Bizzux Payroll", icon: "💰" },
  { key: "inventory", name: "Bizzux Inventory", icon: "📦" },
  { key: "vendors", name: "Bizzux Vendors", icon: "🚚" },
  { key: "crm", name: "Bizzux CRM", icon: "👥" },
  { key: "support", name: "Bizzux Support", icon: "🎧" },
  { key: "sites", name: "Bizzux Sites", icon: "🌐" },
];

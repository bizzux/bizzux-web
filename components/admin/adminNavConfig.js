// The Admin Center navigation tree: ONE definition used by the sidebar, the breadcrumb and the active-item logic.
// `admin` is the path on admin.bizzux.com, `legacy` the same page on hosts without the admin routing (www, previews, localhost).
// `ready: false` items are part of the plan but hidden until their screen exists, so no control ever points at a missing page.
export const NAV = [
  {
    key: "users", label: "Users", icon: "user",
    children: [
      { key: "active", label: "Active users", admin: "/users", legacy: "/team" },
      { key: "contacts", label: "Contacts", admin: "/users/contacts", legacy: "/team/contacts" },
      { key: "guests", label: "Guest users", admin: "/users/guests", legacy: "/team/guests" },
      { key: "deleted", label: "Deleted users", admin: "/users/deleted", legacy: "/team/deleted" },
    ],
  },
  { key: "organizations", label: "Organizations", icon: "building", admin: "/organizations", legacy: "/team/organizations" },
  { key: "apps", label: "Applications", icon: "grid", admin: "/apps", legacy: "/team/apps" },
  { key: "roles", label: "Roles & permissions", icon: "shield", admin: "/roles", legacy: "/team/roles" },
  { key: "teams", label: "Teams", icon: "people", admin: "/teams", legacy: "/team/groups" },
  { key: "security", label: "Security", icon: "lock", admin: "/security", legacy: "/team/security" },
];

const clean = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
export const visibleChildren = (g) => (g.children || []).filter((c) => c.ready !== false);
export const hrefOf = (item, onAdminHost) => (onAdminHost ? item.admin : item.legacy);

// -> { group, item } for the current path (either host's spelling), or null.
export function findActive(pathname) {
  const p = clean(pathname || "/");
  for (const g of NAV) {
    if (g.children) { for (const c of visibleChildren(g)) if (p === c.admin || p === c.legacy) return { group: g, item: c }; }
    else if (p === g.admin || p === g.legacy || p.startsWith(g.legacy + "/")) return { group: null, item: g };
  }
  return null;
}
export function breadcrumbOf(active) {
  if (!active) return ["Admin Center"];
  return ["Admin Center", ...(active.group ? [active.group.label] : []), active.item.label];
}

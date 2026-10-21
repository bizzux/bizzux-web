// Host routing for the Admin Center (admin.bizzux.com) inside the existing portal project. Pure and edge-safe (no Node APIs).
// One codebase, one set of pages: the admin host maps friendly paths onto the existing /team pages (rewrite, URL unchanged), and the old /team URLs
// on the www host redirect to the admin host only when the rollout flag is on. Sessions are NOT shared across hosts: the admin host gets its own
// Firebase session through the signed single-use hand-off (/api/admin-center/handoff -> /sso), never a parent-domain cookie.
export const ADMIN_PATHS = {
  "/users": "/team",
  "/apps": "/team/apps",
  "/teams": "/team/groups",
  "/security": "/team/security",
  "/organizations": "/team/organizations",
  "/roles": "/team/roles",
};
const LEGACY_TO_ADMIN = Object.fromEntries(Object.entries(ADMIN_PATHS).map(([a, l]) => [l, a]));

export const DEFAULTS = { adminOrigin: "https://admin.bizzux.com", wwwOrigin: "https://www.bizzux.com", redirectLegacy: false };

export const hostOf = (h) => String(h || "").toLowerCase().replace(/:\d+$/, "");
export const isAdminHost = (h) => /^admin\./.test(hostOf(h));

// "/team/apps/" -> "/team/apps"
const clean = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export function legacyToAdminPath(pathname) {
  return LEGACY_TO_ADMIN[clean(pathname)] || null;
}

// Safe in-site target for the hand-off ("to" parameter): only the known admin paths.
export function safeAdminTarget(to) {
  const p = clean(String(to || ""));
  return Object.prototype.hasOwnProperty.call(ADMIN_PATHS, p) ? p : "/users";
}

const PASS_PREFIXES = ["/api/", "/_next/", "/sso", "/favicon", "/icon", "/apple-icon", "/robots", "/sitemap"];

// -> { type: "next" } | { type: "rewrite", path } | { type: "redirect", url, status } | { type: "notfound" }
export function decide({ host, pathname, search = "" }, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg };
  const path = clean(pathname);
  if (isAdminHost(host)) {
    if (PASS_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p)) || /\.[a-z0-9]+$/i.test(path)) return { type: "next" };
    if (path === "/") return { type: "redirect", url: "/users" + search, status: 307 };
    if (Object.prototype.hasOwnProperty.call(ADMIN_PATHS, path)) return { type: "rewrite", path: ADMIN_PATHS[path] + search };
    const modern = legacyToAdminPath(path);
    if (modern) return { type: "redirect", url: modern + search, status: 307 }; // /team* on the admin host -> its own new path (same host, no loop)
    if (path === "/sign-in") return { type: "redirect", url: c.wwwOrigin + "/open-admin?to=" + encodeURIComponent(safeAdminTarget(new URLSearchParams(search).get("to"))), status: 307 };
    return { type: "notfound" };
  }
  // Any other host (www, previews, localhost): untouched unless the rollout flag is on.
  if (c.redirectLegacy && (path === "/team" || path.startsWith("/team/"))) {
    const modern = legacyToAdminPath(path);
    if (modern) return { type: "redirect", url: c.adminOrigin + modern + search, status: 307 };
  }
  return { type: "next" };
}

// What the shared Bizzux profile menu shows. PURE: the server gathers the records, this turns the policy's decisions into a menu. The menu is a
// presentation of decisions the servers already enforce; hiding an entry is for tidiness, the backend refuses regardless.
import { appAccessDecision, isOrgAdmin, orgCan } from "../authz/policy.js";

// The apps that appear in the switcher. `ssoApp` is the key the existing mint routes expect; `appId` is the licence/assignment id.
export const MENU_APPS = [
  { key: "attendance", appId: "bizzux-attendance", name: "Bizzux Attendance", url: "https://attendance.bizzux.com", ssoEndpoint: "/api/app-sso?app=attendance" },
  { key: "crm", appId: "bizzux-crm", name: "Bizzux CRM", url: "https://crm.bizzux.com", ssoEndpoint: "/api/app-sso?app=crm" },
  { key: "projects", appId: "bizzux-projects", name: "Bizzux Projects", url: "https://projects.bizzux.com", ssoEndpoint: "/api/app-sso?app=projects" },
  { key: "notes", appId: "bizzux-notes", name: "Bizzux Notes", url: "https://notes.bizzux.com", ssoEndpoint: "/api/app-sso?app=notes" },
  { key: "files", appId: "bizzux-files", name: "Bizzux Files", url: "https://files.bizzux.com", ssoEndpoint: "/api/app-sso?app=files" },
  { key: "chat", appId: "bizzux-chat", name: "Bizzux Chat", url: "https://chat.bizzux.com", ssoEndpoint: "/api/app-sso?app=chat" },
  { key: "mail", appId: "bizzux-mail", name: "Bizzux Mail", url: "https://mail.bizzux.com", ssoEndpoint: "/api/app-sso?app=mail" },
  { key: "finance", appId: "bizzux-finance", name: "Bizzux Finance", url: "https://finance.bizzux.com", ssoEndpoint: "/api/app-sso?app=finance" },
  { key: "capture", appId: "bizzux-capture", name: "Bizzux Capture", url: "https://capture.bizzux.com", ssoEndpoint: "/api/app-sso?app=capture" },
  { key: "business", appId: "bizzux-business", name: "Bizzux Business", url: "https://business.bizzux.com", ssoEndpoint: "/api/shop-sso" },
  { key: "pos", appId: "bizzux-pos", name: "Bizzux POS", url: "https://pos.bizzux.com", ssoEndpoint: "/api/pos-sso" },
];

const initials = (s) => String(s || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

// input: { person:{name,email}, organization:{id,name}|null, orgSubject (effective org role or null), isPlatform, currentApp,
//          subscriptions:{[appId]:record}, assignments:{[appId]:record}, membership:{status}|null, policyMode }
export function shapeMenu({ person = {}, organization = null, orgSubject = null, isPlatform = false, currentApp = "", subscriptions = {}, assignments = {}, membership = null, policyMode = "legacy" } = {}) {
  const base = { person: { name: person.name || "", email: person.email || "", initials: initials(person.name || person.email) }, organization: organization ? { id: organization.id, name: organization.name || "" } : null };
  if (!organization || !orgSubject) return { ...base, apps: [], admin: { show: false, role: "" }, addEmployee: { central: false }, support: false };
  const isOwner = orgSubject.role === "OWNER";
  const apps = [];
  // The owner is admitted by the servers even where a licence record is missing (companies that pre-date the licence records). For the MENU we only offer
  // an owner the apps their company actually holds, unless the company has no licence records at all (then the legacy rule applies).
  const hasRecords = Object.keys(subscriptions).length > 0;
  for (const a of MENU_APPS) {
    if (isOwner && hasRecords && !(subscriptions[a.appId] && subscriptions[a.appId].status === "ACTIVE")) continue;
    const d = appAccessDecision({ appId: a.appId, label: a.name, isOwner, subscription: subscriptions[a.appId] || null, membership: isOwner ? undefined : membership, assignment: assignments[a.appId] || null, policyMode });
    if (!d.allowed) continue; // an app the person cannot open is never offered
    apps.push({ key: a.key, appId: a.appId, name: a.name, url: a.url, ssoEndpoint: a.ssoEndpoint, appRole: d.appRole, current: a.key === currentApp });
  }
  // Admin Center is for company Owners and Admins only (organization role, read live). A Platform Admin has no company role of their own: they reach a
  // company's Admin Center only inside an audited support session, which is a separate flow, so it is not offered here.
  const adminShow = !isPlatform && isOrgAdmin(orgSubject);
  return {
    ...base, apps,
    admin: { show: adminShow, role: adminShow ? orgSubject.role : "" },
    addEmployee: { central: !isPlatform && orgCan(orgSubject, "users.create") },
    support: false,
  };
}

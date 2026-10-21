// The Active users column catalogue and the per-administrator preference rules. Pure: shared by the page and by /api/iam/prefs, so the server
// never trusts a column name, ordering or page size that came from the browser.
// Deliberately NOT in the catalogue: anything secret or personal beyond what the list already shows (password state, recovery codes, tokens,
// IP addresses, mobile number, address).
export const USER_COLUMNS = [
  { key: "name", label: "Display name", locked: true, default: true, sort: "name" },
  { key: "signin", label: "Username / email", default: true, sort: "signin" },
  { key: "method", label: "Sign-in method", default: false },
  { key: "orgRole", label: "Organization role", default: true, sort: "orgRole" },
  { key: "apps", label: "App roles (effective access)", default: true },
  { key: "status", label: "Status", default: true, sort: "status" },
  { key: "lastSignIn", label: "Last sign-in", default: true, sort: "lastSignIn" },
  { key: "created", label: "Created date", default: false, sort: "created" },
  { key: "jobTitle", label: "Job title", default: false },
  { key: "profile", label: "Business profile", default: false },
  { key: "department", label: "Department", default: false },
  { key: "branch", label: "Branch", default: false },
  { key: "employeeId", label: "Employee ID", default: false },
  { key: "employmentType", label: "Employment type", default: false },
];
const KEYS = USER_COLUMNS.map((c) => c.key);
export const DEFAULT_COLUMNS = USER_COLUMNS.filter((c) => c.default).map((c) => c.key);

// -> columns in catalogue order; unknown names are dropped; the locked column is always present; an empty or invalid list means the default.
export function cleanColumns(input) {
  if (!Array.isArray(input)) return [...DEFAULT_COLUMNS];
  const want = new Set(input.filter((k) => typeof k === "string" && KEYS.includes(k)));
  USER_COLUMNS.filter((c) => c.locked).forEach((c) => want.add(c.key));
  const out = KEYS.filter((k) => want.has(k));
  return out.length > 1 ? out : [...DEFAULT_COLUMNS];
}
export const sameColumns = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);

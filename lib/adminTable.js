// Pure helpers for the Active users table: sorting, paging and CSV export. No I/O, so they are unit tested.
const text = (v) => String(v ?? "").toLowerCase();
const nameOf = (r) => text([r.firstName, r.lastName].filter(Boolean).join(" ") || r.username || r.email);

export const SORTERS = {
  name: (r) => nameOf(r),
  signin: (r) => text(r.email || r.username),
  orgRole: (r) => text(r.orgRoleEffective || r.orgRole),
  status: (r) => text(r.status),
  lastSignIn: (r) => (r.lastSignIn ? Date.parse(r.lastSignIn) || 0 : 0),
};

// Stable sort; rows with no value sort last in either direction.
export function sortRows(rows, { key = "name", dir = "asc" } = {}) {
  const f = SORTERS[key] || SORTERS.name;
  const sign = dir === "desc" ? -1 : 1;
  return rows.map((r, i) => ({ r, i, v: f(r) })).sort((a, b) => {
    const ea = a.v === "" || a.v === 0, eb = b.v === "" || b.v === 0;
    if (ea !== eb) return ea ? 1 : -1;
    if (a.v < b.v) return -sign;
    if (a.v > b.v) return sign;
    return a.i - b.i;
  }).map((x) => x.r);
}

export const PAGE_SIZES = [25, 50, 100];
export function paginate(rows, page, pageSize) {
  const size = PAGE_SIZES.includes(pageSize) ? pageSize : 25;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(0, page | 0), pages - 1);
  const from = rows.length ? p * size : 0;
  return { page: p, pages, size, from: rows.length ? from + 1 : 0, to: Math.min(rows.length, from + size), total: rows.length, rows: rows.slice(from, from + size) };
}

// A cell that starts with = + - @ (or a tab/CR) would be run as a formula by a spreadsheet; prefix it so it stays text. Quote when needed.
export function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const EXPORT_COLUMNS = [
  ["Name", (r) => [r.firstName, r.lastName].filter(Boolean).join(" ") || r.username || r.email || ""],
  ["Username", (r) => r.username || ""],
  ["Email", (r) => r.email || ""],
  ["Sign-in method", (r) => r.loginKind || ""],
  ["Organization role", (r) => r.orgRoleEffective || r.orgRole || ""],
  ["Business profile", (r) => r.profile || ""],
  ["App access", (r) => (r.appAccess || []).join("; ")],
  ["Status", (r) => r.status || ""],
  ["Last sign-in", (r) => r.lastSignIn || ""],
];
export function toCsv(rows) {
  const lines = [EXPORT_COLUMNS.map(([h]) => csvCell(h)).join(",")];
  for (const r of rows) lines.push(EXPORT_COLUMNS.map(([, f]) => csvCell(f(r))).join(","));
  return lines.join("\r\n") + "\r\n";
}

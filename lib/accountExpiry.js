// Account expiry for contractors and temporary staff — pure. Same rule as Attendance (lib/attAccountExpiry.js there).
// A calendar date (YYYY-MM-DD); the login works through the end of that day (UTC) and is refused after it. Empty = no expiry.
export const EMPLOYMENT_TYPES = ["Employee", "Contractor", "Other"];

export function cleanExpiry(v) {
  const s = String(v ?? "").trim();
  if (!s) return { ok: true, value: "" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + "T00:00:00Z")) || new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s) {
    return { ok: false, message: "Account expiry must be a date like 2026-12-31" };
  }
  return { ok: true, value: s };
}

export function accountExpired(rec, now = Date.now()) {
  const s = rec?.accountExpiresAt;
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return now > Date.parse(s + "T23:59:59.999Z");
}

export const cleanEmploymentType = (v) => (EMPLOYMENT_TYPES.includes(v) ? v : "Employee");

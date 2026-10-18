// COPY of bizzux-attendance/lib/attFlags.js (the two apps are separate repos). Keep the two in step: same flag names, same rules.
// Rollout flags and the platform KILL SWITCH — pure.
//
// Advanced capabilities can be switched off without a deploy, for everyone or for one company, by the Platform Owner (portal admin screen):
//   global   attendancePlatform/flags                       { verified?: false, smart_geofence?: false, approvals?: false, allocation?: false }
//   company  customers/{org}/attSettings/main.platformFlags the same shape, for one company
// Rules: everything is ON by default (so existing customers are unchanged); an explicit `false` turns a capability OFF; a company override can only
// turn things OFF, never back ON when the global switch is off. Face + GPS is a fixed OFF (it is separately gated by FACE_GPS_AVAILABLE).
//
// What each flag stops (existing data is never deleted or hidden):
//   verified, smart_geofence  the mode can't be newly chosen or allocated; people already on it keep working
//   approvals                 no NEW attendance approvals are created; waiting ones can still be decided
//   allocation                the bulk Modes & licences screen is unavailable (people can still be edited one by one)
export const FLAGS = ["verified", "smart_geofence", "approvals", "allocation"];
export const FLAG_LABEL = {
  verified: "Verified attendance (GPS)", smart_geofence: "Smart Geofence", approvals: "Attendance approvals", allocation: "Modes & licences screen",
};
export const FIXED_OFF = ["face_gps"];

// Only explicit booleans for known flags survive; anything else is ignored (so a bad document can never switch something off by accident).
export function cleanFlags(v) {
  const out = {};
  if (v && typeof v === "object") for (const f of FLAGS) if (typeof v[f] === "boolean") out[f] = v[f];
  return out;
}

// → { verified, smart_geofence, approvals, allocation, face_gps:false, source: { flag: "default"|"global"|"company" } }
export function resolveFlags({ global = null, org = null } = {}) {
  const g = cleanFlags(global), o = cleanFlags(org);
  const out = { face_gps: false, source: {} };
  for (const f of FLAGS) {
    if (g[f] === false) { out[f] = false; out.source[f] = "global"; }
    else if (o[f] === false) { out[f] = false; out.source[f] = "company"; }
    else { out[f] = true; out.source[f] = "default"; }
  }
  return out;
}

export const flagOn = (flags, f) => !flags || flags[f] !== false;

// A change request from the admin screen: `scope` "global" or "company"; `values` { flag: boolean }. Returns { ok, patch } or { ok:false, message }.
// Switching a capability OFF needs a reason (it affects customers); the reason is stored with the change for the audit trail.
export function flagChange({ scope, values, reason }) {
  if (scope !== "global" && scope !== "company") return { ok: false, message: "Choose global or one company." };
  const next = cleanFlags(values);
  if (!Object.keys(next).length) return { ok: false, message: "Choose at least one capability." };
  const text = String(reason || "").trim().slice(0, 300);
  if (Object.values(next).some((x) => x === false) && text.length < 5) return { ok: false, message: "Give a reason for switching something off." };
  return { ok: true, patch: next, reason: text };
}

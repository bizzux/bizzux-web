import { adminDb } from "@/lib/firebaseAdmin";

// Platform-wide session timeout policy, enforced in every Bizzux app by
// components/SessionTimeout.jsx. Stored at platformSettings/session and
// edited by the Platform Owner in Super Admin → Security Settings.

export const SESSION_DEFAULTS = { idleMinutes: 30, maxHours: 12, warnSeconds: 60 };

// Apps that read this policy (appKey passed by each app's SessionTimeout).
export const SESSION_APPS = [
  { key: "portal", name: "Bizzux portal (bizzux.com)" },
  { key: "shop", name: "Bizzux Business / POS" },
  { key: "crm", name: "Bizzux CRM" },
  { key: "notes", name: "Bizzux Notes" },
  { key: "files", name: "Bizzux Files" },
  { key: "projects", name: "Bizzux Projects" },
  { key: "chat", name: "Bizzux Chat" },
  { key: "mail", name: "Bizzux Mail" },
  { key: "assistant", name: "Bizzux Assistant" },
];

export const SESSION_LIMITS = {
  idleMinutes: [5, 24 * 60],
  maxHours: [1, 24 * 30],
  warnSeconds: [15, 300],
};

function clamp(field, v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return undefined;
  const [lo, hi] = SESSION_LIMITS[field];
  return Math.min(hi, Math.max(lo, n));
}

// Normalises anything (stored doc or admin input) into a valid policy.
// Per-app overrides may set idleMinutes and/or maxHours; blanks mean
// "use the platform default".
export function normalizePolicy(raw = {}) {
  const base = {
    idleMinutes: clamp("idleMinutes", raw.idleMinutes) ?? SESSION_DEFAULTS.idleMinutes,
    maxHours: clamp("maxHours", raw.maxHours) ?? SESSION_DEFAULTS.maxHours,
    warnSeconds: clamp("warnSeconds", raw.warnSeconds) ?? SESSION_DEFAULTS.warnSeconds,
  };
  const apps = {};
  for (const { key } of SESSION_APPS) {
    const o = raw.apps?.[key] || {};
    const idle = o.idleMinutes === "" || o.idleMinutes == null ? undefined : clamp("idleMinutes", o.idleMinutes);
    const max = o.maxHours === "" || o.maxHours == null ? undefined : clamp("maxHours", o.maxHours);
    if (idle !== undefined || max !== undefined) apps[key] = { ...(idle !== undefined && { idleMinutes: idle }), ...(max !== undefined && { maxHours: max }) };
  }
  return { ...base, apps };
}

export async function readPolicy() {
  try {
    const snap = await adminDb().doc("platformSettings/session").get();
    return normalizePolicy(snap.exists ? snap.data() : {});
  } catch {
    return normalizePolicy({});
  }
}

// The effective numbers for one app: its overrides on top of the defaults.
export function policyForApp(policy, appKey) {
  const o = policy.apps?.[appKey] || {};
  return {
    idleMinutes: o.idleMinutes ?? policy.idleMinutes,
    maxHours: o.maxHours ?? policy.maxHours,
    warnSeconds: policy.warnSeconds,
  };
}

// SERVER ONLY — shared definitions + helpers for Login Journey Diagnostics.
// Events are written to the `authJourneyEvents` collection by
// /api/auth-journey and read (admin only) by /api/admin/auth-journeys.
//
// Privacy rules: no passwords, tokens, OAuth codes or cookies are ever
// accepted or stored. Users are referenced by an HMAC (uidHash) and the typed
// identifier (email/username) only by an HMAC (subjectHash), never in clear.
// Rows carry `expireAt` (RETENTION_DAYS) — enable a Firestore TTL policy on
// that field; the admin API also ignores rows past it.
import { createHmac } from "crypto";

export const COLLECTION = "authJourneyEvents";
export const RETENTION_DAYS = 30;
export const MAX_BATCH = 12;

export const EVENTS = [
  "LOGIN_STARTED", "AUTH_PROVIDER_SELECTED", "OAUTH_REDIRECT_STARTED", "OAUTH_CALLBACK_RECEIVED",
  "AUTH_FAILED", "AUTH_SUCCEEDED", "SESSION_INITIALIZED", "SESSION_FAILED",
  "APP_ACCESS_GRANTED", "APP_ACCESS_DENIED", "LOGOUT", "LOGIN_RETRY",
];
// Known apps (labels only); unknown slugs are still recorded.
export const APPS = ["admin-center", "attendance", "crm", "projects", "pos", "notes", "files", "chat", "mail", "finance", "capture", "assistant", "portal", "other"];
export const METHODS = ["google", "password", "bizzux-id", "sso-handoff", "custom-token", "other"];
export const ERROR_CATEGORIES = [
  "invalid_credentials", "popup_blocked", "popup_closed", "redirect_failed", "network",
  "account_disabled", "account_closed", "too_many_requests", "account_exists_other_method",
  "token_invalid", "access_denied", "session_init_failed", "unknown",
];

// Map a Firebase/OAuth error code (or free text) to a safe category. Callers
// pass the raw code; only the category ever leaves the browser.
export function categorizeAuthError(code) {
  const c = String(code || "").toLowerCase();
  if (!c) return "unknown";
  if (/wrong-password|invalid-credential|user-not-found|invalid-email|invalid-login/.test(c)) return "invalid_credentials";
  if (/popup-blocked/.test(c)) return "popup_blocked";
  if (/popup-closed|cancelled-popup|redirect-cancelled/.test(c)) return "popup_closed";
  if (/network|timeout|failed to fetch/.test(c)) return "network";
  if (/user-disabled/.test(c)) return "account_disabled";
  if (/closed/.test(c)) return "account_closed";
  if (/too-many-requests/.test(c)) return "too_many_requests";
  if (/account-exists|email-already/.test(c)) return "account_exists_other_method";
  if (/token|expired|invalid-custom|argument-error/.test(c)) return "token_invalid";
  if (/redirect|operation-not-supported|web-storage|missing-initial-state|unauthorized-domain/.test(c)) return "redirect_failed";
  return "unknown";
}

function secret() {
  if (process.env.AUTH_JOURNEY_SALT) return process.env.AUTH_JOURNEY_SALT;
  // Fallback: derive from server-only service-account metadata (never the key itself).
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    return "authjourney:" + (sa.private_key_id || "") + ":" + (sa.project_id || "");
  } catch {
    return "authjourney:fallback";
  }
}

export function hashId(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  return createHmac("sha256", secret()).update(v).digest("hex").slice(0, 32);
}

const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

// Validate + normalise one client event against the allow-list. Returns null
// to drop it. Free text is never kept: unknown values collapse to "other"/"unknown".
export function sanitizeEvent(e) {
  if (!e || typeof e !== "object") return null;
  if (!EVENTS.includes(e.event)) return null;
  if (!ID_RE.test(String(e.journeyId || ""))) return null;
  const at = Date.parse(e.at);
  const now = Date.now();
  return {
    event: e.event,
    journeyId: e.journeyId,
    correlationId: ID_RE.test(String(e.correlationId || "")) ? e.correlationId : null,
    // Any well-formed slug is accepted so new apps need no server change.
    app: /^[a-z0-9-]{2,24}$/.test(String(e.app || "")) ? e.app : "other",
    method: METHODS.includes(e.method) ? e.method : "other",
    errorCategory: e.errorCategory && ERROR_CATEGORIES.includes(e.errorCategory) ? e.errorCategory : null,
    attempt: Number.isInteger(e.attempt) && e.attempt > 0 && e.attempt < 100 ? e.attempt : 1,
    buildVersion: str(e.buildVersion, 40) || null,
    // Client clock, clamped to ±1 day so a bad device clock can't skew the view wildly.
    clientAt: !isNaN(at) && Math.abs(at - now) < 86400000 ? new Date(at).toISOString() : new Date(now).toISOString(),
    subject: str(e.subject, 200), // hashed by the caller, then dropped
  };
}

const SUCCESS = ["APP_ACCESS_GRANTED", "SESSION_INITIALIZED", "AUTH_SUCCEEDED"];
const FAILURE = ["AUTH_FAILED", "SESSION_FAILED", "APP_ACCESS_DENIED"];

// Pure: group event rows ({event, journeyId, clientAt, ...}) into journeys with
// the admin-facing summary. Ordering and duration use the client clock of a
// single journey (one device), so skew between devices doesn't matter.
export function buildJourneys(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.journeyId)) by.set(r.journeyId, []);
    by.get(r.journeyId).push(r);
  }
  const out = [];
  for (const [journeyId, evs] of by) {
    evs.sort((a, b) => String(a.clientAt).localeCompare(String(b.clientAt)));
    const start = Date.parse(evs[0].clientAt);
    const firstSuccessIdx = evs.findIndex((e) => SUCCESS.includes(e.event));
    // "Access granted" is the real finish line; fall back to the earliest success marker.
    const grant = evs.find((e) => e.event === "APP_ACCESS_GRANTED") || evs[firstSuccessIdx];
    const failures = evs.filter((e) => FAILURE.includes(e.event));
    const reasons = [...new Set(failures.map((e) => e.errorCategory || (e.event === "APP_ACCESS_DENIED" ? "access_denied" : e.event === "SESSION_FAILED" ? "session_init_failed" : "unknown")))];
    const attempts = Math.max(1, ...evs.map((e) => e.attempt || 1), evs.filter((e) => e.event === "LOGIN_RETRY").length + 1);
    const last = evs[evs.length - 1];
    const outcome = grant ? "success" : failures.length ? "failed" : last.event === "LOGOUT" ? "logged_out" : "incomplete";
    const methods = evs.map((e) => e.method).filter((m) => m && m !== "other");
    out.push({
      journeyId,
      startedAt: evs[0].clientAt,
      app: evs.find((e) => e.app && e.app !== "other")?.app || evs[0].app,
      method: methods[methods.length - 1] || "other",
      attempts,
      failuresBeforeSuccess: grant ? failures.filter((e) => Date.parse(e.clientAt) <= Date.parse(grant.clientAt)).length : failures.length,
      durationMs: grant ? Math.max(0, Date.parse(grant.clientAt) - start) : null,
      failureReason: reasons.join(", ") || null,
      outcome,
      precededSuccess: firstSuccessIdx > 0 ? evs[firstSuccessIdx - 1].event : null,
      buildVersion: evs[0].buildVersion || null,
      events: evs.map((e) => ({ event: e.event, at: e.clientAt, errorCategory: e.errorCategory || null, method: e.method, attempt: e.attempt || 1 })),
    });
  }
  return out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

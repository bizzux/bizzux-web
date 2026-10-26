// CLIENT — Login Journey Diagnostics tracker, shared by Admin Center,
// Attendance, CRM, Projects and POS (this file is copied verbatim to each
// app's lib/authJourney.js; keep the copies identical).
//
//   import { createJourneyTracker } from "@/lib/authJourney";
//   const journey = createJourneyTracker({ app: "crm", buildVersion: "1.0.0", getToken: () => auth.currentUser?.getIdToken() });
//   journey.track("LOGIN_STARTED", { method: "sso-handoff" });
//   journey.fail("AUTH_FAILED", err, { method: "google" });
//
// What leaves the browser: event name, anonymous journey ID, per-attempt
// correlation ID, app, method, a SAFE error category, attempt number, build and
// client UTC time. The typed email/username (`subject`) is hashed by the server
// and discarded. Passwords, tokens, OAuth codes and cookies are never read.
// Telemetry failures are swallowed — they must never affect sign-in.

const ENDPOINT = (process.env.NEXT_PUBLIC_PORTAL_URL || "https://www.bizzux.com").replace(/\/$/, "") + "/api/auth-journey";
const KEY = "bzx:aj";
const IDLE_MS = 30 * 60 * 1000;
const DONE = ["APP_ACCESS_GRANTED", "LOGOUT"];
const FAILED = ["AUTH_FAILED", "SESSION_FAILED", "APP_ACCESS_DENIED"];

const rid = () => {
  try { return crypto.randomUUID().replace(/-/g, ""); } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
};

function load() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (s && Date.now() - s.t < IDLE_MS) return s;
  } catch { /* storage blocked */ }
  return null;
}
function save(s) { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

// Raw Firebase/OAuth codes -> safe category (mirrors lib/authJourney.js on the server).
export function categorizeAuthError(err) {
  const c = String((err && (err.code || err.message)) || err || "").toLowerCase();
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

export function createJourneyTracker({ app, buildVersion, getToken }) {
  let queue = [];
  let timer = null;

  async function flush() {
    timer = null;
    if (!queue.length || typeof window === "undefined") return;
    const events = queue; queue = [];
    let idToken;
    try { idToken = getToken ? await getToken() : undefined; } catch { /* anonymous */ }
    try {
      fetch(ENDPOINT, { method: "POST", mode: "no-cors", keepalive: true, body: JSON.stringify({ events, idToken }) }).catch(() => {});
    } catch { /* ignore */ }
  }

  function send(ev) {
    queue.push(ev);
    if (queue.length >= 10) return flush();
    if (!timer) timer = setTimeout(flush, 400);
  }

  function track(event, opts = {}) {
    if (typeof window === "undefined") return;
    try {
      let s = load();
      const starting = event === "LOGIN_STARTED";
      if (!s) s = { j: rid(), a: 1, c: rid(), failed: false, t: Date.now() };
      else if (starting) {
        if (s.failed) {
          // A new attempt inside a journey that already failed once.
          s.a += 1; s.c = rid(); s.failed = false;
          send(base(s, "LOGIN_RETRY", opts));
        } else s.c = rid();
      }
      if (FAILED.includes(event)) s.failed = true;
      s.t = Date.now();
      send(base(s, event, opts));
      if (DONE.includes(event)) { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } } else save(s);
    } catch { /* never break sign-in */ }
  }

  function base(s, event, opts) {
    return {
      event, journeyId: s.j, correlationId: s.c, attempt: s.a, app,
      method: opts.method || "other", errorCategory: opts.errorCategory || null,
      subject: opts.subject || undefined, buildVersion, at: new Date().toISOString(),
    };
  }

  // Convenience: record a failure from a caught error without leaking its text.
  function fail(event, err, opts = {}) {
    track(event, { ...opts, errorCategory: opts.errorCategory || (event === "SESSION_FAILED" ? "session_init_failed" : categorizeAuthError(err)) });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  }
  return { track, fail, flush };
}

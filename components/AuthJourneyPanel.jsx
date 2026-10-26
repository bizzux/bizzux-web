"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";

// User → Login History → Authentication Journey. Admin-only; the API enforces
// who may see what (Platform admins: all organizations, Organization admins:
// their own organization only).
const APP_LABEL = { "admin-center": "Admin Center", attendance: "Attendance", crm: "CRM", projects: "Projects", pos: "POS", other: "Other" };
const METHOD_LABEL = { google: "Google", password: "Email + password", "bizzux-id": "Bizzux ID", "sso-handoff": "App hand-off", "custom-token": "Custom token", other: "—" };
const REASON_LABEL = {
  invalid_credentials: "Wrong email/ID or password", popup_blocked: "Pop-up blocked", popup_closed: "Sign-in window closed",
  redirect_failed: "Redirect/return failed", network: "Network problem", account_disabled: "Account disabled", account_closed: "Account closed",
  too_many_requests: "Too many attempts", account_exists_other_method: "Account exists with another method", token_invalid: "Hand-off link invalid/expired",
  access_denied: "No access to this app", session_init_failed: "Session could not start", unknown: "Unknown error",
};
const OUTCOME = { success: "Signed in", failed: "Failed", incomplete: "Not completed", logged_out: "Logged out" };

function dur(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return ms + " ms";
  const s = Math.round(ms / 1000);
  return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + (s % 60) + " s";
}

export default function AuthJourneyPanel() {
  const [email, setEmail] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  async function load(e) {
    e?.preventDefault();
    setBusy(true); setErr("");
    try {
      const token = await auth.currentUser.getIdToken();
      const q = new URLSearchParams();
      if (email.trim()) q.set("email", email.trim());
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const r = await fetch("/api/admin/auth-journeys?" + q, { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Request failed");
      setData(d);
    } catch (x) { setErr(x.message); setData(null); }
    setBusy(false);
  }

  const s = data?.summary;
  return (
    <div className="card">
      <p className="muted" style={{ marginBottom: 10 }}>
        Sign-in attempts as they happened. Only categories and timings are recorded — never passwords, tokens or codes. Kept 30 days.
      </p>
      <form onSubmit={load} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>User email<br /><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Leave blank for everyone" style={{ minWidth: 240 }} /></label>
        <label style={{ fontSize: 12 }}>From<br /><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 12 }}>To<br /><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn" disabled={busy}>{busy ? "Loading…" : "Show journeys"}</button>
      </form>
      {err && <p className="error">{err}</p>}
      {s && (
        <p style={{ fontSize: 13, marginBottom: 8 }}>
          {s.total} journeys · {s.succeeded} signed in · {s.failed} failed · {s.retriedThenSucceeded} succeeded after a failure
          {data.truncated ? " · (results capped — narrow the dates)" : ""}
        </p>
      )}
      {data && data.journeys.length === 0 && <p className="muted">No sign-in journeys recorded for this filter. Journeys exist only from when diagnostics went live.</p>}
      {data && data.journeys.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Date/time</th><th>Application</th><th>Method</th><th>Attempts</th><th>Duration</th><th>Failure reason</th><th>Outcome</th></tr></thead>
            <tbody>
              {data.journeys.map((j) => (
                <>
                  <tr key={j.journeyId} onClick={() => setOpen(open === j.journeyId ? null : j.journeyId)} style={{ cursor: "pointer" }}>
                    <td>{new Date(j.startedAt).toLocaleString()}</td>
                    <td>{APP_LABEL[j.app] || j.app}</td>
                    <td>{METHOD_LABEL[j.method] || j.method}</td>
                    <td>{j.attempts}</td>
                    <td>{dur(j.durationMs)}</td>
                    <td>{j.failureReason ? j.failureReason.split(", ").map((x) => REASON_LABEL[x] || x).join("; ") : "—"}</td>
                    <td>{OUTCOME[j.outcome] || j.outcome}</td>
                  </tr>
                  {open === j.journeyId && (
                    <tr key={j.journeyId + "-d"}>
                      <td colSpan={7} style={{ fontSize: 12, background: "rgba(0,0,0,.03)" }}>
                        {j.events.map((e, i) => (
                          <div key={i}>{new Date(e.at).toLocaleTimeString()} · {e.event}{e.errorCategory ? " (" + (REASON_LABEL[e.errorCategory] || e.errorCategory) + ")" : ""}</div>
                        ))}
                        {j.buildVersion && <div className="muted">Build {j.buildVersion}</div>}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Link from "next/link";
import OrganizationsManager from "@/components/OrganizationsManager";
import PricingManager from "@/components/PricingManager";
import { APP_CATALOG } from "@/lib/apps";
import { IconTrash } from "@/components/Icons";

// Ported from apps.bizzux.com's app/admin/page.js (Super Admin panel), now
// embedded as the "Super Admin" tab of bizzux.com's merged /admin page —
// see app/admin/AdminTabs.tsx. Gated on Firebase Auth + SUPER_ADMIN_EMAIL,
// which is a SEPARATE check from the cookie-session password that already
// protects the whole /admin route (that guards the Career Applications
// tab): someone could hold one without the other, so this shows its own
// sign-in prompt instead of bouncing the whole page away.
const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "business", label: "Business Health" },
  { id: "organizations", label: "Organizations" },
  { id: "customers", label: "Support / Customers" },
  { id: "pricing", label: "Billing & Pricing" },
  { id: "offers", label: "Offers" },
  { id: "resellers", label: "Partners" },
  { id: "trial", label: "Platform Configuration" },
  { id: "platformadmins", label: "Platform Admins" },
  { id: "auditlogs", label: "Audit Logs" },
  { id: "security", label: "Security Settings" },
  { id: "storage", label: "Storage" },
  // Platform Owner only; filtered out of the tab bar for Platform Admins.
  { id: "deleteuser", label: "Delete & Recover", ownerOnly: true },
];

async function api(path, method, body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function SuperAdminPanel() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const [isSuper, setIsSuper] = useState(null); // null = checking
  const [platformRole, setPlatformRole] = useState(null); // "OWNER" | "ADMIN" | null
  const [tab, setTab] = useState("dashboard");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const t = await user.getIdToken();
        const r = await fetch("/api/me", { headers: { Authorization: "Bearer " + t } });
        const d = await r.json();
        setIsSuper(d.superAdmin === true);
        setPlatformRole(d.platformRole || null);
      } catch {
        setIsSuper(false);
      }
    })();
  }, [user]);

  if (user === undefined) {
    return <p className="muted">Loading…</p>;
  }
  if (!user) {
    return (
      <div className="card" style={{ maxWidth: 460 }}>
        <p style={{ marginBottom: 12 }}>Sign in with your Bizzux Super Admin account to manage plans and organizations.</p>
        <Link href="/sign-in" className="btn-primary-sm">Sign in</Link>
      </div>
    );
  }
  if (isSuper === null) {
    return <p className="muted">Checking access…</p>;
  }
  if (!isSuper) {
    return <p>{user.email} doesn&apos;t have Super Admin access.</p>;
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Signed in as <strong>{user.email}</strong>
        </p>
        <span className="status-pill active">{platformRole === "OWNER" ? "Platform Owner" : "Platform Admin"}</span>
      </div>

      <div className="admin-tabs" role="tablist">
        {TABS.filter((t) => !t.ownerOnly || platformRole === "OWNER").map((t) => (
          <button
            key={t.id} role="tab" aria-selected={tab === t.id}
            className={"admin-tab" + (tab === t.id ? " active" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <PlatformDashboard isOwner={platformRole === "OWNER"} />}
      {tab === "business" && <BusinessHealthPanel isOwner={platformRole === "OWNER"} />}
      {tab === "trial" && <TrialSettings />}
      {tab === "pricing" && <PricingManager />}
      {tab === "offers" && <OffersManager />}
      {tab === "resellers" && <ResellersManager />}
      {tab === "customers" && <CustomersList isOwner={platformRole === "OWNER"} />}
      {tab === "organizations" && <OrganizationsManager />}
      {tab === "platformadmins" && <PlatformAdminsManager isOwner={platformRole === "OWNER"} />}
      {tab === "auditlogs" && <AuditLogsPanel />}
      {tab === "security" && <SecuritySettingsPanel />}
      {tab === "storage" && <BlobCleanupPanel />}
      {tab === "deleteuser" && platformRole === "OWNER" && <UsersLifecycleTab />}
    </div>
  );
}

// Platform Owner -> Delete User (also opened from a customer's detail
// panel). Look up by email, review exactly what goes, type the email to
// confirm. See app/api/admin/users/route.js for what is and isn't removed.
function DeleteUserPanel({ initialEmail = "", onDeleted }) {
  const [email, setEmail] = useState(initialEmail);
  const [info, setInfo] = useState(null);
  const [recoveryDays, setRecoveryDays] = useState(60);
  const [mode, setMode] = useState(null); // null | "close" | "delete"
  const [confirmEmail, setConfirmEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  async function lookUp(e, emailArg) {
    e && e.preventDefault();
    const target = (emailArg ?? email).trim();
    setErr("");
    setDone("");
    setInfo(null);
    setMode(null);
    setConfirmEmail("");
    if (!target) return;
    setBusy(true);
    try {
      const d = await api("/api/admin/users?email=" + encodeURIComponent(target), "GET");
      setInfo(d.user);
      if (d.recoveryDays) setRecoveryDays(d.recoveryDays);
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  }

  useEffect(() => {
    if (initialEmail) lookUp();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action) {
    setBusy(true);
    setErr("");
    try {
      const d = await api("/api/admin/users", "POST", { action, email: info.email, confirmEmail });
      if (action === "delete") {
        const r = d.report || {};
        setDone(
          `${info.email} was deleted everywhere (${r.docs || 0} records, ${r.blobs || 0} uploaded files` +
            (r.shopDocs ? `, ${r.shopDocs} Bizzux Business records` : "") +
            "). That email can now sign up again as a brand-new user." +
            (r.skipped?.length ? " Not reached: " + r.skipped.join("; ") + "." : "")
        );
        setInfo(null);
        setEmail("");
      } else if (action === "close") {
        setDone(`${info.email} is closed. They can't sign in, and their data is kept for ${recoveryDays} days in case you need to recover it.`);
        await lookUp(null, info.email);
      } else if (action === "recover") {
        setDone(`${info.email} is recovered and can sign in again, with everything as it was.`);
        await lookUp(null, info.email);
      }
      setMode(null);
      setConfirmEmail("");
      onDeleted && onDeleted();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  }

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "N/A");
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : "N/A");
  const confirmed = info && confirmEmail.trim().toLowerCase() === info.email.toLowerCase();

  return (
    <div>
      <h3 style={{ fontSize: 15, marginBottom: 6 }}>Close, recover or delete a user</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        <strong>Close</strong> blocks sign-in and every app now but keeps all data for {recoveryDays} days, so you can
        recover it. <strong>Delete now</strong> wipes everything immediately (best for test accounts) and frees the email
        to sign up again.
      </p>

      <form onSubmit={lookUp} className="row" style={{ gap: 8, marginBottom: 14 }}>
        <input
          className="input" type="email" placeholder="user@example.com" value={email}
          onChange={(e) => setEmail(e.target.value)} style={{ flex: 1 }}
        />
        <button className="btn-small" disabled={busy || !email.trim()}>{busy && !info ? "Looking up…" : "Look up"}</button>
      </form>

      {err && <p className="error" style={{ marginBottom: 12, overflowWrap: "anywhere" }}>{err}</p>}
      {done && <p style={{ color: "#15803d", fontSize: 13, marginBottom: 12 }}>{done}</p>}

      {info && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{info.displayName || info.email}</div>
              <div className="muted" style={{ fontSize: 13 }}>{info.email}</div>
            </div>
            {info.closed && <span className="status-pill expired">Closed</span>}
          </div>
          <div className="row" style={{ gap: 22, flexWrap: "wrap", fontSize: 13, margin: "10px 0 12px" }}>
            <div><div className="label">Signed up</div>{fmt(info.createdAt)}</div>
            <div><div className="label">Last login</div>{fmt(info.lastLoginAt)}</div>
            <div>
              <div className="label">Business</div>
              {info.ownsBusiness
                ? `${info.ownsBusiness.organizationName || "(unnamed)"} · ${info.ownsBusiness.status}` +
                  (info.ownsBusiness.teamCount ? ` · team of ${info.ownsBusiness.teamCount}` : "")
                : info.memberOf
                  ? `Team member of ${info.memberOf.organizationName || "another business"}`
                  : "None yet"}
            </div>
          </div>

          {info.closed && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12 }}>
              Closed on {fmtDate(info.closed.closedAt)}. Everything is wiped automatically on{" "}
              <strong>{fmtDate(info.closed.purgeAfter)}</strong> unless you recover it first.
            </div>
          )}

          {info.blockedReason ? (
            <p className="error">{info.blockedReason}</p>
          ) : mode === null ? (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {info.closed ? (
                <button className="btn-primary-sm" disabled={busy} onClick={() => run("recover")}>
                  {busy ? "Recovering…" : "Recover account"}
                </button>
              ) : (
                <button className="btn-small" onClick={() => setMode("close")}>Close account (recoverable)</button>
              )}
              <button
                className="btn-small" style={{ color: "var(--red)", borderColor: "#fca5a5" }}
                onClick={() => setMode("delete")}
              >
                Delete now…
              </button>
            </div>
          ) : mode === "close" ? (
            <div>
              <p style={{ fontSize: 13, marginBottom: 10 }}>
                {info.email} will be signed out and blocked from every app right away
                {info.ownsBusiness?.teamCount ? ", and so will their team" : ""}. Nothing is deleted for {recoveryDays} days.
                After that it's wiped automatically.
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn-small" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
                <button
                  className="btn-small" style={{ background: "var(--red)", borderColor: "var(--red)", color: "#fff" }}
                  disabled={busy} onClick={() => run("close")}
                >
                  {busy ? "Closing…" : "Close account"}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Deleted immediately, in every app</div>
              <ul style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18, margin: "0 0 10px" }}>
                <li>Their sign-in, profile, Mail inbox and Assistant data</li>
                {info.ownsBusiness && (
                  <li>
                    Business <strong>{info.ownsBusiness.organizationName || "(unnamed)"}</strong> with all its CRM, Notes,
                    Files, Projects, Chat and Bizzux Business data and uploaded files
                    {info.ownsBusiness.teamCount > 0 && ". Team members keep their own logins but lose this business"}
                  </li>
                )}
                {info.memberOf && <li>Their place on the team of {info.memberOf.organizationName || "another business"}</li>}
              </ul>
              <p className="error" style={{ fontSize: 12.5, marginBottom: 10 }}>This can't be undone.</p>
              <label className="label">Type <strong>{info.email}</strong> to confirm</label>
              <input
                className="input" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={info.email} style={{ marginBottom: 10 }}
              />
              <div className="row" style={{ gap: 8 }}>
                <button className="btn-small" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
                <button
                  type="button" className="btn-small" disabled={!confirmed || busy} onClick={() => run("delete")}
                  style={confirmed ? { background: "var(--red)", borderColor: "var(--red)", color: "#fff" } : undefined}
                >
                  {busy ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Accounts closed but still recoverable, soonest wipe first.
function ClosedAccountsList({ refreshKey, onPick }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const d = await api("/api/admin/users?closed=1", "GET");
        setRows(d.closed || []);
      } catch (e) {
        setErr(e.message);
        setRows([]);
      }
    })();
  }, [refreshKey]);

  if (rows === null) return <p className="muted">Loading closed accounts…</p>;
  const daysLeft = (iso) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  return (
    <div>
      <h3 style={{ fontSize: 15, marginBottom: 6 }}>Closed accounts</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Still recoverable. Click one to recover it or delete it now.</p>
      {err && <p className="error">{err}</p>}
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No closed accounts.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>User</th><th>Business</th><th>Closed</th><th>Wiped in</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uid} onClick={() => onPick(r.email)} style={{ cursor: "pointer" }}>
                  <td>{r.email}</td>
                  <td>{r.organizationName || <span className="muted">N/A</span>}</td>
                  <td>{r.closedAt ? new Date(r.closedAt).toLocaleDateString() : "N/A"}</td>
                  <td><strong>{daysLeft(r.purgeAfter)} days</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// The Platform Owner's "Delete & Recover" tab: the closed list plus the
// look-up panel, wired so picking a closed row loads it into the panel.
function UsersLifecycleTab() {
  const [picked, setPicked] = useState({ email: "", n: 0 });
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "1 1 460px", margin: 0 }}>
        <DeleteUserPanel
          key={picked.n} initialEmail={picked.email}
          onDeleted={() => setRefreshKey((k) => k + 1)}
        />
      </div>
      <div className="card" style={{ flex: "1 1 360px", margin: 0 }}>
        <ClosedAccountsList refreshKey={refreshKey} onPick={(email) => setPicked((p) => ({ email, n: p.n + 1 }))} />
      </div>
    </div>
  );
}

function SecuritySettingsPanel() {
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h3 style={{ fontSize: 15, marginBottom: 10 }}>Multi-factor authentication</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        MFA isn't enabled yet for the Platform Owner account. Enabling it is a real decision, not just a toggle here —
        Firebase supports phone/SMS-based MFA on the current plan at no extra setup cost, or authenticator-app (TOTP)
        MFA, which requires upgrading this Firebase project to Google Cloud Identity Platform (a separate GCP product
        with its own per-active-user billing). Once you pick one, this gets built and enforced on sign-in for{" "}
        <strong>info.bizzux@gmail.com</strong>.
      </p>
      <div className="row" style={{ gap: 10 }}>
        <span className="status-pill expired">Not yet enabled</span>
      </div>

      <h3 style={{ fontSize: 15, margin: "24px 0 10px" }}>Access policy</h3>
      <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 18, margin: 0 }}>
        <li>Only one Platform Owner exists at a time — see the Platform Admins tab.</li>
        <li>Platform Admins are created only by the Owner and can never create or remove other Platform Admins.</li>
        <li>Every sensitive platform action is recorded in Audit Logs.</li>
      </ul>
    </div>
  );
}

// Super Admin -> Storage. The Blob store (1GB on the Hobby plan) filled up
// because every published Screen Recorder build kept its own old version
// around forever — see scripts/publish-screen-recorder.mjs, which now
// deletes the previous build before uploading a new one going forward. This
// is purely for cleaning up everything published BEFORE that fix: preview
// what's orphaned, then actually delete it once you've checked the numbers
// look right. Never touches whichever build productReleases/screen-recorder
// currently points at, so today's live download link is never at risk.
function BlobCleanupPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);

  async function preview() {
    setLoading(true);
    setErr("");
    setResult(null);
    try {
      const d = await api("/api/admin/blob-cleanup", "GET");
      setData(d);
    } catch (e) {
      setErr(e.message || "Couldn't load storage info");
    }
    setLoading(false);
  }

  async function cleanup() {
    if (!data || data.wouldDelete.length === 0) return;
    if (!window.confirm(`Permanently delete ${data.wouldDelete.length} old build(s), freeing ~${(data.totalBytes / 1024 / 1024).toFixed(0)}MB? This can't be undone.`)) return;
    setDeleting(true);
    setErr("");
    try {
      const d = await api("/api/admin/blob-cleanup", "POST");
      setResult(d);
      setData(null);
    } catch (e) {
      setErr(e.message || "Cleanup failed");
    }
    setDeleting(false);
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h3 style={{ fontSize: 15, marginBottom: 10 }}>Old Screen Recorder builds</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Every previously published installer build is still sitting in the Blob store. Preview what would be
        deleted before actually deleting anything — the current, live build is never touched.
      </p>
      {err && <p className="error">⚠️ {err}</p>}
      {result && (
        <p style={{ color: "#16a34a", fontSize: 13, marginBottom: 12 }}>
          ✓ Deleted {result.deletedCount} build(s), freed ~{(result.freedBytes / 1024 / 1024).toFixed(0)}MB.
        </p>
      )}
      <div className="row" style={{ gap: 10, marginBottom: data ? 14 : 0 }}>
        <button type="button" className="btn-small" disabled={loading} onClick={preview}>
          {loading ? "Checking…" : "Preview what would be deleted"}
        </button>
        {data && data.wouldDelete.length > 0 && (
          <button type="button" className="btn-primary-sm" disabled={deleting} onClick={cleanup} style={{ background: "#dc2626" }}>
            {deleting ? "Deleting…" : `Delete ${data.wouldDelete.length} old build(s)`}
          </button>
        )}
      </div>
      {data && (
        <div style={{ fontSize: 12.5 }}>
          <p className="muted" style={{ marginBottom: 6 }}>
            Current live build: <code>{data.currentBlobPath || "none published yet"}</code>
          </p>
          {data.wouldDelete.length === 0 ? (
            <p className="muted">Nothing orphaned — storage is already clean.</p>
          ) : (
            <>
              <p style={{ fontWeight: 600, marginBottom: 6 }}>
                {data.wouldDelete.length} old build(s), ~{(data.totalBytes / 1024 / 1024).toFixed(0)}MB total:
              </p>
              <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
                {data.wouldDelete.map((b) => (
                  <li key={b.pathname}>
                    {b.pathname} — {((b.size || 0) / 1024 / 1024).toFixed(1)}MB
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Super Admin -> Business Health. Bizzux's OWN running costs and breakeven
// math (salaries, rent, hosting, domain, tools) against real MRR pulled
// live from the customers/plans data — not anything a Bizzux customer ever
// sees, purely for the Platform Owner (and staff, so everyone's aligned on
// the same reality) to manage Bizzux as a business. See
// app/api/admin/business-costs/route.js — viewing is open to any Platform
// Admin, editing the cost figures is Owner-only.
function BusinessHealthPanel({ isOwner }) {
  const [data, setData] = useState(null);
  const [recurring, setRecurring] = useState([]);
  const [oneTime, setOneTime] = useState([]);
  const [assumedAvgRevenue, setAssumedAvgRevenue] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const d = await api("/api/admin/business-costs", "GET");
      setData(d);
      setRecurring(d.recurring.length ? d.recurring : [{ label: "", amount: "" }]);
      setOneTime(d.oneTime.length ? d.oneTime : [{ label: "", amount: "" }]);
      setAssumedAvgRevenue(d.assumedAvgRevenue ? String(d.assumedAvgRevenue) : "");
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  function setLine(list, setList, idx, field, value) {
    setList(list.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  function addLine(list, setList) {
    setList([...list, { label: "", amount: "" }]);
  }
  function removeLine(list, setList, idx) {
    setList(list.length > 1 ? list.filter((_, i) => i !== idx) : [{ label: "", amount: "" }]);
  }

  async function save() {
    setSaving(true);
    setErr("");
    try {
      await api("/api/admin/business-costs", "POST", {
        recurring: recurring.filter((r) => r.label.trim()),
        oneTime: oneTime.filter((r) => r.label.trim()),
        assumedAvgRevenue: Number(assumedAvgRevenue) || 0,
      });
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  }

  if (data === null) return <p className="muted">Loading…</p>;
  const s = data.summary;

  function CostRows({ list, setList, unitLabel }) {
    return (
      <>
        {list.map((r, i) => (
          <div className="row" key={i} style={{ gap: 10, marginBottom: 8 }}>
            <input
              className="input" style={{ flex: 2 }} placeholder={unitLabel}
              value={r.label} disabled={!isOwner}
              onChange={(e) => setLine(list, setList, i, "label", e.target.value)}
            />
            <input
              className="input" style={{ flex: 1 }} type="number" min="0" placeholder="₹/month"
              value={r.amount} disabled={!isOwner}
              onChange={(e) => setLine(list, setList, i, "amount", e.target.value)}
            />
            {isOwner && (
              <button type="button" className="btn-ghost" onClick={() => removeLine(list, setList, i)}>✕</button>
            )}
          </div>
        ))}
        {isOwner && (
          <button type="button" className="link-btn" onClick={() => addLine(list, setList)}>+ Add line</button>
        )}
      </>
    );
  }

  return (
    <div>
      <div className="proj-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 20 }}>
        {[
          { label: "Current MRR", value: money(s.mrr) },
          { label: "Total monthly cost", value: money(s.totalMonthlyCost) },
          { label: s.monthlyProfitOrLoss >= 0 ? "Monthly profit" : "Monthly loss", value: money(Math.abs(s.monthlyProfitOrLoss)) },
          { label: "Active paying customers", value: s.activeCount },
          { label: "Avg revenue / customer", value: s.avgRevenuePerCustomer > 0 ? money(s.avgRevenuePerCustomer) : (s.effectiveAvgRevenue > 0 ? money(s.effectiveAvgRevenue) + " (assumed)" : "—") },
          { label: "Customers needed to break even", value: s.customersToBreakeven ?? "—" },
        ].map((c) => (
          <div key={c.label} className="card">
            <div className="muted" style={{ fontSize: 12.5 }}>{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {s.customersToBreakeven != null && (
        <p className="muted" style={{ marginBottom: 20 }}>
          {s.activeCount >= s.customersToBreakeven
            ? `Past breakeven — ${s.activeCount} active customers against ${s.customersToBreakeven} needed.`
            : `${s.customersShortOfBreakeven} more paying customer${s.customersShortOfBreakeven === 1 ? "" : "s"} needed to break even, at ~${money(s.effectiveAvgRevenue)}/customer/month.`}
        </p>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="section-title" style={{ marginTop: 0 }}>Recurring monthly costs</p>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Salaries, office rent, hosting, domains, Firebase/Vercel plans, tools — anything that recurs every month.
        </p>
        <CostRows list={recurring} setList={setRecurring} unitLabel="e.g. Sales person salary" />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="section-title" style={{ marginTop: 0 }}>One-time / capital costs</p>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Equipment, setup costs — tracked for reference, not counted in the monthly breakeven math below.
        </p>
        <CostRows list={oneTime} setList={setOneTime} unitLabel="e.g. Laptop" />
        <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>Total invested: <strong>{money(s.totalOneTime)}</strong></p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="section-title" style={{ marginTop: 0 }}>Assumed avg. revenue per customer (₹/month)</p>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Used for planning before there's enough real paying-customer data to compute this automatically —
          ignored once real MRR/customer data is available.
        </p>
        <input
          className="input" style={{ maxWidth: 200 }} type="number" min="0" placeholder="e.g. 1000"
          value={assumedAvgRevenue} disabled={!isOwner}
          onChange={(e) => setAssumedAvgRevenue(e.target.value)}
        />
      </div>

      {isOwner ? (
        <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
      ) : (
        <p className="muted">Only the Platform Owner can edit these figures.</p>
      )}
      {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
    </div>
  );
}

// Platform Admin landing view. Built on /api/admin/signups (every sign-in,
// including people who never set up a business) rather than the customers
// list, so the sign-up -> business -> app -> paid drop-off is visible.
// Every tile is also a filter: click it to list exactly those users below,
// then click a user to open their details.
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGES = [7, 30, 90];

function daysUntil(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS);
}

function PlatformDashboard({ isOwner }) {
  const [users, setUsers] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [err, setErr] = useState("");
  const [range, setRange] = useState(30);
  const [view, setView] = useState("new");
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  async function load() {
    setErr("");
    try {
      const [s, c] = await Promise.all([api("/api/admin/signups", "GET"), api("/api/admin/customers", "GET")]);
      setUsers(s.users || []);
      setCustomers(c.customers || []);
    } catch (e) {
      setErr(e.message);
      setUsers([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  if (users === null) return <p className="muted">Loading…</p>;

  const since = Date.now() - range * DAY_MS;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const people = users.filter((u) => u.kind !== "platform");
  const isNew = (u) => u.createdAt && new Date(u.createdAt).getTime() >= since;
  const hasBiz = (u) => u.kind === "owner" || u.kind === "member";

  const VIEWS = {
    new: { label: `New sign-ups (last ${range} days)`, test: isNew },
    all: { label: "All users", test: () => true },
    nobiz: { label: "Signed up, no business yet", test: (u) => u.kind === "none" },
    biz: { label: "Set up or joined a business", test: hasBiz },
    apps: { label: "Opened at least one app", test: (u) => u.kind === "owner" && u.appsUsed.length > 0 },
    paid: { label: "Paid businesses", test: (u) => u.kind === "owner" && u.status === "active" && !u.free },
    free: { label: "Free licenses (own business, family, testers)", test: (u) => u.kind === "owner" && u.free },
    ending: {
      label: "Trial ends within 3 days",
      test: (u) => {
        const d = daysUntil(u.trialEndDate);
        return u.kind === "owner" && u.status === "trial" && d !== null && d >= 0 && d <= 3;
      },
    },
    suspended: { label: "Suspended", test: (u) => u.kind === "owner" && u.status === "suspended" },
  };
  const count = (key) => people.filter(VIEWS[key].test).length;
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

  const newCount = count("new");
  const todayCount = people.filter((u) => u.createdAt && new Date(u.createdAt) >= startOfToday).length;
  const nobiz = count("nobiz");

  const tiles = [
    { key: "new", label: `New sign-ups · ${range}d`, value: newCount, sub: `${todayCount} today` },
    { key: "all", label: "Total users", value: people.length, sub: "all time" },
    { key: "nobiz", label: "No business yet", value: nobiz, sub: `${pct(nobiz, people.length)}% of users` },
    { key: "biz", label: "Set up a business", value: count("biz"), sub: `${pct(count("biz"), people.length)}% of users` },
    { key: "apps", label: "Opened an app", value: count("apps"), sub: "business owners" },
    { key: "paid", label: "Paid", value: count("paid"), sub: "active subscriptions" },
    { key: "free", label: "Free licenses", value: count("free"), sub: "not counted as revenue" },
    { key: "ending", label: "Trial ending ≤ 3 days", value: count("ending"), sub: "follow up now" },
    { key: "suspended", label: "Suspended", value: count("suspended"), sub: "blocked from apps" },
  ];

  // Sign-ups per day across the selected range, oldest first.
  const days = [];
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date(startOfToday.getTime() - i * DAY_MS);
    days.push({ date: d, total: 0, withBiz: 0 });
  }
  people.forEach((u) => {
    if (!u.createdAt) return;
    const t = new Date(u.createdAt);
    t.setHours(0, 0, 0, 0);
    const idx = Math.round((t.getTime() - days[0].date.getTime()) / DAY_MS);
    if (idx >= 0 && idx < days.length) {
      days[idx].total++;
      if (hasBiz(u)) days[idx].withBiz++;
    }
  });

  const funnel = [
    { label: "Signed up", value: people.length },
    { label: "Set up or joined a business", value: count("biz") },
    { label: "Opened an app", value: count("apps") },
    { label: "Paid", value: count("paid") },
  ];

  const q = search.trim().toLowerCase();
  const list = people
    .filter(VIEWS[view].test)
    .filter((u) => !q || [u.name, u.email, u.organizationName, u.city, u.country].some((v) => v && v.toLowerCase().includes(q)));

  function openUser(u) {
    const c = u.kind === "owner" ? customers.find((x) => x.id === u.uid) : null;
    if (c) setSelectedCustomer(c);
    else setSelectedUser(u);
  }

  return (
    <div>
      {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <h3 style={{ fontSize: 17, margin: 0 }}>Platform overview</h3>
        <div className="row" style={{ gap: 6 }} role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r} type="button" onClick={() => setRange(r)}
              className={r === range ? "btn-primary-sm" : "btn-small"}
              aria-pressed={r === range}
            >
              Last {r} days
            </button>
          ))}
          <button type="button" className="btn-ghost" onClick={load} title="Reload">↻ Refresh</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
        {tiles.map((t) => (
          <button
            key={t.key} type="button" onClick={() => setView(t.key)} aria-pressed={view === t.key}
            className="card"
            style={{
              textAlign: "left", cursor: "pointer", padding: 16, margin: 0,
              font: "inherit", color: "inherit", background: "#fff",
              border: view === t.key ? "2px solid var(--teal)" : "1px solid var(--line)",
            }}
          >
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>{t.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>{t.value}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t.sub}</div>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
        <div className="card" style={{ margin: 0, flex: "2 1 420px", minWidth: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>New sign-ups per day</div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
            {newCount} in the last {range} days. Hover a bar for details.
          </div>
          <SignupChart days={days} />
        </div>
        <div className="card" style={{ margin: 0, flex: "1 1 280px", minWidth: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Where users drop off</div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>All time, share of everyone who signed up</div>
          {funnel.map((f) => (
            <div key={f.label} style={{ marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span>{f.label}</span>
                <span style={{ fontWeight: 700 }}>
                  {f.value} <span className="muted" style={{ fontWeight: 400 }}>· {pct(f.value, funnel[0].value)}%</span>
                </span>
              </div>
              <div style={{ height: 10, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${pct(f.value, funnel[0].value)}%`, minWidth: f.value ? 4 : 0, height: "100%", background: "var(--teal)", borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ margin: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 700 }}>{VIEWS[view].label}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>{list.length} user{list.length === 1 ? "" : "s"} · click a row to view</div>
          </div>
          <input
            className="input" placeholder="Search name, email, business, city…" value={search}
            onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 300 }}
          />
        </div>
        {list.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No users here.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>User</th><th>Signed up</th><th>Stage</th><th>Business</th><th>Apps used</th><th>Last login</th><th>Location</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.uid} onClick={() => openUser(u)} style={{ cursor: "pointer" }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.name || u.email}</div>
                      {u.name && <div className="muted" style={{ fontSize: 12 }}>{u.email}</div>}
                    </td>
                    <td title={u.createdAt ? new Date(u.createdAt).toLocaleString() : ""}>{timeAgo(u.createdAt)}</td>
                    <td><StagePill user={u} /></td>
                    <td>{u.organizationName || <span className="muted">N/A</span>}</td>
                    <td>
                      {u.appsUsed.length === 0 ? (
                        <span className="muted" style={{ fontSize: 12 }}>None yet</span>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {u.appsUsed.map((k) => (
                            <span key={k} className="status-pill active" style={{ fontSize: 11 }}>{APP_USAGE_LABELS[k] || k}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td title={u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : ""}>{timeAgo(u.lastLoginAt)}</td>
                    <td>{[u.city, u.country].filter(Boolean).join(", ") || <span className="muted">N/A</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedCustomer && (
        <CustomerDetailPanel
          customer={selectedCustomer} isOwner={isOwner}
          onClose={() => setSelectedCustomer(null)} onChanged={load}
        />
      )}
      {selectedUser && (
        <UserDetailModal
          user={selectedUser} isOwner={isOwner}
          onClose={() => setSelectedUser(null)}
          onOpenBusiness={(id) => {
            const c = customers.find((x) => x.id === id);
            if (c) {
              setSelectedUser(null);
              setSelectedCustomer(c);
            }
          }}
          onDeleted={() => {
            setSelectedUser(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function StagePill({ user: u }) {
  if (u.disabled || u.status === "closed") return <span className="status-pill expired">Closed</span>;
  if (u.kind === "none") return <span className="status-pill" style={{ background: "#f1f5f9", color: "#475569" }}>No business yet</span>;
  if (u.kind === "member") return <span className="status-pill" style={{ background: "#eef2ff", color: "#4338ca" }}>Team member</span>;
  if (u.free) return <span className="status-pill active" style={{ background: "#ecfdf5", color: "#047857" }}>Owner · free</span>;
  const s = u.status || "trial";
  return (
    <span className={"status-pill " + (s === "suspended" ? "expired" : s)}>
      {s === "trial" ? "Owner · trial" : s === "active" ? "Owner · paid" : "Owner · " + s}
    </span>
  );
}

// Single series, so no legend: the card title names it. Bars are anchored
// to the baseline with rounded tops; each day has a full-height invisible
// hit target so thin bars are still easy to hover.
function SignupChart({ days }) {
  const [hover, setHover] = useState(null);
  const W = 720;
  const H = 220;
  const padL = 30;
  const padB = 24;
  const padT = 8;
  const plotW = W - padL;
  const plotH = H - padB - padT;
  const max = Math.max(1, ...days.map((d) => d.total));
  const niceMax = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const ticks = niceMax <= 4 ? Array.from({ length: niceMax + 1 }, (_, i) => i) : [0, niceMax / 4, niceMax / 2, (3 * niceMax) / 4, niceMax];
  const slot = plotW / days.length;
  const barW = Math.max(2, slot - 2);
  const y = (v) => padT + plotH - (v / niceMax) * plotH;
  const labelEvery = days.length <= 7 ? 1 : days.length <= 30 ? 5 : 15;
  const fmt = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });

  function barPath(x, top, w, bottom) {
    const h = bottom - top;
    if (h <= 0) return "";
    const r = Math.min(4, w / 2, h);
    return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${bottom} Z`;
  }

  const hd = hover !== null ? days[hover] : null;
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="New sign-ups per day" style={{ display: "block" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{t}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          return (
            <g key={i}>
              <path d={barPath(x, y(d.total), barW, y(0))} fill="var(--teal)" opacity={hover === null || hover === i ? 1 : 0.45} />
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#94a3b8">{fmt(d.date)}</text>
              )}
              <rect
                x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hd && (
        <div
          style={{
            position: "absolute", top: 0, pointerEvents: "none",
            left: `clamp(0px, calc(${((padL + (hover + 0.5) * slot) / W) * 100}% - 80px), calc(100% - 160px))`,
            width: 160, background: "#0f172a", color: "#fff", borderRadius: 8, padding: "8px 10px", fontSize: 12,
            boxShadow: "0 4px 12px rgba(15,23,42,0.2)",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{hd.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</div>
          <div>{hd.total} sign-up{hd.total === 1 ? "" : "s"}</div>
          <div style={{ opacity: 0.75 }}>{hd.withBiz} set up or joined a business</div>
        </div>
      )}
    </div>
  );
}

// For users who don't own a business (no customers/ record, so the full
// CustomerDetailPanel doesn't apply): the basics, plus a jump to the
// business they belong to, and Delete for the Platform Owner.
function UserDetailModal({ user: u, isOwner, onClose, onOpenBusiness, onDeleted }) {
  const [showDelete, setShowDelete] = useState(false);
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "N/A");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: "100%" }}>
        {showDelete ? (
          <DeleteUserPanel initialEmail={u.email} onDeleted={onDeleted} />
        ) : (
          <>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <h2 style={{ marginBottom: 2 }}>{u.name || u.email}</h2>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>{u.email}</p>
              </div>
              <StagePill user={u} />
            </div>
            <div className="row" style={{ gap: 22, flexWrap: "wrap", margin: "16px 0", fontSize: 13 }}>
              <div><div className="label">Signed up</div>{fmt(u.createdAt)}</div>
              <div><div className="label">Last login</div>{fmt(u.lastLoginAt)}</div>
              <div><div className="label">Sign-in method</div>{u.provider}</div>
              <div><div className="label">Email verified</div>{u.emailVerified ? "Yes" : "No"}</div>
              <div><div className="label">Location</div>{[u.city, u.country].filter(Boolean).join(", ") || "N/A"}</div>
            </div>
            {u.kind === "none" && (
              <p className="muted" style={{ fontSize: 13 }}>
                Signed up but hasn't opened a company app yet, so no business has been set up.
              </p>
            )}
            {u.kind === "member" && (
              <p style={{ fontSize: 13 }}>
                Team member of <strong>{u.organizationName || "a business"}</strong>.{" "}
                <button type="button" className="link-btn" onClick={() => onOpenBusiness(u.organizationId)}>View that business</button>
              </p>
            )}
          </>
        )}
        <div className="row" style={{ justifyContent: "space-between", marginTop: 16, gap: 8 }}>
          {isOwner && !showDelete ? (
            <button className="btn-small" style={{ color: "var(--red)", borderColor: "#fca5a5" }} onClick={() => setShowDelete(true)}>Delete user…</button>
          ) : (
            <span />
          )}
          <button type="button" className="btn-outline-dark" onClick={showDelete ? () => setShowDelete(false) : onClose}>
            {showDelete ? "Back" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AuditLogsPanel() {
  const [logs, setLogs] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await api("/api/admin/audit-logs", "GET");
        setLogs(d.logs || []);
      } catch (e) {
        setErr(e.message);
        setLogs([]);
      }
    })();
  }, []);

  if (logs === null) return <p className="muted">Loading…</p>;

  return (
    <div className="card">
      {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}
      {logs.length === 0 && <p className="muted">No sensitive actions logged yet.</p>}
      {logs.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Target</th><th>Details</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{l.createdAt ? new Date(l.createdAt).toLocaleString() : "—"}</td>
                  <td>{l.actorEmail}</td>
                  <td>{l.actorRole}</td>
                  <td>{l.action}</td>
                  <td>{l.targetType ? `${l.targetType}: ${l.targetId}` : "—"}</td>
                  <td style={{ fontSize: 11.5, maxWidth: 260, whiteSpace: "normal" }}>{JSON.stringify(l.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PlatformAdminsManager({ isOwner }) {
  const [admins, setAdmins] = useState(null);
  const [err, setErr] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [actingUid, setActingUid] = useState(null);

  async function load() {
    try {
      const d = await api("/api/admin/platform-admins", "GET");
      setAdmins(d.admins || []);
    } catch (e) {
      setErr(e.message);
      setAdmins([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createAdmin(e) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await api("/api/admin/platform-admins", "POST", { action: "create", email: newEmail.trim() });
      setNewEmail("");
      await load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(a) {
    const action = a.status === "disabled" ? "reactivate" : "disable";
    if (action === "disable" && !confirm(`Disable Platform Admin access for ${a.email}?`)) return;
    setActingUid(a.uid);
    setErr("");
    try {
      await api("/api/admin/platform-admins", "POST", { action, uid: a.uid });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setActingUid(null);
    }
  }

  if (admins === null) return <p className="muted">Loading…</p>;

  return (
    <div>
      {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

      {isOwner && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Add a backup Platform Admin</h3>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
            They must already have signed in to Bizzux at least once with this email. Platform Admins can manage the
            platform but can never create or remove other Platform Admins, and can never become Platform Owner.
          </p>
          <form onSubmit={createAdmin} className="row" style={{ gap: 10 }}>
            <input
              className="input" type="email" placeholder="teammate@bizzux.com" value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)} style={{ maxWidth: 320 }} required
            />
            <button className="btn-primary-sm" disabled={busy}>{busy ? "Adding…" : "Add Platform Admin"}</button>
          </form>
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Email</th><th>Role</th><th>Status</th><th>Added by</th><th></th></tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.uid}>
                <td>{a.email}</td>
                <td>{a.role === "OWNER" ? "Platform Owner" : "Platform Admin"}</td>
                <td><span className={"status-pill " + (a.status === "disabled" ? "expired" : "active")}>{a.status}</span></td>
                <td>{a.createdBy}</td>
                <td>
                  {isOwner && a.role !== "OWNER" && (
                    <button className="link-btn danger" onClick={() => toggle(a)} disabled={actingUid === a.uid}>
                      {actingUid === a.uid ? "Working…" : a.status === "disabled" ? "Reactivate" : "Disable"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TrialSettings() {
  const [trialDays, setTrialDays] = useState("");
  const [verifyEmail, setVerifyEmail] = useState(true);
  const [verifyMobile, setVerifyMobile] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [vmSaving, setVmSaving] = useState(false);
  const [vmMsg, setVmMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await api("/api/admin/settings", "GET");
        setTrialDays(String(d.trialDays ?? 14));
        setVerifyEmail(d.verifyEmail !== false);
        setVerifyMobile(d.verifyMobile === true);
      } catch {
        setTrialDays("14");
      }
      setLoaded(true);
    })();
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      await api("/api/admin/settings", "POST", { trialDays: Number(trialDays) });
      setMsg("Saved. Applies to new signups from now on.");
    } catch (err) {
      setMsg(err.message);
    }
    setSaving(false);
  }

  // Both checkboxes can be on at once — new signups then have to clear
  // BOTH gates (email first, then mobile) before reaching the dashboard.
  // At least one has to stay on, so unchecking the last one is blocked
  // client-side (the API also refuses it, as a backstop).
  async function toggle(which, next) {
    const nextEmail = which === "email" ? next : verifyEmail;
    const nextMobile = which === "mobile" ? next : verifyMobile;
    if (!nextEmail && !nextMobile) {
      setVmMsg("At least one verification method has to stay enabled.");
      return;
    }
    if (which === "email") setVerifyEmail(next);
    else setVerifyMobile(next);
    setVmSaving(true);
    setVmMsg("");
    try {
      await api("/api/admin/settings", "POST", { verifyEmail: nextEmail, verifyMobile: nextMobile });
      setVmMsg("Saved. New signups from now on will verify this way.");
    } catch (err) {
      setVmMsg(err.message);
    }
    setVmSaving(false);
  }

  if (!loaded) return <p className="muted">Loading…</p>;

  return (
    <>
      <div className="card" style={{ maxWidth: 420, marginBottom: 20 }}>
        <form onSubmit={save}>
          <label className="label">Trial length (days)</label>
          <input
            className="input" type="number" min="1" value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            style={{ marginBottom: 14 }}
            required
          />
          <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          {msg && <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>{msg}</p>}
        </form>
      </div>

      <div className="card" style={{ maxWidth: 420 }}>
        <label className="label" style={{ marginBottom: 4, display: "block" }}>Sign-up verification method</label>
        <p className="muted" style={{ fontSize: 11.5, marginBottom: 14 }}>
          How new signups confirm they own the email or phone number they gave us. Check both to require both.
          Google sign-ins are unaffected, since they're already verified.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: vmMsg ? 10 : 0 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: vmSaving ? "wait" : "pointer" }}>
            <input
              type="checkbox"
              checked={verifyEmail}
              disabled={vmSaving}
              onChange={(e) => toggle("email", e.target.checked)}
            />
            <span style={{ fontSize: 13 }}>Email: sends a verification link (via Resend)</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: vmSaving ? "wait" : "pointer" }}>
            <input
              type="checkbox"
              checked={verifyMobile}
              disabled={vmSaving}
              onChange={(e) => toggle("mobile", e.target.checked)}
            />
            <span style={{ fontSize: 13 }}>Mobile: sends an OTP by SMS (via MSG91)</span>
          </label>
        </div>
        {vmMsg && <p className="muted" style={{ fontSize: 13 }}>{vmMsg}</p>}
      </div>
    </>
  );
}

const emptyOffer = {
  code: "", scope: "plan", planId: "", appKey: "juicechatjunction", discountType: "percent", discountValue: "",
  duration: "forever", cyclesCount: "", expiresAt: "", maxRedemptions: "", active: true,
};

function discountLabel(o) {
  return o.discountType === "flat" ? `₹${o.discountValue} off` : `${o.discountValue}% off`;
}
function durationLabel(o) {
  if (o.duration === "once") return "first payment only";
  if (o.duration === "cycles") return `first ${o.cyclesCount} billing cycle${o.cyclesCount === 1 ? "" : "s"}`;
  return "for the life of the subscription";
}

// Not implemented via Razorpay's native "Offers" or Stripe's native
// "Coupons" — see app/api/checkout/route.js's comment for why (Razorpay
// Offers can only be created from their Dashboard, not via API). Redeeming
// a code instead auto-creates a discounted-price Plan/Price behind the
// scenes, same as the Plans tab above.
function OffersManager() {
  const [offers, setOffers] = useState(null);
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState(emptyOffer);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const [o, p] = await Promise.all([
        api("/api/admin/offers", "GET"),
        api("/api/admin/plans", "GET"),
      ]);
      setOffers(o.offers || []);
      setPlans(p.plans || []);
    } catch {
      setOffers([]);
    }
  }
  useEffect(() => { load(); }, []);

  function edit(o) {
    setEditingId(o.id);
    setForm({
      code: o.id, scope: o.scope || "plan", planId: o.planId || "", appKey: o.appKey || "juicechatjunction",
      discountType: o.discountType || "percent",
      discountValue: o.discountValue ?? "", duration: o.duration || "forever",
      cyclesCount: o.cyclesCount ?? "", expiresAt: o.expiresAt ? o.expiresAt.slice(0, 10) : "",
      maxRedemptions: o.maxRedemptions ?? "", active: o.active !== false,
    });
  }
  function resetForm() { setEditingId(null); setForm(emptyOffer); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const payload = {
        code: form.code, scope: form.scope,
        planId: form.scope === "plan" ? form.planId : undefined,
        appKey: form.scope === "app" ? form.appKey : undefined,
        discountType: form.discountType,
        discountValue: Number(form.discountValue), duration: form.duration,
        cyclesCount: form.duration === "cycles" ? Number(form.cyclesCount) : undefined,
        expiresAt: form.expiresAt || null,
        maxRedemptions: form.maxRedemptions === "" ? null : Number(form.maxRedemptions),
        active: !!form.active,
      };
      if (editingId) {
        await api("/api/admin/offers", "POST", { action: "update", id: editingId, ...payload });
      } else {
        await api("/api/admin/offers", "POST", { action: "create", ...payload });
      }
      resetForm();
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  }

  async function remove(id) {
    if (!confirm(`Delete offer code "${id}"?`)) return;
    try {
      await api("/api/admin/offers", "POST", { action: "delete", id });
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  if (offers === null) return <p className="muted">Loading…</p>;

  return (
    <div style={{ display: "grid", gap: 24, gridTemplateColumns: "1.1fr 1fr" }}>
      <div className="card">
        <h3 style={{ marginBottom: 14 }}>{editingId ? `Edit offer "${editingId}"` : "Add an offer"}</h3>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Code</label>
            <input
              className="input" value={form.code} disabled={!!editingId}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="LAUNCH20" required
            />
            {editingId && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>The code itself can&apos;t be changed once created. Delete and re-add if you need a different one.</p>}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Applies to</label>
            <select className="input" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
              <option value="plan">One specific plan</option>
              <option value="app">Any plan under one app</option>
              <option value="all">All apps, any plan</option>
            </select>
          </div>
          {form.scope === "plan" && (
            <div style={{ marginBottom: 12 }}>
              <label className="label">Plan</label>
              <select className="input" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })} required>
                <option value="" disabled>Select a plan</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name} (₹{p.price}/{p.billingPeriod})</option>)}
              </select>
            </div>
          )}
          {form.scope === "app" && (
            <div style={{ marginBottom: 12 }}>
              <label className="label">App</label>
              <select className="input" value={form.appKey} onChange={(e) => setForm({ ...form, appKey: e.target.value })} required>
                {APP_CATALOG.map((a) => <option key={a.key} value={a.key}>{a.icon} {a.name}</option>)}
              </select>
            </div>
          )}
          <div className="row" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Discount type</label>
              <select className="input" value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}>
                <option value="percent">Percent off</option>
                <option value="flat">Flat amount off (₹)</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">{form.discountType === "flat" ? "Amount (₹)" : "Percent"}</label>
              <input
                className="input" type="number" min="0" max={form.discountType === "percent" ? 100 : undefined}
                value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} required
              />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Duration</label>
            <select className="input" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })}>
              <option value="forever">Forever (lifetime of the subscription)</option>
              <option value="cycles">For a number of billing cycles</option>
              <option value="once">One-time, first payment only</option>
            </select>
          </div>
          {form.duration === "cycles" && (
            <div style={{ marginBottom: 12 }}>
              <label className="label">Number of billing cycles</label>
              <input className="input" type="number" min="1" value={form.cyclesCount} onChange={(e) => setForm({ ...form, cyclesCount: e.target.value })} required />
            </div>
          )}
          <div className="row" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Expires on (optional)</label>
              <input className="input" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Max redemptions (optional)</label>
              <input className="input" type="number" min="1" placeholder="Unlimited" value={form.maxRedemptions} onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })} />
            </div>
          </div>
          <div className="row" style={{ marginBottom: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active (redeemable at checkout)
            </label>
          </div>
          <div className="row">
            <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : editingId ? "Save changes" : "Add offer"}</button>
            {editingId && <button type="button" className="btn-outline-dark" onClick={resetForm}>Cancel</button>}
          </div>
          {err && <p className="error">{err}</p>}
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 14 }}>Existing offers</h3>
        {offers.length === 0 && <p className="muted">No offers yet.</p>}
        {offers.map((o) => {
          const plan = plans.find((p) => p.id === o.planId);
          const scope = o.scope || "plan";
          const app = APP_CATALOG.find((a) => a.key === o.appKey);
          const appliesTo =
            scope === "all" ? "all apps, any plan" :
            scope === "app" ? `any plan under ${app ? app.name : o.appKey}` :
            (plan ? plan.name : "(deleted plan)");
          return (
            <div key={o.id} style={{ borderBottom: "1px solid var(--line)", padding: "12px 0" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{o.id}</strong>
                {o.active === false && <span className="muted" style={{ fontSize: 12 }}>inactive</span>}
              </div>
              <p className="muted" style={{ margin: "4px 0", fontSize: 13 }}>
                {discountLabel(o)} on {appliesTo}, {durationLabel(o)}
              </p>
              <div className="row" style={{ gap: 12 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  Used {o.redemptionCount || 0}{o.maxRedemptions ? ` / ${o.maxRedemptions}` : ""}
                </span>
                {o.expiresAt && (
                  <span className="muted" style={{ fontSize: 12 }}>Expires {new Date(o.expiresAt).toLocaleDateString()}</span>
                )}
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="link-btn" onClick={() => edit(o)}>Edit</button>
                <button className="link-btn danger" onClick={() => remove(o.id)}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Small "⋯" more-actions menu — same pattern used in Bizzux Files.
// Matches the keys appUsage.<key> is stamped with (app-sso/route.js,
// shop-sso/route.js) to the display name shown in the Apps Used column.
const APP_USAGE_LABELS = {
  juicechatjunction: "Shop",
  notes: "Notes",
  files: "Files",
  projects: "Projects",
};

const DETAIL_TABS = [["account", "Account"], ["team", "Team"], ["activity", "Shop activity"]];

// The "click a user, see everything" panel — Account/Team/Shop activity
// tabs replace what used to be scattered across separate popups (View org
// admins, View Shop activity, Extend trial, Mark paid, Set password),
// modeled on how tools like Microsoft 365 admin center show one person's
// full picture in a single slide-over instead of a dropdown of one-off
// actions. Quick actions live inline per tab instead of a "⋯" menu.
function CustomerDetailPanel({ customer, isOwner, onClose, onChanged }) {
  const [tab, setTab] = useState("account");
  const [admins, setAdmins] = useState(null);
  const [activity, setActivity] = useState(null);
  const [activityErr, setActivityErr] = useState("");
  const [err, setErr] = useState("");
  const [busyUid, setBusyUid] = useState(null);
  const [showExtend, setShowExtend] = useState(false);
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [guestSeatsInput, setGuestSeatsInput] = useState(customer.guestSeats || 0);
  const [savingGuestSeats, setSavingGuestSeats] = useState(false);
  const [openingApp, setOpeningApp] = useState(null);
  const [showDelete, setShowDelete] = useState(false);
  const [showFree, setShowFree] = useState(false);
  const isFree = customer.billing === "complimentary";

  async function endFree() {
    if (!confirm("End this free license? They'll get 7 days of trial to choose a paid plan.")) return;
    try {
      await api("/api/admin/customers", "POST", { action: "endFree", id: customer.id });
      onChanged && onChanged();
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function loadAdmins() {
    try {
      const d = await api(`/api/admin/customers?id=${customer.id}`, "GET");
      setAdmins(d.admins || []);
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    loadAdmins();
    (async () => {
      try {
        setActivity(await api(`/api/admin/customer-activity?id=${customer.id}`, "GET"));
      } catch (e) {
        // Kept to the Shop activity tab. A Bizzux Business hiccup (e.g. a
        // missing Firestore index, whose raw message is a very long URL)
        // shouldn't cover the Account tab everyone lands on.
        console.error("Shop activity failed:", e);
        setActivityErr("Couldn't load Bizzux Business activity right now. Try again in a few minutes.");
      }
    })();
  }, [customer.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function revokeSessions(uid) {
    if (!confirm("Sign this person out of every device right now?")) return;
    setBusyUid(uid);
    try {
      await api("/api/admin/customers", "POST", { action: "revokeSessions", uid });
    } catch (e) {
      setErr(e.message);
    }
    setBusyUid(null);
  }

  async function toggleRequire2fa(uid, required) {
    setBusyUid(uid);
    try {
      await api("/api/admin/two-factor", "POST", { uid, required });
      await loadAdmins();
    } catch (e) {
      setErr(e.message);
    }
    setBusyUid(null);
  }

  async function toggleSuspend() {
    const suspending = customer.status !== "suspended";
    if (!confirm(suspending ? `Suspend ${customer.email}? They'll immediately lose access to every Bizzux app.` : `Reactivate ${customer.email}?`)) return;
    try {
      await api("/api/admin/customers", "POST", { action: suspending ? "suspend" : "reactivate", id: customer.id });
      onChanged && onChanged();
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function resetPasswordEmail() {
    if (!confirm(`Email a password reset link to ${customer.email}?`)) return;
    try {
      await api("/api/admin/customers", "POST", { action: "resetPassword", id: customer.id });
      alert("Reset email sent.");
    } catch (e) {
      setErr(e.message);
    }
  }

  async function openAsOrg(label, endpoint) {
    setOpeningApp(label);
    setErr("");
    try {
      const sep = endpoint.includes("?") ? "&" : "?";
      const d = await api(`${endpoint}${sep}asOrg=${customer.id}`, "GET");
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr(e.message);
    } finally {
      setOpeningApp(null);
    }
  }

  async function saveGuestSeats() {
    setSavingGuestSeats(true);
    try {
      await api("/api/admin/customers", "POST", { action: "setGuestSeats", id: customer.id, guestSeats: Number(guestSeatsInput) });
      onChanged && onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSavingGuestSeats(false);
    }
  }

  return (
    <>
      {showDelete && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setShowDelete(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: "100%" }}>
            <DeleteUserPanel
              initialEmail={customer.email}
              onDeleted={() => {
                onChanged && onChanged();
                onClose();
              }}
            />
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn-outline-dark" onClick={() => setShowDelete(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, width: "100%" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ marginBottom: 2 }}>{customer.organizationName || customer.email}</h2>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>{customer.email}</p>
            </div>
            <span className={"status-pill " + (customer.status === "suspended" ? "expired" : customer.status || "trial")}>
              {customer.status || "trial"}
            </span>
          </div>

          <div className="admin-tabs" role="tablist" style={{ marginTop: 14, marginBottom: 14 }}>
            {DETAIL_TABS.map(([id, label]) => (
              <button
                key={id} type="button" role="tab" aria-selected={tab === id}
                className={"admin-tab" + (tab === id ? " active" : "")}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {err && <p className="error" style={{ overflowWrap: "anywhere" }}>{err}</p>}

          {tab === "account" && (
            <div>
              <div className="row" style={{ gap: 22, flexWrap: "wrap", marginBottom: 16 }}>
                <div><div className="label">Plan</div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{customer.planName || "N/A"}</div></div>
                <div><div className="label">Signed up</div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{customer.createdAt ? new Date(customer.createdAt).toLocaleDateString() : "N/A"}</div></div>
                <div><div className="label">Last login</div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{timeAgo(customer.lastLoginAt)}</div></div>
                <div><div className="label">Trial ends</div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{customer.status === "trial_pending" ? "Not started (phone not verified)" : customer.trialEndDate ? new Date(customer.trialEndDate).toLocaleDateString() : "N/A"}</div></div>
                {customer.subscription && (
                  <div>
                    <div className="label">Locked-in price</div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                      {customer.subscription.quantity} user{customer.subscription.quantity === 1 ? "" : "s"} × ₹{Number(customer.subscription.unitPrice).toLocaleString("en-IN")} = ₹{Number(customer.subscription.totalPrice).toLocaleString("en-IN")}/{customer.subscription.billingCycle === "year" ? "year" : "month"}
                    </div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      Since {customer.subscription.agreedAt ? new Date(customer.subscription.agreedAt).toLocaleDateString() : "—"}
                      {customer.subscription.listUnitPrice !== customer.subscription.unitPrice ? ` · list ₹${customer.subscription.listUnitPrice}` : ""}
                      {customer.subscription.couponCode ? ` · code ${customer.subscription.couponCode}` : ""}
                    </div>
                  </div>
                )}
              </div>
              {/* Sales follow-up context, from the "Set up your Bizzux account"
                  onboarding wizard — why this trial exists and who to ask for
                  when calling, not operational account state like the row above. */}
              <div className="row" style={{ gap: 22, flexWrap: "wrap", marginBottom: 16 }}>
                <div><div className="label">Job title</div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{customer.jobTitle || "N/A"}</div></div>
                <div><div className="label">Using it for</div><div style={{ fontWeight: 700, fontSize: 13.5, textTransform: "capitalize" }}>{customer.useCase || "N/A"}</div></div>
                <div><div className="label">Employees</div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{customer.employeeCount || "N/A"}</div></div>
                <div><div className="label">Business type</div><div style={{ fontWeight: 700, fontSize: 13.5, textTransform: "capitalize" }}>{customer.businessType || "N/A"}</div></div>
              </div>
              {/* Grouped by what they do, so the panel reads as a set of
                  options rather than one long run of links. */}
              <div style={{ paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                <div className="label" style={{ marginBottom: 8 }}>Subscription</div>
                {isFree && (
                  <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 10, padding: 10, fontSize: 13, marginBottom: 10 }}>
                    <strong>Free license</strong> · {customer.planName || "plan"} · {freeReasonLabel(customer.compReason)} ·{" "}
                    {customer.compUntil ? "until " + new Date(customer.compUntil).toLocaleDateString() : "no end date"}
                    {customer.compNote && <div className="muted" style={{ marginTop: 4 }}>{customer.compNote}</div>}
                  </div>
                )}
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  {!isFree && <button className="btn-small" onClick={() => setShowExtend(true)}>Extend trial</button>}
                  <button className="btn-small" onClick={() => setShowMarkPaid(true)}>Mark as paid</button>
                  {isOwner && (
                    <button className="btn-small" onClick={() => setShowFree(true)}>{isFree ? "Change free license" : "Give free license"}</button>
                  )}
                  {isOwner && isFree && <button className="btn-small" onClick={endFree}>End free license</button>}
                </div>
              </div>

              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                <div className="label" style={{ marginBottom: 8 }}>Sign-in &amp; security</div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="btn-small" onClick={resetPasswordEmail}>Email a reset link</button>
                  <button className="btn-small" onClick={() => setShowSetPassword(true)}>Set new password</button>
                  <button className="btn-small" disabled={busyUid === customer.id} onClick={() => revokeSessions(customer.id)}>Sign out everywhere</button>
                </div>
              </div>

              <div style={{ marginTop: 18, padding: 14, border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 12 }}>
                <div className="label" style={{ marginBottom: 4, color: "var(--red)" }}>Danger zone</div>
                <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Suspend blocks every app right away and can be undone. Delete removes the user for good.
                </p>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="btn-small" style={{ borderColor: "#fca5a5", color: "var(--red)" }} onClick={toggleSuspend}>
                    {customer.status === "suspended" ? "Reactivate" : "Suspend"}
                  </button>
                  {isOwner && (
                    <button className="btn-small" style={{ background: "var(--red)", borderColor: "var(--red)", color: "#fff" }} onClick={() => setShowDelete(true)}>
                      Delete user…
                    </button>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                <div className="label" style={{ marginBottom: 6 }}>Open apps as this organization</div>
                <p className="muted" style={{ fontSize: 12, marginBottom: 8, maxWidth: 420 }}>
                  Opens the app exactly as this organization's owner sees it, for support/troubleshooting. Every open is recorded in Audit Logs.
                </p>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  {[
                    { label: "Business", endpoint: "/api/shop-sso" },
                    { label: "POS", endpoint: "/api/pos-sso" },
                    { label: "Notes", endpoint: "/api/app-sso?app=notes" },
                    { label: "Files", endpoint: "/api/app-sso?app=files" },
                    { label: "Projects", endpoint: "/api/app-sso?app=projects" },
                    { label: "Chat", endpoint: "/api/app-sso?app=chat" },
                  ].map((a) => (
                    <button
                      key={a.label} className="btn-small" disabled={openingApp === a.label}
                      onClick={() => openAsOrg(a.label, a.endpoint)}
                    >
                      {openingApp === a.label ? "Opening…" : a.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                <div className="label" style={{ marginBottom: 6 }}>Bizzux Projects guest seats</div>
                <p className="muted" style={{ fontSize: 12, marginBottom: 8, maxWidth: 420 }}>
                  How many outside collaborators this org can have accepted across all its projects — 0 by default. Someone they invite can't accept until a seat is available here.
                </p>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    type="number" min="0" step="1" className="input" style={{ width: 90 }}
                    value={guestSeatsInput}
                    onChange={(e) => setGuestSeatsInput(e.target.value)}
                  />
                  <button className="btn-small" disabled={savingGuestSeats} onClick={saveGuestSeats}>
                    {savingGuestSeats ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "team" && (
            <div>
              {admins === null && <p className="muted">Loading…</p>}
              {admins && admins.map((a, i) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13.5 }}>{a.email}</span>
                    <span className="status-pill active">{a.role}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }} title={a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : ""}>
                    Last login: {timeAgo(a.lastLoginAt)} · 2FA: {a.twoFactorEnabled ? "on" : "off"}
                  </div>
                  {a.uid && (
                    <div className="row" style={{ gap: 14, marginTop: 6, flexWrap: "wrap" }}>
                      <button className="link-btn" disabled={busyUid === a.uid} onClick={() => revokeSessions(a.uid)}>Sign out of all devices</button>
                      <label className="muted" style={{ fontSize: 12 }}>
                        <input
                          type="checkbox" checked={!!a.twoFactorRequired} disabled={busyUid === a.uid}
                          onChange={(e) => toggleRequire2fa(a.uid, e.target.checked)} style={{ marginRight: 6 }}
                        />
                        Require 2FA
                      </label>
                    </div>
                  )}
                </div>
              ))}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                <AddTeamMemberForm accountId={customer.id} onDone={loadAdmins} />
              </div>
            </div>
          )}

          {tab === "activity" && (
            <div>
              {activityErr && <p className="error">{activityErr}</p>}
              {!activity && !activityErr && <p className="muted">Loading…</p>}
              {activity && (
                <>
                  <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 12.5 }}>
                    Usage only — sales/purchase/expense amounts are never shown here.
                  </p>
                  <ActivityRow label="🧾 Sales" data={activity.sales} />
                  <ActivityRow label="🛒 Purchases" data={activity.purchases} />
                  <ActivityRow label="🧺 Expenses" data={activity.expenses} />
                  <div className="row" style={{ marginTop: 14, gap: 6, flexWrap: "wrap" }}>
                    {[["Menu", activity.usesMenu], ["Inventory", activity.usesInventory], ["Reservations", activity.usesReservations], ["CapEx", activity.usesCapex]].map(([label, used]) => (
                      <span key={label} className={"status-pill " + (used ? "active" : "")} style={!used ? { opacity: 0.5 } : undefined}>
                        {used ? "✓" : "—"} {label}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn-outline-dark" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      {showExtend && (
        <ExtendTrialModal customer={customer} onClose={() => setShowExtend(false)} onExtended={async () => { setShowExtend(false); onChanged && onChanged(); }} />
      )}
      {showMarkPaid && (
        <MarkPaidModal customer={customer} onClose={() => setShowMarkPaid(false)} onMarked={async () => { setShowMarkPaid(false); onChanged && onChanged(); }} />
      )}
      {showFree && (
        <FreeLicenseModal
          customer={customer} onClose={() => setShowFree(false)}
          onDone={() => { setShowFree(false); onChanged && onChanged(); onClose(); }}
        />
      )}
      {showSetPassword && (
        <SetPasswordModal customer={customer} onClose={() => setShowSetPassword(false)} />
      )}
    </>
  );
}

function CustomersList({ isOwner }) {
  const [customers, setCustomers] = useState(null);
  const [viewingDetail, setViewingDetail] = useState(null); // customer row, or null
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    try {
      const d = await api("/api/admin/customers", "GET");
      setCustomers(d.customers || []);
    } catch {
      setCustomers([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (customers === null) return <p className="muted">Loading…</p>;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? customers.filter((c) =>
        [c.organizationName, c.fullName, c.email, c.phone].some((v) => v && v.toLowerCase().includes(q))
      )
    : customers;

  return (
    <div className="card">
      {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}
      <input
        type="text"
        className="input"
        placeholder="Search by organization, owner, email or mobile…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 14, maxWidth: 360 }}
      />
      {customers.length === 0 && <p className="muted">No signups yet.</p>}
      {customers.length > 0 && filtered.length === 0 && <p className="muted">No customers match "{search}".</p>}
      {filtered.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Organization</th><th>Owner</th><th>Email</th><th>Mobile</th><th>Location</th>
                <th>Signed up</th><th>Customer for</th><th>Last login</th><th>Status</th><th>Type</th><th>Plan</th><th>Apps used</th><th>Trial ends</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const usedKeys = Object.keys(c.appUsage || {});
                return (
                <tr key={c.id}>
                  <td>
                    <button type="button" className="link-btn" style={{ textAlign: "left" }} onClick={() => setViewingDetail(c)}>
                      {c.organizationName || c.email}
                    </button>
                  </td>
                  <td>{c.fullName || "N/A"}</td>
                  <td>{c.email}</td>
                  <td>{c.phone || "N/A"}</td>
                  <td>
                    {c.city || c.region ? (
                      <>
                        <div>{[c.city, c.region].filter(Boolean).join(", ")}</div>
                        {c.country && <div className="muted" style={{ fontSize: 11.5 }}>{c.country}</div>}
                      </>
                    ) : (
                      c.country || "N/A"
                    )}
                  </td>
                  <td>{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "N/A"}</td>
                  <td title={c.createdAt ? new Date(c.createdAt).toLocaleString() : ""}>{c.createdAt ? timeAgo(c.createdAt) : "N/A"}</td>
                  <td title={c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleString() : ""}>{timeAgo(c.lastLoginAt)}</td>
                  <td>
                    {c.billing === "complimentary" ? (
                      <span className="status-pill active" style={{ background: "#ecfdf5", color: "#047857" }}>free</span>
                    ) : (
                      <span className={"status-pill " + (c.status === "suspended" || c.status === "closed" ? "expired" : c.status || "trial")}>{c.status || "trial"}</span>
                    )}
                  </td>
                  <td>{c.customerType}</td>
                  <td>{c.planName || "N/A"}</td>
                  <td>
                    {usedKeys.length === 0 ? (
                      <span className="muted" style={{ fontSize: 12 }}>Not used yet</span>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {usedKeys.map((k) => (
                          <span key={k} className="status-pill active" style={{ fontSize: 11 }}>
                            {APP_USAGE_LABELS[k] || k}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{c.trialEndDate ? new Date(c.trialEndDate).toLocaleDateString() : "N/A"}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewingDetail && (
        <CustomerDetailPanel customer={viewingDetail} isOwner={isOwner} onClose={() => setViewingDetail(null)} onChanged={load} />
      )}
    </div>
  );
}

// Usage/engagement visibility ONLY — never the customer's actual sales,
// purchase or expense amounts. See app/api/admin/customer-activity/route.js
// and bizzux-shop's app/api/admin/activity/route.js for why: this answers
// "is this customer actually using Shop, and for what" for churn-risk and
// product-usage purposes, without the trust/privacy cost of Bizzux staff
// reading a customer's real financial data.
function ActivityRow({ label, data }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontSize: 13.5 }}>{label}</span>
      <span className="muted" style={{ fontSize: 13, textAlign: "right" }}>
        {data.lastAt ? timeAgo(data.lastAt) : "Never"} · {data.last30Days} in last 30 days
      </span>
    </div>
  );
}

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// Reset, never reveal — Firebase Auth (like every real system) never
// stores a password in a form that could be shown back to an admin, only
// an irreversible hash. This is the actual answer to "customer forgot
// their password": set a new one (typed or generated) and hand it over,
// same as AWS/Google Workspace/GitHub all do it.
function SetPasswordModal({ customer, onClose }) {
  const [password, setPasswordValue] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const d = await api("/api/admin/customers", "POST", {
        action: "setPassword", id: customer.id, password: password.trim(), mustChangePassword,
      });
      setResult(d.password);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h2 style={{ marginBottom: 4 }}>Set new password</h2>
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>{customer.email}</p>

        {result ? (
          <div style={{ background: "var(--line, #f1f5f9)", borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 13 }}>Password set — save this now, shown only once:</p>
            <p style={{ margin: 0, fontFamily: "monospace", fontSize: 13 }}>{result}</p>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 10 }}>
              <label className="label">New password</label>
              <div className="row" style={{ gap: 6 }}>
                <input
                  className="input" type={showPassword ? "text" : "password"} value={password}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  placeholder="Leave blank to auto-generate" style={{ flex: 1 }}
                />
                <button type="button" className="link-btn" onClick={() => setPasswordValue(genPassword())}>Generate</button>
              </div>
              {password && (
                <label className="muted" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
                  <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} style={{ marginRight: 6 }} />
                  Show password
                </label>
              )}
              <label className="muted" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
                <input type="checkbox" checked={mustChangePassword} onChange={(e) => setMustChangePassword(e.target.checked)} style={{ marginRight: 6 }} />
                Require them to set their own password on next login
              </label>
            </div>
            {error && <p className="error">{error}</p>}
          </>
        )}

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
          <button className="btn-outline-dark" onClick={onClose}>{result ? "Close" : "Cancel"}</button>
          {!result && <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Set password"}</button>}
        </div>
      </div>
    </div>
  );
}

const TEAM_PROFILES = ["Global Admin", "Admin", "Manager", "Staff/Shopkeeper", "Viewer/Auditor"];

// Adds a team member directly to this org — for a non-technical owner who
// can't be expected to run their own /team invite flow, or has no
// teammate with a real, reliably-checked email address. Same
// "admin sets a username/password, hands it over" pattern as Create
// Business Login (OrganizationsManager.jsx), just targeting an EXISTING
// account instead of provisioning a new one. See "createTeamMember" in
// app/api/admin/organizations/route.js.
function AddTeamMemberForm({ accountId, onDone }) {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [profile, setProfile] = useState("Manager");
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await api("/api/admin/organizations", "POST", {
        action: "createTeamMember", accountId, firstName, email, password, profile, mustChangePassword,
      });
      setCreated({ email: d.email, password: d.password });
      setFirstName(""); setEmail(""); setPassword("");
      onDone && onDone();
    } catch (e2) {
      setError(e2.message);
    }
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 4 }}>
      {created && (
        <div style={{ background: "var(--line, #f1f5f9)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 12.5 }}>Login created — save now, shown only once:</p>
          <p style={{ margin: "0 0 2px", fontFamily: "monospace", fontSize: 12.5 }}>Username: {created.email}</p>
          <p style={{ margin: 0, fontFamily: "monospace", fontSize: 12.5 }}>Password: {created.password}</p>
        </div>
      )}
      <form onSubmit={submit}>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <input className="input" style={{ flex: 1 }} placeholder="Name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          <select className="input" style={{ flex: 1 }} value={profile} onChange={(e) => setProfile(e.target.value)}>
            {TEAM_PROFILES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="row" style={{ gap: 8, marginBottom: 4 }}>
          <input className="input" style={{ flex: 1 }} placeholder="username@bizzux.login" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input
            className="input" style={{ flex: 1 }} type={showPassword ? "text" : "password"}
            placeholder="Leave blank to auto-generate" value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {password && (
          <label className="muted" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} style={{ marginRight: 6 }} />
            Show password
          </label>
        )}
        <label className="muted" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
          <input type="checkbox" checked={mustChangePassword} onChange={(e) => setMustChangePassword(e.target.checked)} style={{ marginRight: 6 }} />
          Require them to set their own password on first login
        </label>
        {error && <p className="error" style={{ fontSize: 12.5 }}>{error}</p>}
        <button className="btn-small" disabled={busy}>{busy ? "Creating…" : "+ Create login"}</button>
      </form>
    </div>
  );
}

const TRIAL_UNITS = [
  { value: "days", label: "Day(s)" },
  { value: "weeks", label: "Week(s)" },
  { value: "months", label: "Month(s)" },
  { value: "years", label: "Year(s)" },
];

function ExtendTrialModal({ customer, onClose, onExtended }) {
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState("weeks");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!(amount > 0)) {
      setError("Enter a positive amount");
      return;
    }
    setBusy(true);
    try {
      await api("/api/admin/customers", "POST", { action: "extendTrial", id: customer.id, amount: Number(amount), unit });
      onExtended();
    } catch (e2) {
      setError(e2.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 4 }}>Extend trial</h2>
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
          {customer.email} — currently ends {customer.trialEndDate ? new Date(customer.trialEndDate).toLocaleDateString() : "N/A"}
        </p>
        <form onSubmit={submit} noValidate>
          <div className="row" style={{ gap: 10, marginBottom: 16 }}>
            <input
              className="input"
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ width: 90 }}
              autoFocus
            />
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
              {TRIAL_UNITS.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
            Extends from today if the trial already ended, or adds on top of the current end date if it hasn't.
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? "Extending…" : "Extend"}</button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}

// Records a payment taken outside checkout (cash handed to the shop
// owner, bank transfer, etc.) — sets this account to "active" on the
// chosen plan exactly like a real Razorpay/Stripe charge would (see
// "markPaid" in app/api/admin/customers/route.js), so there's no separate
// "was this ever actually paid" bookkeeping to reconcile later.
const FREE_REASONS = [
  { value: "internal", label: "Our own business" },
  { value: "family", label: "Family & friends" },
  { value: "tester", label: "Tester" },
  { value: "partner", label: "Partner" },
  { value: "other", label: "Other" },
];
const freeReasonLabel = (v) => FREE_REASONS.find((r) => r.value === v)?.label || "Free";

// Shared plan/cycle/users picker for Free license and Mark as paid. Options
// come from /api/admin/plans's purchaseOptions (published Bizzux App per
// app, and Bizzux Suite), so these always match live pricing.
function usePurchaseOptions(defaultToSuite) {
  const [options, setOptions] = useState(null);
  const [optionId, setOptionId] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const d = await api("/api/admin/plans", "GET");
        const list = d.purchaseOptions || [];
        setOptions(list);
        const suite = list.find((o) => !o.appKey);
        if (list.length) setOptionId((defaultToSuite && suite ? suite : list[0]).id);
      } catch (e) {
        setErr(e.message);
        setOptions([]);
      }
    })();
  }, [defaultToSuite]);
  return { options, optionId, setOptionId, err };
}

function PlanPicker({ options, optionId, setOptionId, cycle, setCycle, users, setUsers, showPrice }) {
  const opt = options?.find((o) => o.id === optionId);
  if (options === null) return <p className="muted">Loading plans…</p>;
  if (!options.length) return <p className="error">No plans are on sale. Check Billing &amp; Pricing first.</p>;
  return (
    <>
      <label className="label">Plan</label>
      <select className="input" value={optionId} onChange={(e) => setOptionId(e.target.value)} style={{ marginBottom: 12 }}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}{showPrice ? ` (₹${o.monthly}/mo · ₹${o.annual}/yr per user)` : ""}</option>
        ))}
      </select>
      <div className="row" style={{ marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Billing</label>
          <select className="input" value={cycle} onChange={(e) => setCycle(e.target.value)}>
            <option value="month">Monthly</option>
            <option value="year">Annual</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Users</label>
          <input className="input" type="number" min="1" value={users} onChange={(e) => setUsers(e.target.value)} />
        </div>
      </div>
      {showPrice && opt && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: -4, marginBottom: 12 }}>
          Published price: {Number(users) || 1} × ₹{(cycle === "year" ? opt.annual : opt.monthly).toLocaleString("en-IN")} ={" "}
          <strong>₹{((Number(users) || 1) * (cycle === "year" ? opt.annual : opt.monthly)).toLocaleString("en-IN")}/{cycle === "year" ? "year" : "month"}</strong>
        </p>
      )}
    </>
  );
}

// Platform Owner -> give a business a free license: a real plan (App or
// Suite) that's never charged and doesn't count as revenue. See the
// grantFree action in app/api/admin/customers/route.js.
function FreeLicenseModal({ customer, onClose, onDone }) {
  const { options, optionId, setOptionId, err: loadErr } = usePurchaseOptions(true);
  const [cycle, setCycle] = useState("year");
  const [users, setUsers] = useState(5);
  const [reason, setReason] = useState("internal");
  const [hasEnd, setHasEnd] = useState(false);
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!optionId) return setErr("Choose a plan");
    if (hasEnd && !until) return setErr("Pick an end date, or choose No end date");
    setBusy(true);
    setErr("");
    try {
      await api("/api/admin/customers", "POST", {
        action: "grantFree", id: customer.id, planId: optionId, billingCycle: cycle, quantity: Number(users) || 1, reason,
        until: hasEnd ? new Date(until + "T23:59:59").toISOString() : null, note,
      });
      onDone();
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, width: "100%" }}>
        <h2 style={{ marginBottom: 4 }}>Give a free license</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          <strong>{customer.organizationName || customer.email}</strong> gets the chosen plan at no charge. It isn't
          counted as revenue.
        </p>
        <form onSubmit={submit} noValidate>
          <PlanPicker options={options} optionId={optionId} setOptionId={setOptionId} cycle={cycle} setCycle={setCycle} users={users} setUsers={setUsers} />

          <label className="label">Why is it free?</label>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {FREE_REASONS.map((r) => (
              <button
                key={r.value} type="button" onClick={() => setReason(r.value)} aria-pressed={reason === r.value}
                className={reason === r.value ? "btn-primary-sm" : "btn-small"}
              >
                {r.label}
              </button>
            ))}
          </div>

          <label className="label">How long?</label>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <button type="button" className={!hasEnd ? "btn-primary-sm" : "btn-small"} onClick={() => setHasEnd(false)} aria-pressed={!hasEnd}>
              No end date
            </button>
            <button type="button" className={hasEnd ? "btn-primary-sm" : "btn-small"} onClick={() => setHasEnd(true)} aria-pressed={hasEnd}>
              Until a date
            </button>
            {hasEnd && (
              <input type="date" className="input" min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} style={{ width: 170 }} />
            )}
          </div>

          <label className="label">Note (optional)</label>
          <input
            className="input" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Brother's shop, testing POS" style={{ marginBottom: 16 }}
          />

          {(err || loadErr) && <p className="error">{err || loadErr}</p>}
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn-outline-dark" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn-primary" disabled={busy || !options?.length}>{busy ? "Saving…" : "Give free license"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MarkPaidModal({ customer, onClose, onMarked }) {
  const { options, optionId, setOptionId, err: loadErr } = usePurchaseOptions(false);
  const [cycle, setCycle] = useState("month");
  const [users, setUsers] = useState(1);
  const [unitPrice, setUnitPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!optionId) {
      setError("Choose a plan");
      return;
    }
    setBusy(true);
    try {
      await api("/api/admin/customers", "POST", {
        action: "markPaid", id: customer.id, planId: optionId, billingCycle: cycle, quantity: Number(users) || 1,
        unitPrice: unitPrice === "" ? undefined : Number(unitPrice), notes,
      });
      onMarked();
    } catch (e2) {
      setError(e2.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 4 }}>Mark as paid</h2>
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
          {customer.email} — for a payment collected outside checkout (cash, bank transfer, etc.).
          This activates the account on the plan below and locks in the price per user.
        </p>
        <form onSubmit={submit} noValidate>
          <PlanPicker options={options} optionId={optionId} setOptionId={setOptionId} cycle={cycle} setCycle={setCycle} users={users} setUsers={setUsers} showPrice />
          <div style={{ marginBottom: 12 }}>
            <label className="label">Agreed price per user (optional)</label>
            <input className="input" type="number" min="0" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="Leave blank to use the published price" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label className="label">Notes (optional)</label>
            <input
              className="input" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cash collected by field agent, receipt #1234"
            />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy || !options?.length}>{busy ? "Saving…" : "Mark as paid"}</button>
          </div>
          {(error || loadErr) && <p className="error">{error || loadErr}</p>}
        </form>
      </div>
    </div>
  );
}

function statusPillClass(status) {
  if (status === "approved") return "active";
  if (status === "pending") return "trial";
  return "cancelled"; // rejected / suspended
}

function money(n) {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}

// "3 days ago" / "2 months ago" — used for Last login, which matters more
// as a consumption signal (is this account actually being used?) than the
// exact timestamp, hence the relative phrasing with the real date only on
// hover (see the `title` attribute wherever this is rendered).
function timeAgo(iso) {
  if (!iso) return "Never logged in";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

// Super Admin -> Partners. The two percentages at the top (app/api/admin/
// resellers/route.js's "saveSettings" action) are the SAME number applied
// to every Partner's referral code — unlike the Offers tab above, an
// individual Partner doesn't get their own custom discount. Applications
// come in from the public Partners page (app/(marketing)/partners) via
// app/api/reseller/apply/route.js and land here as "pending" until
// approved or rejected; approving is what flips their referral code live.
function ResellersManager() {
  const [resellers, setResellers] = useState(null);
  const [discountPercent, setDiscountPercent] = useState("");
  const [commissionPercent, setCommissionPercent] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null); // reseller row awaiting confirm, or null
  const [viewing, setViewing] = useState(null); // reseller row whose codes/commissions are shown, or null
  const [editingRates, setEditingRates] = useState(null); // reseller row being given a per-partner rate override, or null

  async function load() {
    try {
      const d = await api("/api/admin/resellers", "GET");
      setResellers(d.resellers || []);
      setDiscountPercent(String(d.resellerDiscountPercent));
      setCommissionPercent(String(d.resellerCommissionPercent));
    } catch {
      setResellers([]);
    }
  }
  useEffect(() => { load(); }, []);

  async function saveSettings(e) {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsMsg("");
    try {
      await api("/api/admin/resellers", "POST", {
        action: "saveSettings",
        resellerDiscountPercent: Number(discountPercent),
        resellerCommissionPercent: Number(commissionPercent),
      });
      setSettingsMsg("Saved.");
    } catch (e2) {
      setSettingsMsg(e2.message);
    }
    setSavingSettings(false);
  }

  async function act(action, id) {
    setBusyId(id);
    setErr("");
    try {
      await api("/api/admin/resellers", "POST", { action, id });
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusyId(null);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await act("delete", id);
  }

  if (resellers === null) return <p className="muted">Loading…</p>;

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div className="card" style={{ maxWidth: 460 }}>
        <h3 style={{ marginBottom: 4 }}>Referral discount and commission</h3>
        <p className="muted" style={{ fontSize: 11.5, marginBottom: 14 }}>
          Applies to every Partner's referral code. A referred customer's discount and the Partner's commission
          both apply once, on that customer's first successful payment.
        </p>
        <form onSubmit={saveSettings}>
          <div className="row" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Customer discount (%)</label>
              <input
                className="input" type="number" min="1" max="100"
                value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} required
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Partner commission (%)</label>
              <input
                className="input" type="number" min="1" max="100"
                value={commissionPercent} onChange={(e) => setCommissionPercent(e.target.value)} required
              />
            </div>
          </div>
          <button className="btn-primary" disabled={savingSettings}>{savingSettings ? "Saving…" : "Save"}</button>
          {settingsMsg && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{settingsMsg}</p>}
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 14 }}>Partners</h3>
        {resellers.length === 0 && <p className="muted">No applications yet.</p>}
        {resellers.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th><th>Email</th><th>Phone</th><th>Business</th><th>Code</th>
                  <th>Rates (comm% / disc%)</th><th>Codes gen/used</th>
                  <th>Status</th><th>Referrals</th><th>Total earned</th><th>Pending payout</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {resellers.map((r) => (
                  <tr key={r.id}>
                    <td>{r.fullName}</td>
                    <td>{r.email}</td>
                    <td>{r.phone || "N/A"}</td>
                    <td>{r.businessName || "N/A"}</td>
                    <td><code>{r.referralCode}</code></td>
                    <td>
                      {r.commissionPercent ?? "—"} / {r.customerDiscountPercent ?? "—"}
                      <button className="link-btn" style={{ marginLeft: 6 }} onClick={() => setEditingRates(r)}>Edit</button>
                    </td>
                    <td>{r.codesGenerated || 0} / {r.codesUsed || 0}</td>
                    <td><span className={"status-pill " + statusPillClass(r.status)}>{r.status}</span></td>
                    <td>{r.totalReferrals || 0}</td>
                    <td>{money(r.totalEarnings)}</td>
                    <td>{money(r.pendingPayout)}</td>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        {r.status === "pending" && (
                          <>
                            <button className="link-btn" disabled={busyId === r.id} onClick={() => act("approve", r.id)}>Approve</button>
                            <button className="link-btn danger" disabled={busyId === r.id} onClick={() => act("reject", r.id)}>Reject</button>
                          </>
                        )}
                        {r.status === "approved" && (
                          <button className="link-btn danger" disabled={busyId === r.id} onClick={() => act("suspend", r.id)}>Suspend</button>
                        )}
                        {(r.status === "suspended" || r.status === "rejected") && (
                          <button className="link-btn" disabled={busyId === r.id} onClick={() => act("approve", r.id)}>Approve</button>
                        )}
                        {r.pendingPayout > 0 && (
                          <button className="link-btn" disabled={busyId === r.id} onClick={() => act("markPaid", r.id)}>Mark paid</button>
                        )}
                        <button className="link-btn" disabled={busyId === r.id} onClick={() => setViewing(r)}>View sales</button>
                        <button className="link-btn danger" disabled={busyId === r.id} onClick={() => setPendingDelete(r)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {err && <p className="error">{err}</p>}
      </div>

      {pendingDelete && (
        <div className="modal-overlay" onClick={() => setPendingDelete(null)}>
          <div className="modal" style={{ textAlign: "center", maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                width: 56, height: 56, borderRadius: "50%", margin: "0 auto 16px",
                background: "#fef2f2", color: "var(--red)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <IconTrash className="w-6 h-6" />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Delete this Partner?</h2>
            <p className="muted" style={{ marginBottom: 24, lineHeight: 1.55 }}>
              This removes <strong>{pendingDelete.fullName}</strong>&apos;s application and deactivates their
              referral code <code>{pendingDelete.referralCode}</code> for good. They&apos;ll see the initial
              application form if they visit the Partners page again.
            </p>
            <div className="row" style={{ gap: 10, justifyContent: "center" }}>
              <button className="btn-outline-dark" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="btn-danger" disabled={busyId === pendingDelete.id} onClick={confirmDelete}>
                {busyId === pendingDelete.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingRates && (
        <PartnerRatesModal
          reseller={editingRates}
          onClose={() => setEditingRates(null)}
          onSaved={async () => { setEditingRates(null); await load(); }}
        />
      )}

      {viewing && (
        <PartnerSalesModal reseller={viewing} onClose={() => setViewing(null)} onChanged={load} />
      )}
    </div>
  );
}

// Per-partner override of the two global percentages (see resolvePartnerRates
// in lib/referral.js) — leaving a field blank clears the override and falls
// back to the global default shown in the card above.
function PartnerRatesModal({ reseller, onClose, onSaved }) {
  const [commissionPercent, setCommissionPercent] = useState(reseller.commissionPercent != null ? String(reseller.commissionPercent) : "");
  const [customerDiscountPercent, setCustomerDiscountPercent] = useState(reseller.customerDiscountPercent != null ? String(reseller.customerDiscountPercent) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/resellers", "POST", {
        action: "setPartnerRates",
        id: reseller.id,
        commissionPercent: commissionPercent.trim() === "" ? null : Number(commissionPercent),
        customerDiscountPercent: customerDiscountPercent.trim() === "" ? null : Number(customerDiscountPercent),
      });
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 4 }}>{reseller.fullName}&apos;s rates</h2>
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
          Leave a field blank to use the global default instead.
        </p>
        <div className="row" style={{ marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label className="label">Commission (%)</label>
            <input
              className="input" type="number" min="1" max="100"
              placeholder="Global default"
              value={commissionPercent} onChange={(e) => setCommissionPercent(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label className="label">Customer discount (%)</label>
            <input
              className="input" type="number" min="1" max="100"
              placeholder="Global default"
              value={customerDiscountPercent} onChange={(e) => setCustomerDiscountPercent(e.target.value)}
            />
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn-outline-dark" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </div>
        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      </div>
    </div>
  );
}

// One partner's promo codes and full commission ledger — "view sales
// attributed to each partner" + "view/approve/reverse commissions" from
// the Admin dashboard spec.
function PartnerSalesModal({ reseller, onClose, onChanged }) {
  const [data, setData] = useState(null); // { codes, commissions }
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  async function load() {
    try {
      const d = await api(`/api/admin/resellers?resellerId=${reseller.id}`, "GET");
      setData(d);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function act(action, commissionId) {
    setBusyId(commissionId);
    setError("");
    try {
      await api("/api/admin/resellers", "POST", { action, commissionId });
      await load();
      onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusyId(null);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 720, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 4 }}>{reseller.fullName} — sales &amp; commissions</h2>
        {error && <p className="error" style={{ marginBottom: 10 }}>{error}</p>}
        {!data && <p className="muted">Loading…</p>}
        {data && (
          <>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Promo codes ({data.codes.length})</h3>
            <div style={{ overflowX: "auto", marginBottom: 20, maxHeight: 180, overflowY: "auto" }}>
              <table className="table">
                <thead><tr><th>Code</th><th>Discount</th><th>Status</th><th>Created</th><th>Used</th></tr></thead>
                <tbody>
                  {data.codes.length === 0 && <tr><td colSpan={5} className="muted">No codes generated yet.</td></tr>}
                  {data.codes.map((c) => (
                    <tr key={c.code}>
                      <td><code>{c.code}</code></td>
                      <td>{c.discountPercent}%</td>
                      <td>{c.used ? "Used" : "Unused"}</td>
                      <td>{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}</td>
                      <td>{c.usedAt ? new Date(c.usedAt).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Commissions ({data.commissions.length})</h3>
            <div style={{ overflowX: "auto", maxHeight: 240, overflowY: "auto" }}>
              <table className="table">
                <thead><tr><th>Sale</th><th>Comm %</th><th>Commission</th><th>Code</th><th>Status</th><th>Date</th><th></th></tr></thead>
                <tbody>
                  {data.commissions.length === 0 && <tr><td colSpan={7} className="muted">No sales yet.</td></tr>}
                  {data.commissions.map((c) => (
                    <tr key={c.id}>
                      <td>{c.currency === "USD" ? "$" : "₹"}{c.saleAmount}</td>
                      <td>{c.commissionPercent}%</td>
                      <td>{c.currency === "USD" ? "$" : "₹"}{c.commissionAmount}</td>
                      <td>{c.promoCode ? <code>{c.promoCode}</code> : "—"}</td>
                      <td><span className={"status-pill " + statusPillClass(c.status === "paid" || c.status === "approved" ? "approved" : c.status === "reversed" ? "rejected" : "pending")}>{c.status}</span></td>
                      <td>{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          {c.status === "pending" && (
                            <button className="link-btn" disabled={busyId === c.id} onClick={() => act("approveCommission", c.id)}>Approve</button>
                          )}
                          {c.status !== "reversed" && (
                            <button className="link-btn danger" disabled={busyId === c.id} onClick={() => act("reverseCommission", c.id)}>Reverse</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: 14, margin: "20px 0 8px" }}>Payout history ({data.payouts.length})</h3>
            <div style={{ overflowX: "auto", maxHeight: 140, overflowY: "auto" }}>
              <table className="table">
                <thead><tr><th>Amount</th><th>Date</th></tr></thead>
                <tbody>
                  {data.payouts.length === 0 && <tr><td colSpan={2} className="muted">No payouts recorded yet.</td></tr>}
                  {data.payouts.map((p) => (
                    <tr key={p.id}>
                      <td>{money(p.amount)}</td>
                      <td>{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn-outline-dark" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

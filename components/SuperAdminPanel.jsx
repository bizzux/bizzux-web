"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Link from "next/link";
import OrganizationsManager from "@/components/OrganizationsManager";
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
  { id: "plans", label: "Plans & Pricing" },
  { id: "planlimits", label: "Plan Limits" },
  { id: "planapps", label: "Products / Modules" },
  { id: "offers", label: "Offers" },
  { id: "resellers", label: "Partners" },
  { id: "trial", label: "Platform Configuration" },
  { id: "platformadmins", label: "Platform Admins" },
  { id: "auditlogs", label: "Audit Logs" },
  { id: "security", label: "Security Settings" },
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
        {TABS.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={tab === t.id}
            className={"admin-tab" + (tab === t.id ? " active" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <PlatformDashboard />}
      {tab === "business" && <BusinessHealthPanel isOwner={platformRole === "OWNER"} />}
      {tab === "trial" && <TrialSettings />}
      {tab === "plans" && <PlansManager />}
      {tab === "planlimits" && <PlanLimitsManager />}
      {tab === "planapps" && <PlanAppsManager />}
      {tab === "offers" && <OffersManager />}
      {tab === "resellers" && <ResellersManager />}
      {tab === "customers" && <CustomersList />}
      {tab === "organizations" && <OrganizationsManager />}
      {tab === "platformadmins" && <PlatformAdminsManager isOwner={platformRole === "OWNER"} />}
      {tab === "auditlogs" && <AuditLogsPanel />}
      {tab === "security" && <SecuritySettingsPanel />}
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

function PlatformDashboard() {
  const [customers, setCustomers] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api("/api/admin/customers", "GET");
        setCustomers(d.customers || []);
      } catch {
        setCustomers([]);
      }
    })();
  }, []);

  if (customers === null) return <p className="muted">Loading…</p>;

  const counts = { trial: 0, active: 0, suspended: 0, other: 0 };
  customers.forEach((c) => {
    const s = c.status || "trial";
    if (counts[s] !== undefined) counts[s]++;
    else counts.other++;
  });
  const soon = customers.filter((c) => {
    if ((c.status || "trial") !== "trial" || !c.trialEndDate) return false;
    const days = Math.ceil((new Date(c.trialEndDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 3;
  }).length;

  const cards = [
    { label: "Organizations", value: customers.length },
    { label: "Active subscriptions", value: counts.active },
    { label: "On trial", value: counts.trial },
    { label: "Trial ending in 3 days", value: soon },
    { label: "Suspended", value: counts.suspended },
  ];

  return (
    <div className="proj-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
      {cards.map((c) => (
        <div key={c.label} className="card">
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>{c.label}</p>
          <p style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>{c.value}</p>
        </div>
      ))}
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

const emptyPlan = { name: "", price: "", billingPeriod: "month", description: "", features: "", popular: false, active: true, sortOrder: 0, razorpayPlanId: "", stripePriceId: "", strikePrice: "", annualDiscountType: "percent", annualDiscountValue: "", appKey: "juicechatjunction" };

function PlansManager() {
  const [plans, setPlans] = useState(null);
  const [form, setForm] = useState(emptyPlan);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Snapshot of the plan's price/billing period at the moment Edit was
  // clicked — compared against the live form below to warn before a save
  // that would trigger a brand-new Razorpay/Stripe plan object (both
  // platforms make these immutable once created; see the comment atop
  // app/api/admin/plans/route.js). Not used at all for "Add a plan".
  const [originalPricing, setOriginalPricing] = useState(null);

  async function load() {
    try {
      const d = await api("/api/admin/plans", "GET");
      setPlans(d.plans || []);
    } catch {
      setPlans([]);
    }
  }
  useEffect(() => { load(); }, []);

  function edit(p) {
    setEditingId(p.id);
    setForm({
      name: p.name || "", price: p.price ?? "", billingPeriod: p.billingPeriod || "month",
      description: p.description || "", features: (p.features || []).join(", "),
      popular: !!p.popular, active: p.active !== false, sortOrder: p.sortOrder ?? 0,
      razorpayPlanId: p.razorpayPlanId || "", stripePriceId: p.stripePriceId || "",
      strikePrice: p.strikePrice ?? "",
      annualDiscountType: p.annualDiscountType || "percent",
      annualDiscountValue: p.annualDiscountValue ?? "",
      appKey: p.appKey || "juicechatjunction",
    });
    setOriginalPricing({ price: p.price ?? "", billingPeriod: p.billingPeriod || "month" });
  }
  function resetForm() { setEditingId(null); setForm(emptyPlan); setOriginalPricing(null); }

  // True once the person has actually changed Price or Billing period away
  // from what this plan was saved with — the two fields that make saving
  // create a fresh gateway plan instead of reusing the existing one (see
  // resolveGatewayIds() in app/api/admin/plans/route.js).
  const willCreateNewGatewayPlan =
    editingId &&
    originalPricing &&
    (Number(form.price) !== Number(originalPricing.price) || form.billingPeriod !== originalPricing.billingPeriod);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const payload = {
        name: form.name, price: Number(form.price), billingPeriod: form.billingPeriod,
        description: form.description, popular: !!form.popular, active: !!form.active,
        sortOrder: Number(form.sortOrder) || 0,
        features: form.features.split(",").map((s) => s.trim()).filter(Boolean),
        strikePrice: form.strikePrice === "" ? null : Number(form.strikePrice),
        annualDiscountType: form.annualDiscountType,
        annualDiscountValue: form.annualDiscountValue === "" ? 0 : Number(form.annualDiscountValue),
        appKey: form.appKey,
        // No razorpayPlanId/stripePriceId here on purpose — the API
        // auto-creates (or reuses) both from name/price/billingPeriod. See
        // app/api/admin/plans/route.js's resolveGatewayIds().
      };
      if (editingId) {
        await api("/api/admin/plans", "POST", { action: "update", id: editingId, ...payload });
      } else {
        await api("/api/admin/plans", "POST", { action: "create", ...payload });
      }
      resetForm();
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  }

  async function remove(id) {
    if (!confirm("Delete this plan?")) return;
    try {
      await api("/api/admin/plans", "POST", { action: "delete", id });
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  if (plans === null) return <p className="muted">Loading…</p>;

  return (
    <div style={{ display: "grid", gap: 24, gridTemplateColumns: "1.1fr 1fr" }}>
      <div className="card">
        <h3 style={{ marginBottom: 14 }}>{editingId ? "Edit plan" : "Add a plan"}</h3>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 12 }}>
            <label className="label">App</label>
            <select className="input" value={form.appKey} onChange={(e) => setForm({ ...form, appKey: e.target.value })}>
              {APP_CATALOG.map((a) => (
                <option key={a.key} value={a.key}>{a.icon} {a.name}</option>
              ))}
            </select>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
              Which app this plan sells access to. Each app can have its own plans and prices — pricing isn&apos;t
              shared across apps.
            </p>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="row" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Price (₹)</label>
              <input className="input" type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Billing period</label>
              <select className="input" value={form.billingPeriod} onChange={(e) => setForm({ ...form, billingPeriod: e.target.value })}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </div>
          </div>
          {willCreateNewGatewayPlan && (
            <p
              className="muted"
              style={{ fontSize: 12.5, marginTop: -6, marginBottom: 12, color: "#B23C00", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 10px" }}
            >
              Razorpay and Stripe don&apos;t allow editing a plan&apos;s price after it&apos;s created, so saving this
              will set up a brand-new plan there instead of changing the existing one. Anyone already subscribed
              keeps their current price; only new checkouts will use this one. If you were just testing a value,
              change it back before saving to avoid leaving an unused plan behind at the gateway.
            </p>
          )}
          <div style={{ marginBottom: 12 }}>
            <label className="label">Marketing price (strike-through, optional)</label>
            <input
              className="input" type="number" min="0" placeholder="e.g. 699"
              value={form.strikePrice} onChange={(e) => setForm({ ...form, strikePrice: e.target.value })}
            />
            <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
              Shown crossed out next to the real price on the pricing page, with a "Limited offer" badge, to
              make the current price look like an active discount. Purely cosmetic. Leave blank to hide it.
            </p>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Annual discount (off 12x the monthly price above)</label>
            <div className="row">
              <select
                className="input" style={{ flex: 1 }}
                value={form.annualDiscountType}
                onChange={(e) => setForm({ ...form, annualDiscountType: e.target.value })}
              >
                <option value="percent">% off</option>
                <option value="amount">₹ off</option>
              </select>
              <input
                className="input" style={{ flex: 1 }} type="number" min="0" placeholder="e.g. 15"
                value={form.annualDiscountValue} onChange={(e) => setForm({ ...form, annualDiscountValue: e.target.value })}
              />
            </div>
            {(() => {
              const monthly = Number(form.price) || 0;
              const base = monthly * 12;
              const discountValue = Number(form.annualDiscountValue) || 0;
              const annual =
                form.annualDiscountType === "amount"
                  ? Math.max(0, Math.round(base - discountValue))
                  : Math.max(0, Math.round(base * (1 - discountValue / 100)));
              const savings = base - annual;
              const savingsPct = base > 0 ? Math.round((savings / base) * 100) : 0;
              return (
                <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                  {monthly > 0
                    ? `₹${base.toLocaleString("en-IN")}/year → ₹${annual.toLocaleString("en-IN")}/year — customer saves ₹${savings.toLocaleString("en-IN")} (${savingsPct}%). Most SaaS apps offer 15–20% off (roughly 2 months free) for annual billing.`
                    : "Enter the monthly price above to see the annual price preview."}
                </p>
              );
            })()}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Description</label>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Features (comma-separated)</label>
            <input className="input" value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder="Up to 3 users, Email support" />
          </div>
          <div className="row" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Razorpay Plan</label>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                {form.razorpayPlanId
                  ? `Created: ${form.razorpayPlanId}`
                  : "Created automatically when you save, from the price above."}
              </p>
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Stripe Price</label>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                {form.stripePriceId
                  ? `Created: ${form.stripePriceId}`
                  : "Created automatically when you save, from the price above."}
              </p>
            </div>
          </div>
          <div className="row" style={{ marginBottom: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
              <input type="checkbox" checked={form.popular} onChange={(e) => setForm({ ...form, popular: e.target.checked })} /> Mark as popular
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active (visible on pricing page)
            </label>
          </div>
          <div className="row">
            <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : editingId ? "Save changes" : "Add plan"}</button>
            {editingId && <button type="button" className="btn-outline-dark" onClick={resetForm}>Cancel</button>}
          </div>
          {err && <p className="error">{err}</p>}
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 14 }}>Existing plans</h3>
        {plans.length === 0 && <p className="muted">No plans yet.</p>}
        {plans.map((p) => (
          <div key={p.id} style={{ borderBottom: "1px solid var(--line)", padding: "12px 0" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>
                <span className="muted" style={{ fontWeight: 400, fontSize: 12.5, marginRight: 6 }}>
                  {APP_CATALOG.find((a) => a.key === (p.appKey || "juicechatjunction"))?.icon || ""}{" "}
                  {APP_CATALOG.find((a) => a.key === (p.appKey || "juicechatjunction"))?.name || p.appKey}
                </span>
                {p.name} ({p.strikePrice > p.price && <span style={{ textDecoration: "line-through", opacity: 0.6 }}>₹{p.strikePrice}</span>}{" "}
                ₹{p.price}/{p.billingPeriod})
              </strong>
              {p.active === false && <span className="muted" style={{ fontSize: 12 }}>hidden</span>}
            </div>
            <div className="row" style={{ marginTop: 4, gap: 12 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Razorpay {p.razorpayPlanId ? "✓" : "not set up yet"}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                Stripe {p.stripePriceId ? "✓" : "not set up yet"}
              </span>
            </div>
            {p.annualPrice > 0 && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Annual: ₹{p.annualPrice.toLocaleString("en-IN")}/year ({p.annualDiscountValue || 0}{p.annualDiscountType === "amount" ? "₹" : "%"} off ₹{(p.price * 12).toLocaleString("en-IN")})
              </div>
            )}
            <div className="row" style={{ marginTop: 6 }}>
              <button className="link-btn" onClick={() => edit(p)}>Edit</button>
              <button className="link-btn danger" onClick={() => remove(p.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
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

// Default plan blueprints used by the one-click "Add default plans" seeder
// below — a starting point, not fixed values. Everything here (price,
// features, limits) can be edited afterward from the Plans / Plan Limits
// tabs like any other plan.
const DEFAULT_PLANS = [
  {
    name: "Essential", price: 499, strikePrice: 699, billingPeriod: "month", sortOrder: 1,
    description: "Everything you need to run one counter.",
    features: ["1 shop location", "Up to 2 staff logins", "Digital menu & self-order", "Basic sales reports"],
    popular: false, active: true,
    limits: { maxStaffLogins: 2, maxShops: 1, maxMenuItems: 50, maxMonthlyOrders: 500, supportLevel: "Email" },
  },
  {
    name: "Business", price: 999, strikePrice: 1299, billingPeriod: "month", sortOrder: 2,
    description: "For growing shops with more staff and locations.",
    features: ["Up to 3 shop locations", "Up to 8 staff logins", "Inventory & purchases", "Priority email support"],
    popular: true, active: true,
    limits: { maxStaffLogins: 8, maxShops: 3, maxMenuItems: 300, maxMonthlyOrders: 3000, supportLevel: "Priority Email" },
  },
  {
    name: "Premium", price: 1999, strikePrice: 2299, billingPeriod: "month", sortOrder: 3,
    description: "Unlimited scale with every feature unlocked.",
    features: ["Unlimited shop locations", "Unlimited staff logins", "Full CapEx/OpEx & analytics", "Phone & priority support"],
    popular: false, active: true,
    limits: { maxStaffLogins: "", maxShops: "", maxMenuItems: "", maxMonthlyOrders: "", supportLevel: "Phone & Priority" },
  },
];

const LIMIT_FIELDS = [
  { key: "maxStaffLogins", label: "Staff logins" },
  { key: "maxShops", label: "Shop locations" },
  { key: "maxMenuItems", label: "Menu items" },
  { key: "maxMonthlyOrders", label: "Orders / month" },
];

const SUPPORT_LEVELS = ["Email", "Priority Email", "Phone & Priority"];

function PlanLimitsManager() {
  const [plans, setPlans] = useState(null);
  const [edits, setEdits] = useState({}); // planId -> { ...limit fields }
  const [savingId, setSavingId] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const d = await api("/api/admin/plans", "GET");
      const list = d.plans || [];
      setPlans(list);
      const next = {};
      for (const p of list) {
        const l = p.limits || {};
        next[p.id] = {
          maxStaffLogins: l.maxStaffLogins ?? "", maxShops: l.maxShops ?? "",
          maxMenuItems: l.maxMenuItems ?? "", maxMonthlyOrders: l.maxMonthlyOrders ?? "",
          supportLevel: l.supportLevel || SUPPORT_LEVELS[0],
        };
      }
      setEdits(next);
    } catch {
      setPlans([]);
    }
  }
  useEffect(() => { load(); }, []);

  function setField(planId, field, value) {
    setEdits((e) => ({ ...e, [planId]: { ...e[planId], [field]: value } }));
  }

  async function saveLimits(planId) {
    setSavingId(planId);
    setErr("");
    try {
      const f = edits[planId];
      const limits = {
        maxStaffLogins: f.maxStaffLogins === "" ? "" : Number(f.maxStaffLogins),
        maxShops: f.maxShops === "" ? "" : Number(f.maxShops),
        maxMenuItems: f.maxMenuItems === "" ? "" : Number(f.maxMenuItems),
        maxMonthlyOrders: f.maxMonthlyOrders === "" ? "" : Number(f.maxMonthlyOrders),
        supportLevel: f.supportLevel,
      };
      await api("/api/admin/plans", "POST", { action: "setLimits", id: planId, limits });
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
    setSavingId(null);
  }

  async function seedDefaults() {
    setSeeding(true);
    setErr("");
    try {
      const existingNames = new Set((plans || []).map((p) => (p.name || "").trim().toLowerCase()));
      for (const dp of DEFAULT_PLANS) {
        if (existingNames.has(dp.name.toLowerCase())) continue; // don't duplicate one that's already there
        await api("/api/admin/plans", "POST", { action: "create", ...dp });
      }
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
    setSeeding(false);
  }

  if (plans === null) return <p className="muted">Loading…</p>;

  const missingDefaults = DEFAULT_PLANS.filter(
    (dp) => !plans.some((p) => (p.name || "").trim().toLowerCase() === dp.name.toLowerCase())
  );

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="section-title" style={{ marginTop: 0 }}>Plan tiers</p>
        <p className="muted" style={{ marginTop: 0 }}>
          Set usage limits per plan: staff logins, shop locations, menu items, and monthly self-orders.
          Leave a field blank for <b>Unlimited</b>. These numbers are for reference and billing conversations
          for now; they aren&apos;t automatically enforced inside Bizzux Shop yet.
        </p>
        {missingDefaults.length > 0 && (
          <button className="btn-primary" disabled={seeding} onClick={seedDefaults}>
            {seeding ? "Adding…" : `+ Add default plans (${missingDefaults.map((d) => d.name).join(", ")})`}
          </button>
        )}
        {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
      </div>

      {plans.length === 0 && <p className="muted">No plans yet. Add one from the Plans tab, or use the button above.</p>}

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {plans.map((p) => {
          const f = edits[p.id] || {};
          return (
            <div key={p.id} className="card">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <strong>{p.name}</strong>
                {p.popular && <span className="muted" style={{ fontSize: 12 }}>★ Popular</span>}
              </div>

              {LIMIT_FIELDS.map((lf) => (
                <div key={lf.key} style={{ marginBottom: 10 }}>
                  <label className="label">{lf.label}</label>
                  <input
                    className="input" type="number" min="0"
                    placeholder="Unlimited"
                    value={f[lf.key] ?? ""}
                    onChange={(e) => setField(p.id, lf.key, e.target.value)}
                  />
                </div>
              ))}

              <div style={{ marginBottom: 12 }}>
                <label className="label">Support level</label>
                <select
                  className="input"
                  value={f.supportLevel || SUPPORT_LEVELS[0]}
                  onChange={(e) => setField(p.id, "supportLevel", e.target.value)}
                >
                  {SUPPORT_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <button className="btn-primary" disabled={savingId === p.id} onClick={() => saveLimits(p.id)}>
                {savingId === p.id ? "Saving…" : "Save limits"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Lets a Super Admin pick, per plan, which Bizzux apps are included and
// (optionally) which named features within each app are unlocked — e.g.
// "Business" gets Shop + POS + Orders, with POS limited to "Single till".
// Mirrors the Plan Limits tab's per-plan-card layout. See lib/apps.js for
// the app catalog and app/api/admin/plans/route.js's setAppAccess action.
function PlanAppsManager() {
  const [plans, setPlans] = useState(null);
  // planId -> { [appKey]: { enabled, features: string[], featuresText: string } }
  // `features` (array) drives the checklist for apps with a known real tab
  // list (APP_CATALOG entry has `features`); `featuresText` (raw string,
  // kept separate so a mid-typed comma is never eaten) drives the free-text
  // fallback for apps whose feature list isn't known yet.
  const [edits, setEdits] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const d = await api("/api/admin/plans", "GET");
      const list = d.plans || [];
      setPlans(list);
      const next = {};
      for (const p of list) {
        const access = p.appAccess || {};
        const forPlan = {};
        for (const app of APP_CATALOG) {
          const a = access[app.key] || {};
          const featuresArr = Array.isArray(a.features) ? a.features : [];
          forPlan[app.key] = { enabled: !!a.enabled, features: featuresArr, featuresText: featuresArr.join(", ") };
        }
        next[p.id] = forPlan;
      }
      setEdits(next);
    } catch {
      setPlans([]);
    }
  }
  useEffect(() => { load(); }, []);

  function setAppField(planId, appKey, field, value) {
    setEdits((e) => ({
      ...e,
      [planId]: { ...e[planId], [appKey]: { ...e[planId]?.[appKey], [field]: value } },
    }));
  }

  // Checklist apps only — toggles one real tab id in or out of the plan's
  // allowed set.
  function toggleFeature(planId, appKey, featureId) {
    setEdits((e) => {
      const current = e[planId]?.[appKey]?.features || [];
      const next = current.includes(featureId) ? current.filter((f) => f !== featureId) : [...current, featureId];
      return { ...e, [planId]: { ...e[planId], [appKey]: { ...e[planId]?.[appKey], features: next } } };
    });
  }

  async function saveAppAccess(planId) {
    setSavingId(planId);
    setErr("");
    try {
      const forPlan = edits[planId] || {};
      const appAccess = {};
      for (const app of APP_CATALOG) {
        const a = forPlan[app.key] || {};
        // Checklist apps save straight from the `features` array; free-text
        // apps parse `featuresText` the same way they always did.
        const features = app.features
          ? (a.features || []).filter(Boolean)
          : (a.featuresText || "").split(",").map((s) => s.trim()).filter(Boolean);
        appAccess[app.key] = { enabled: !!a.enabled, features };
      }
      await api("/api/admin/plans", "POST", { action: "setAppAccess", id: planId, appAccess });
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
    setSavingId(null);
  }

  if (plans === null) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="section-title" style={{ marginTop: 0 }}>App access per plan</p>
        <p className="muted" style={{ marginTop: 0 }}>
          Choose which Bizzux apps come with each plan. Apps with a known tab structure, like Bizzux Shop,
          show a checklist of their real tabs to include or exclude; the rest still take a free-text list of
          feature names for reference. Enforcement currently reaches Bizzux Shop, since it's the only app
          live today, through the sign-in hand-off.
        </p>
        {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
      </div>

      {plans.length === 0 && <p className="muted">No plans yet. Add one from the Plans tab.</p>}

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {plans.map((p) => {
          const forPlan = edits[p.id] || {};
          return (
            <div key={p.id} className="card">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <strong>{p.name}</strong>
                {p.popular && <span className="muted" style={{ fontSize: 12 }}>★ Popular</span>}
              </div>

              {APP_CATALOG.map((app) => {
                const a = forPlan[app.key] || { enabled: false, features: [], featuresText: "" };
                return (
                  <div key={app.key} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--line)" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, marginBottom: a.enabled ? 6 : 0 }}>
                      <input
                        type="checkbox" checked={a.enabled}
                        onChange={(e) => setAppField(p.id, app.key, "enabled", e.target.checked)}
                      />
                      <span>{app.icon} {app.name}</span>
                    </label>

                    {a.enabled && app.features && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 14px", paddingLeft: 22 }}>
                        {app.features.map((f) => (
                          <label key={f.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--muted)" }}>
                            <input
                              type="checkbox"
                              checked={a.features.includes(f.id)}
                              onChange={() => toggleFeature(p.id, app.key, f.id)}
                            />
                            {f.label}
                          </label>
                        ))}
                      </div>
                    )}

                    {a.enabled && !app.features && (
                      <input
                        className="input" placeholder="Unlocked features (comma-separated, optional)"
                        value={a.featuresText}
                        onChange={(e) => setAppField(p.id, app.key, "featuresText", e.target.value)}
                        style={{ fontSize: 12.5 }}
                      />
                    )}
                  </div>
                );
              })}

              <button className="btn-primary" disabled={savingId === p.id} onClick={() => saveAppAccess(p.id)}>
                {savingId === p.id ? "Saving…" : "Save app access"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Small "⋯" more-actions menu — same pattern used in Bizzux Files.
function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="link-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ fontSize: 16, padding: "2px 8px" }}
      >
        ⋯
      </button>
      {open && (
        <>
          {/* Backdrop closes the menu on outside click without a ref/effect. */}
          <div style={{ position: "fixed", inset: 0, zIndex: 29 }} onClick={() => setOpen(false)} />
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 30, minWidth: 170, padding: 6, boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}
          >
            {items.map((it, i) => (
              <button
                key={i} type="button"
                className={"link-btn" + (it.danger ? " danger" : "")}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 8px", fontSize: 13 }}
                onClick={() => { setOpen(false); it.onClick(); }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Matches the keys appUsage.<key> is stamped with (app-sso/route.js,
// shop-sso/route.js) to the display name shown in the Apps Used column.
const APP_USAGE_LABELS = {
  juicechatjunction: "Shop",
  notes: "Notes",
  files: "Files",
  projects: "Projects",
};

function CustomersList() {
  const [customers, setCustomers] = useState(null);
  const [extending, setExtending] = useState(null); // customer row being extended, or null
  const [markingPaid, setMarkingPaid] = useState(null); // customer row being marked paid, or null
  const [viewingAdmins, setViewingAdmins] = useState(null); // customer row, or null
  const [viewingActivity, setViewingActivity] = useState(null); // customer row, or null
  const [settingPassword, setSettingPassword] = useState(null); // customer row, or null
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState(null);

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

  async function resetPassword(c) {
    if (!confirm(`Send a password-reset email to ${c.email}?`)) return;
    setBusyId(c.id);
    setErr("");
    try {
      await api("/api/admin/customers", "POST", { action: "resetPassword", id: c.id });
      alert(`Password-reset email sent to ${c.email}.`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  // For accounts with no working email on file (e.g. created directly from
  // Organizations > "Create Business Login") — sets the password right
  // here instead of emailing a reset link nobody can receive. Also useful
  // when a shop owner calls support because they forgot their password and
  // can't reach whatever email is on file either.
  async function toggleSuspend(c) {
    const suspending = c.status !== "suspended";
    if (!confirm(suspending
      ? `Suspend ${c.email}? They'll immediately lose access to every Bizzux app until reactivated.`
      : `Reactivate ${c.email}?`)) return;
    setBusyId(c.id);
    setErr("");
    try {
      await api("/api/admin/customers", "POST", { action: suspending ? "suspend" : "reactivate", id: c.id });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (customers === null) return <p className="muted">Loading…</p>;

  return (
    <div className="card">
      {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}
      {customers.length === 0 && <p className="muted">No signups yet.</p>}
      {customers.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Organization</th><th>Owner</th><th>Email</th><th>Mobile</th><th>Location</th>
                <th>Signed up</th><th>Customer for</th><th>Last login</th><th>Status</th><th>Type</th><th>Plan</th><th>Apps used</th><th>Trial ends</th><th></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const usedKeys = Object.keys(c.appUsage || {});
                return (
                <tr key={c.id}>
                  <td>{c.organizationName || "—"}</td>
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
                  <td><span className={"status-pill " + (c.status === "suspended" ? "expired" : c.status || "trial")}>{c.status || "trial"}</span></td>
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
                  <td>
                    <RowMenu
                      items={[
                        { label: "View org owner/admins", onClick: () => setViewingAdmins(c) },
                        { label: "View Shop activity", onClick: () => setViewingActivity(c) },
                        { label: "Extend trial", onClick: () => setExtending(c) },
                        { label: "Mark as paid (cash / offline)", onClick: () => setMarkingPaid(c) },
                        { label: "Reset password (email link)", onClick: () => resetPassword(c) },
                        { label: "Set new password directly", onClick: () => setSettingPassword(c) },
                        {
                          label: busyId === c.id ? "Working…" : (c.status === "suspended" ? "Reactivate" : "Suspend"),
                          danger: c.status !== "suspended",
                          onClick: () => toggleSuspend(c),
                        },
                      ]}
                    />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {extending && (
        <ExtendTrialModal
          customer={extending}
          onClose={() => setExtending(null)}
          onExtended={async () => {
            setExtending(null);
            await load();
          }}
        />
      )}

      {viewingAdmins && (
        <OrgAdminsModal customer={viewingAdmins} onClose={() => setViewingAdmins(null)} />
      )}

      {viewingActivity && (
        <CustomerActivityModal customer={viewingActivity} onClose={() => setViewingActivity(null)} />
      )}

      {settingPassword && (
        <SetPasswordModal customer={settingPassword} onClose={() => setSettingPassword(null)} />
      )}

      {markingPaid && (
        <MarkPaidModal
          customer={markingPaid}
          onClose={() => setMarkingPaid(null)}
          onMarked={async () => {
            setMarkingPaid(null);
            await load();
          }}
        />
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

function CustomerActivityModal({ customer, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await api(`/api/admin/customer-activity?id=${customer.id}`, "GET");
        setData(d);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [customer.id]);

  const modules = data && [
    ["Menu", data.usesMenu], ["Inventory", data.usesInventory],
    ["Reservations", data.usesReservations], ["CapEx", data.usesCapex],
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h2 style={{ marginBottom: 4 }}>{customer.organizationName || customer.fullName || customer.email}</h2>
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
          Usage only — sales/purchase/expense amounts are never shown here.
        </p>
        {error && <p className="error">{error}</p>}
        {!error && data === null && <p className="muted">Loading…</p>}
        {data && (
          <>
            <ActivityRow label="🧾 Sales" data={data.sales} />
            <ActivityRow label="🛒 Purchases" data={data.purchases} />
            <ActivityRow label="🧺 Expenses" data={data.expenses} />
            <div className="row" style={{ marginTop: 14, gap: 6, flexWrap: "wrap" }}>
              {modules.map(([label, used]) => (
                <span key={label} className={"status-pill " + (used ? "active" : "")} style={!used ? { opacity: 0.5 } : undefined}>
                  {used ? "✓" : "—"} {label}
                </span>
              ))}
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

function OrgAdminsModal({ customer, onClose }) {
  const [admins, setAdmins] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await api(`/api/admin/customers?id=${customer.id}`, "GET");
        setAdmins(d.admins || []);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [customer.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h2 style={{ marginBottom: 4 }}>{customer.organizationName || customer.fullName || customer.email}</h2>
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>Organization Owner and Organization Admins for this account.</p>
        {error && <p className="error">{error}</p>}
        {!error && admins === null && <p className="muted">Loading…</p>}
        {admins && admins.map((a, i) => (
          <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ fontSize: 13.5 }}>{a.email}</span>
              <span className="status-pill active">{a.role}</span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }} title={a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : ""}>
              Last login: {timeAgo(a.lastLoginAt)}
            </div>
          </div>
        ))}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn-outline-dark" onClick={onClose}>Close</button>
        </div>
      </div>
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
function MarkPaidModal({ customer, onClose, onMarked }) {
  const [plans, setPlans] = useState(null);
  const [planId, setPlanId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await api("/api/admin/plans", "GET");
        const active = (d.plans || []).filter((p) => p.active !== false);
        setPlans(active);
        if (active.length) setPlanId(active[0].id);
      } catch {
        setPlans([]);
      }
    })();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!planId) {
      setError("Choose a plan");
      return;
    }
    setBusy(true);
    try {
      await api("/api/admin/customers", "POST", { action: "markPaid", id: customer.id, planId, notes });
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
          This activates the account on the plan below, same as a real online payment would.
        </p>
        <form onSubmit={submit} noValidate>
          {plans === null && <p className="muted">Loading plans…</p>}
          {plans && plans.length === 0 && <p className="error">No active plans configured yet — add one on the Plans &amp; Pricing tab first.</p>}
          {plans && plans.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <label className="label">Plan *</label>
              <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)} autoFocus>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — ₹{p.price}/{p.billingPeriod}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <label className="label">Notes (optional)</label>
            <input
              className="input" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cash collected by field agent, receipt #1234"
            />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy || !plans?.length}>{busy ? "Saving…" : "Mark as paid"}</button>
          </div>
          {error && <p className="error">{error}</p>}
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

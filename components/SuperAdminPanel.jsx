"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Link from "next/link";
import OrganizationsManager from "@/components/OrganizationsManager";

// Ported from apps.bizzux.com's app/admin/page.js (Super Admin panel), now
// embedded as the "Super Admin" tab of bizzux.com's merged /admin page —
// see app/admin/AdminTabs.tsx. Gated on Firebase Auth + SUPER_ADMIN_EMAIL,
// which is a SEPARATE check from the cookie-session password that already
// protects the whole /admin route (that guards the Career Applications
// tab): someone could hold one without the other, so this shows its own
// sign-in prompt instead of bouncing the whole page away.
const TABS = [
  { id: "trial", label: "Trial settings" },
  { id: "plans", label: "Plans" },
  { id: "planlimits", label: "Plan Limits" },
  { id: "customers", label: "Customers" },
  { id: "organizations", label: "Add Organization" },
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
  const [tab, setTab] = useState("trial");

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

      {tab === "trial" && <TrialSettings />}
      {tab === "plans" && <PlansManager />}
      {tab === "planlimits" && <PlanLimitsManager />}
      {tab === "customers" && <CustomersList />}
      {tab === "organizations" && <OrganizationsManager />}
    </div>
  );
}

function TrialSettings() {
  const [trialDays, setTrialDays] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await api("/api/admin/settings", "GET");
        setTrialDays(String(d.trialDays ?? 14));
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

  if (!loaded) return <p className="muted">Loading…</p>;

  return (
    <div className="card" style={{ maxWidth: 420 }}>
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
  );
}

const emptyPlan = { name: "", price: "", billingPeriod: "month", description: "", features: "", popular: false, active: true, sortOrder: 0, razorpayPlanId: "", stripePriceId: "" };

function PlansManager() {
  const [plans, setPlans] = useState(null);
  const [form, setForm] = useState(emptyPlan);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
    });
  }
  function resetForm() { setEditingId(null); setForm(emptyPlan); }

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
              <input className="input" value={form.billingPeriod} onChange={(e) => setForm({ ...form, billingPeriod: e.target.value })} placeholder="month" />
            </div>
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
              <strong>{p.name} (₹{p.price}/{p.billingPeriod})</strong>
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

// Default plan blueprints used by the one-click "Add default plans" seeder
// below — a starting point, not fixed values. Everything here (price,
// features, limits) can be edited afterward from the Plans / Plan Limits
// tabs like any other plan.
const DEFAULT_PLANS = [
  {
    name: "Essential", price: 499, billingPeriod: "month", sortOrder: 1,
    description: "Everything you need to run one counter.",
    features: ["1 shop location", "Up to 2 staff logins", "Digital menu & self-order", "Basic sales reports"],
    popular: false, active: true,
    limits: { maxStaffLogins: 2, maxShops: 1, maxMenuItems: 50, maxMonthlyOrders: 500, supportLevel: "Email" },
  },
  {
    name: "Business", price: 999, billingPeriod: "month", sortOrder: 2,
    description: "For growing shops with more staff and locations.",
    features: ["Up to 3 shop locations", "Up to 8 staff logins", "Inventory & purchases", "Priority email support"],
    popular: true, active: true,
    limits: { maxStaffLogins: 8, maxShops: 3, maxMenuItems: 300, maxMonthlyOrders: 3000, supportLevel: "Priority Email" },
  },
  {
    name: "Premium", price: 1999, billingPeriod: "month", sortOrder: 3,
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

function CustomersList() {
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

  return (
    <div className="card">
      {customers.length === 0 && <p className="muted">No signups yet.</p>}
      {customers.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Email</th><th>Signed up</th><th>Status</th><th>Plan</th><th>Trial ends</th></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>{c.email}</td>
                <td>{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "N/A"}</td>
                <td><span className={"status-pill " + (c.status || "trial")}>{c.status || "trial"}</span></td>
                <td>{c.planName || "N/A"}</td>
                <td>{c.trialEndDate ? new Date(c.trialEndDate).toLocaleDateString() : "N/A"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

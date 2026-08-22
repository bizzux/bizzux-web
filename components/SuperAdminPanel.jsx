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
  { id: "trial", label: "Trial settings" },
  { id: "plans", label: "Plans" },
  { id: "planlimits", label: "Plan Limits" },
  { id: "planapps", label: "Plan Apps" },
  { id: "offers", label: "Offers" },
  { id: "resellers", label: "Partners" },
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
      {tab === "planapps" && <PlanAppsManager />}
      {tab === "offers" && <OffersManager />}
      {tab === "resellers" && <ResellersManager />}
      {tab === "customers" && <CustomersList />}
      {tab === "organizations" && <OrganizationsManager />}
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

const emptyPlan = { name: "", price: "", billingPeriod: "month", description: "", features: "", popular: false, active: true, sortOrder: 0, razorpayPlanId: "", stripePriceId: "", strikePrice: "" };

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
  code: "", planId: "", discountType: "percent", discountValue: "",
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
      code: o.id, planId: o.planId || "", discountType: o.discountType || "percent",
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
        code: form.code, planId: form.planId, discountType: form.discountType,
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
            <label className="label">Plan</label>
            <select className="input" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })} required>
              <option value="" disabled>Select a plan</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} (₹{p.price}/{p.billingPeriod})</option>)}
            </select>
          </div>
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
          return (
            <div key={o.id} style={{ borderBottom: "1px solid var(--line)", padding: "12px 0" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{o.id}</strong>
                {o.active === false && <span className="muted" style={{ fontSize: 12 }}>inactive</span>}
              </div>
              <p className="muted" style={{ margin: "4px 0", fontSize: 13 }}>
                {discountLabel(o)} on {plan ? plan.name : "(deleted plan)"}, {durationLabel(o)}
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
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Mobile</th><th>Country</th>
                <th>Signed up</th><th>Status</th><th>Type</th><th>Plan</th><th>Trial ends</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>{c.fullName || "N/A"}</td>
                  <td>{c.email}</td>
                  <td>{c.phone || "N/A"}</td>
                  <td>{c.country || "N/A"}</td>
                  <td>{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "N/A"}</td>
                  <td><span className={"status-pill " + (c.status || "trial")}>{c.status || "trial"}</span></td>
                  <td>{c.customerType}</td>
                  <td>{c.planName || "N/A"}</td>
                  <td>{c.trialEndDate ? new Date(c.trialEndDate).toLocaleDateString() : "N/A"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
    </div>
  );
}

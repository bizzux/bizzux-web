"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { appUnitPrices, monthlyEquivalent, formatMoney, promotionActive, planPrices } from "@/lib/pricingMath";

// Global Admin → Billing & Pricing. Edits the published pricing in
// Firestore through /api/admin/pricing. Every price field is independent:
// the annual price is never calculated from the monthly one. Saving only
// affects NEW checkouts; existing subscribers keep the price snapshot on
// their subscription.

async function api(path, method, body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    method,
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const SECTIONS = [
  ["plans", "Pricing Plans"],
  ["apps", "Apps & Suite"],
  ["settings", "Settings"],
  ["history", "Price History"],
];

export default function PricingManager() {
  const [section, setSection] = useState("plans");
  const [config, setConfig] = useState(null);
  const [err, setErr] = useState("");

  async function load() {
    try {
      setConfig(await api("/api/admin/pricing", "GET"));
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  if (err && !config) return <p className="error">{err}</p>;
  if (!config) return <p className="muted">Loading pricing…</p>;

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, background: "#f0fdfa", borderColor: "#99f6e4" }}>
        <p style={{ fontSize: 13, margin: 0 }}>
          <strong>Billing &amp; Pricing.</strong> The pricing page, checkout, upgrades, renewals and reports all read these
          values. Changes apply to <strong>new subscriptions only</strong>. Existing customers keep the price they signed up at.
        </p>
      </div>
      <div className="admin-tabs" role="tablist" style={{ marginBottom: 16 }}>
        {SECTIONS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={section === id} className={"admin-tab" + (section === id ? " active" : "")} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </div>
      {section === "plans" && <PlansSection config={config} onSaved={load} />}
      {section === "apps" && <AppsSection config={config} onSaved={load} />}
      {section === "settings" && <SettingsSection config={config} onSaved={load} />}
      {section === "history" && <HistorySection history={config.history || []} />}
    </div>
  );
}

function planForm(p) {
  return {
    planName: p.planName || "", tagline: p.tagline || "", description: p.description || "", currency: p.currency || "INR",
    monthlyPricePerUser: p.monthlyPricePerUser ?? "", monthlyOfferPrice: p.monthlyOfferPrice ?? "",
    annualPricePerUser: p.annualPricePerUser ?? "", annualOfferPrice: p.annualOfferPrice ?? "",
    promotionEnabled: !!p.promotionEnabled, promotionLabel: p.promotionLabel || "", promotionDescription: p.promotionDescription || "",
    promotionStartDate: p.promotionStartDate || "", promotionEndDate: p.promotionEndDate || "", priceLockMonths: p.priceLockMonths ?? "",
    monthlyBillingEnabled: p.monthlyBillingEnabled !== false, annualBillingEnabled: p.annualBillingEnabled !== false,
    discountLabel: p.discountLabel || "", offerText: p.offerText || "", badge: p.badge || "", ctaLabel: p.ctaLabel || "",
    active: p.active !== false, displayOrder: p.displayOrder ?? 0,
  };
}

const PLAN_ROWS = [
  { key: "planName", label: "Plan name" },
  { key: "tagline", label: "Tagline" },
  { key: "description", label: "Description" },
  { key: "monthlyPricePerUser", label: "Regular monthly price / user", type: "price" },
  { key: "monthlyOfferPrice", label: "Offer monthly price / user", type: "price", placeholder: "blank = no offer" },
  { key: "annualPricePerUser", label: "Regular annual price / user", type: "price" },
  { key: "annualOfferPrice", label: "Offer annual price / user", type: "price", placeholder: "blank = no offer" },
  { key: "promotionEnabled", label: "Offer enabled", type: "bool" },
  { key: "promotionLabel", label: "Offer label", placeholder: "Launch Offer" },
  { key: "promotionDescription", label: "Offer description (optional)", placeholder: "e.g. For the first 100 businesses" },
  { key: "promotionStartDate", label: "Offer start date", type: "date" },
  { key: "promotionEndDate", label: "Offer end date", type: "date" },
  { key: "priceLockMonths", label: "Price lock (months)", type: "number", placeholder: "blank = for as long as they stay subscribed" },
  { key: "monthlyBillingEnabled", label: "Monthly billing enabled", type: "bool" },
  { key: "annualBillingEnabled", label: "Annual billing enabled", type: "bool" },
  { key: "discountLabel", label: "Annual toggle label", placeholder: "Save 17%" },
  { key: "offerText", label: "Annual offer text", placeholder: "2 Months Free" },
  { key: "badge", label: "Badge", placeholder: "BEST VALUE" },
  { key: "ctaLabel", label: "Button text" },
  { key: "currency", label: "Currency", type: "currency" },
  { key: "active", label: "Active (shown and sold)", type: "bool" },
  { key: "displayOrder", label: "Display order", type: "number" },
];

function PlansSection({ config, onSaved }) {
  const plans = config.plans;
  const [forms, setForms] = useState(() => Object.fromEntries(plans.map((p) => [p.planCode, planForm(p)])));
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState({});

  function set(code, key, value) {
    setForms((f) => ({ ...f, [code]: { ...f[code], [key]: value } }));
  }

  async function save(p) {
    const form = forms[p.planCode];
    const original = planForm(p);
    const changes = {};
    for (const k of Object.keys(form)) {
      if (String(form[k]) !== String(original[k])) changes[k] = form[k];
    }
    if (!Object.keys(changes).length) {
      setMsg((m) => ({ ...m, [p.planCode]: "No changes." }));
      return;
    }
    const PRICE_LABELS = { monthlyPricePerUser: "Regular monthly", monthlyOfferPrice: "Offer monthly", annualPricePerUser: "Regular annual", annualOfferPrice: "Offer annual" };
    const priceKeys = Object.keys(PRICE_LABELS).filter((k) => k in changes);
    if (priceKeys.length) {
      const show = (x) => (x === "" || x === null || x === undefined ? "none" : "₹" + x);
      const lines = priceKeys.map((k) => `${PRICE_LABELS[k]}: ${show(original[k])} → ${show(changes[k])}`).join("\n");
      if (!confirm(`Change ${p.planName} prices?\n\n${lines}\n\nNew checkouts use the new price. Existing customers keep their current price.`)) return;
    }
    setBusy(p.planCode);
    setMsg((m) => ({ ...m, [p.planCode]: "" }));
    try {
      const d = await api("/api/admin/pricing", "POST", { action: "updatePlan", planCode: p.planCode, changes });
      setMsg((m) => ({ ...m, [p.planCode]: `Saved (${d.changed.length} change${d.changed.length === 1 ? "" : "s"}).` }));
      await onSaved();
    } catch (e) {
      setMsg((m) => ({ ...m, [p.planCode]: e.message }));
    }
    setBusy(null);
  }

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <table className="table" style={{ width: "100%", minWidth: 560 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Setting</th>
            {plans.map((p) => <th key={p.planCode} style={{ textAlign: "left" }}>{p.planName} <span className="muted" style={{ fontWeight: 400 }}>({p.planCode})</span></th>)}
          </tr>
        </thead>
        <tbody>
          {PLAN_ROWS.map((row) => (
            <tr key={row.key}>
              <td style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", paddingRight: 12 }}>{row.label}</td>
              {plans.map((p) => {
                const v = forms[p.planCode][row.key];
                const on = (val) => set(p.planCode, row.key, val);
                return (
                  <td key={p.planCode} style={{ padding: "6px 8px" }}>
                    {row.type === "bool" ? (
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <input type="checkbox" checked={!!v} onChange={(e) => on(e.target.checked)} /> {v ? "Yes" : "No"}
                      </label>
                    ) : row.type === "currency" ? (
                      <select className="input" value={v} onChange={(e) => on(e.target.value)} style={{ maxWidth: 120 }}>
                        <option value="INR">INR (₹)</option>
                      </select>
                    ) : (
                      <input
                        className="input" value={v} placeholder={row.placeholder}
                        type={row.type === "price" || row.type === "number" ? "number" : row.type === "date" ? "date" : "text"}
                        min={row.type === "price" ? 0 : undefined} step={row.type === "price" ? "1" : undefined}
                        onChange={(e) => on(e.target.value)}
                      />
                    )}
                    {(row.key === "monthlyOfferPrice" || row.key === "annualOfferPrice") && v !== "" && (() => {
                      const reg = Number(forms[p.planCode][row.key === "monthlyOfferPrice" ? "monthlyPricePerUser" : "annualPricePerUser"]);
                      const off = Number(v);
                      if (!(reg > 0) || !(off < reg)) return <div className="error" style={{ fontSize: 11.5, marginTop: 3 }}>Must be lower than the regular price</div>;
                      return (
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                          {Math.round(((reg - off) / reg) * 100)}% off · save {formatMoney(reg - off)}
                          {row.key === "annualOfferPrice" ? ` · = ${formatMoney(monthlyEquivalent(off))}/user/month` : ""}
                        </div>
                      );
                    })()}
                    {row.key === "promotionEnabled" && (
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                        {promotionActive({ ...forms[p.planCode], promotionStartDate: forms[p.planCode].promotionStartDate || null, promotionEndDate: forms[p.planCode].promotionEndDate || null })
                          ? "Live now: offer price shown and charged"
                          : "Not live: regular price shown and charged"}
                      </div>
                    )}
                    {row.key === "annualPricePerUser" && Number(v) > 0 && (
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                        = {formatMoney(monthlyEquivalent(v))}/user/month
                        {Number(forms[p.planCode].monthlyPricePerUser) > 0 &&
                          ` · ${Math.round((1 - Number(v) / (Number(forms[p.planCode].monthlyPricePerUser) * 12)) * 100)}% below 12× monthly`}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td />
            {plans.map((p) => (
              <td key={p.planCode} style={{ padding: "10px 8px" }}>
                <button className="btn-primary-sm" disabled={busy === p.planCode} onClick={() => save(p)}>
                  {busy === p.planCode ? "Saving…" : `Save ${p.planName}`}
                </button>
                {msg[p.planCode] && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{msg[p.planCode]}</p>}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        The % shown under the annual price is only a guide for writing the discount label. It never changes any price.
      </p>
    </div>
  );
}

function appForm(a) {
  return {
    appName: a.appName || "", icon: a.icon || "", description: a.description || "",
    individualPurchaseEnabled: !!a.individualPurchaseEnabled, suiteIncluded: !!a.suiteIncluded,
    overrideEnabled: !!a.overrideEnabled,
    monthlyPriceOverride: a.monthlyPriceOverride ?? "", annualPriceOverride: a.annualPriceOverride ?? "",
    active: a.active !== false, displayOrder: a.displayOrder ?? 0,
  };
}

function AppsSection({ config, onSaved }) {
  const appPlan = config.plans.find((p) => p.planType === "APP");
  const [editing, setEditing] = useState(null); // appKey | "__new"
  const [form, setForm] = useState(null);
  const [newKey, setNewKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function start(a) {
    setEditing(a ? a.appKey : "__new");
    setForm(appForm(a || { individualPurchaseEnabled: false, suiteIncluded: false, active: true, displayOrder: config.apps.length + 1 }));
    setNewKey("");
    setErr("");
  }

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const changes = {
        ...form,
        monthlyPriceOverride: form.monthlyPriceOverride === "" ? null : Number(form.monthlyPriceOverride),
        annualPriceOverride: form.annualPriceOverride === "" ? null : Number(form.annualPriceOverride),
        displayOrder: Number(form.displayOrder) || 0,
      };
      if (editing === "__new") await api("/api/admin/pricing", "POST", { action: "addApp", appKey: newKey, changes });
      else await api("/api/admin/pricing", "POST", { action: "updateApp", appKey: editing, changes });
      setEditing(null);
      await onSaved();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  async function quickToggle(a, key) {
    try {
      await api("/api/admin/pricing", "POST", { action: "updateApp", appKey: a.appKey, changes: { [key]: !a[key] } });
      await onSaved();
    } catch (e) {
      alert(e.message);
    }
  }

  const status = (a) =>
    a.active === false ? "Not available"
    : a.individualPurchaseEnabled && a.suiteIncluded ? "Individual + Suite"
    : a.individualPurchaseEnabled ? "Individual only"
    : a.suiteIncluded ? "Suite only" : "Not for sale";

  return (
    <div>
      <div className="card" style={{ overflowX: "auto", marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Apps</h3>
          <button className="btn-primary-sm" onClick={() => start(null)}>+ Add app</button>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Every app inherits the Bizzux App selling price ({appPlan ? `${formatMoney(planPrices(appPlan).month.price)}/mo · ${formatMoney(planPrices(appPlan).year.price)}/yr per user` : "not set"})
          unless you switch on an override. Tick which apps are sold on their own and which are in the Bizzux Suite.
        </p>
        <table className="table" style={{ width: "100%", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>App</th>
              <th>Sold individually</th>
              <th>In Suite</th>
              <th style={{ textAlign: "left" }}>Individual price / user</th>
              <th style={{ textAlign: "left" }}>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {config.apps.map((a) => {
              const prices = appPlan ? appUnitPrices(appPlan, a) : { monthly: 0, annual: 0, source: "published" };
              return (
                <tr key={a.appKey} style={{ opacity: a.active === false ? 0.55 : 1 }}>
                  <td>{a.icon} <strong>{a.appName}</strong> <span className="muted" style={{ fontSize: 11.5 }}>{a.appKey}</span></td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" checked={!!a.individualPurchaseEnabled} onChange={() => quickToggle(a, "individualPurchaseEnabled")} aria-label={`Sell ${a.appName} individually`} /></td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" checked={!!a.suiteIncluded} onChange={() => quickToggle(a, "suiteIncluded")} aria-label={`Include ${a.appName} in Suite`} /></td>
                  <td style={{ fontSize: 13 }}>
                    {formatMoney(prices.monthly)}/mo · {formatMoney(prices.annual)}/yr
                    {prices.source === "override" && <span className="status-pill trial" style={{ marginLeft: 6 }}>override</span>}
                  </td>
                  <td style={{ fontSize: 12.5 }}>{status(a)}</td>
                  <td><button className="link-btn" onClick={() => start(a)}>Edit</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && form && (
        <div className="modal-overlay" onClick={busy ? undefined : () => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, width: "100%" }}>
            <h2 style={{ marginBottom: 12 }}>{editing === "__new" ? "Add an app" : `Edit ${form.appName}`}</h2>
            {editing === "__new" && (
              <div style={{ marginBottom: 12 }}>
                <label className="label">App key (permanent)</label>
                <input className="input" value={newKey} onChange={(e) => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="e.g. hr" />
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Must match the key the app's sign-in hand-off uses. It can't be changed later.</p>
              </div>
            )}
            <div className="row" style={{ marginBottom: 12 }}>
              <div style={{ width: 80 }}>
                <label className="label">Icon</label>
                <input className="input" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="label">Name</label>
                <input className="input" value={form.appName} onChange={(e) => setForm({ ...form, appName: e.target.value })} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="label">Short description</label>
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div style={{ display: "grid", gap: 8, marginBottom: 12, fontSize: 13.5 }}>
              <label><input type="checkbox" checked={form.individualPurchaseEnabled} onChange={(e) => setForm({ ...form, individualPurchaseEnabled: e.target.checked })} /> Available as an individual Bizzux App</label>
              <label><input type="checkbox" checked={form.suiteIncluded} onChange={(e) => setForm({ ...form, suiteIncluded: e.target.checked })} /> Included in Bizzux Suite</label>
              <label><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active (untick to hide it from all pricing)</label>
              <label><input type="checkbox" checked={form.overrideEnabled} onChange={(e) => setForm({ ...form, overrideEnabled: e.target.checked })} /> Use a different price for this app</label>
            </div>
            {form.overrideEnabled && (
              <div className="row" style={{ marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="label">Monthly / user (₹)</label>
                  <input className="input" type="number" min="0" value={form.monthlyPriceOverride} placeholder={appPlan ? String(planPrices(appPlan).month.price) : ""} onChange={(e) => setForm({ ...form, monthlyPriceOverride: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">Annual / user (₹)</label>
                  <input className="input" type="number" min="0" value={form.annualPriceOverride} placeholder={appPlan ? String(planPrices(appPlan).year.price) : ""} onChange={(e) => setForm({ ...form, annualPriceOverride: e.target.value })} />
                </div>
              </div>
            )}
            {form.overrideEnabled && <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>Leave one blank to keep the default Bizzux App price for that billing cycle.</p>}
            <div style={{ marginBottom: 14, width: 140 }}>
              <label className="label">Display order</label>
              <input className="input" type="number" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} />
            </div>
            {err && <p className="error">{err}</p>}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn-outline-dark" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsSection({ config, onSaved }) {
  const [usdRate, setUsdRate] = useState(String(config.settings.usdRate ?? ""));
  const [maxUsers, setMaxUsers] = useState(String(config.settings.maxUsersPerCheckout ?? ""));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await api("/api/admin/pricing", "POST", { action: "updateSettings", changes: { usdRate: Number(usdRate), maxUsersPerCheckout: Number(maxUsers) } });
      setMsg("Saved.");
      await onSaved();
    } catch (e2) {
      setMsg(e2.message);
    }
    setBusy(false);
  }

  return (
    <form className="card" style={{ maxWidth: 440 }} onSubmit={save}>
      <label className="label">INR per 1 USD (for the pricing page's USD view and card payments)</label>
      <input className="input" type="number" min="1" step="0.01" value={usdRate} onChange={(e) => setUsdRate(e.target.value)} style={{ marginBottom: 12 }} />
      <label className="label">Most users in one online checkout</label>
      <input className="input" type="number" min="1" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} style={{ marginBottom: 14 }} />
      <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      {msg && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>{msg}</p>}
    </form>
  );
}

const FIELD_LABELS = {
  monthlyPricePerUser: "Regular monthly price", annualPricePerUser: "Regular annual price",
  monthlyOfferPrice: "Offer monthly price", annualOfferPrice: "Offer annual price", promotionEnabled: "Offer enabled",
  promotionLabel: "Offer label", promotionStartDate: "Offer start", promotionEndDate: "Offer end", priceLockMonths: "Price lock (months)",
  monthlyPriceOverride: "Monthly override", annualPriceOverride: "Annual override",
  monthlyBillingEnabled: "Monthly billing", annualBillingEnabled: "Annual billing",
  individualPurchaseEnabled: "Sold individually", suiteIncluded: "In Suite", overrideEnabled: "Override on",
  planName: "Plan name", appName: "App name", discountLabel: "Discount label", offerText: "Offer text",
  displayOrder: "Display order", usdRate: "USD rate", maxUsersPerCheckout: "Max users",
};

function HistorySection({ history }) {
  const show = (v) => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));
  if (!history.length) return <p className="muted">No price changes recorded yet.</p>;
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <table className="table" style={{ width: "100%", minWidth: 640 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>When</th>
            <th style={{ textAlign: "left" }}>What</th>
            <th style={{ textAlign: "left" }}>Field</th>
            <th style={{ textAlign: "left" }}>Previous</th>
            <th style={{ textAlign: "left" }}>New</th>
            <th style={{ textAlign: "left" }}>Changed by</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id}>
              <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{h.changedAt ? new Date(h.changedAt).toLocaleString("en-IN") : "—"}</td>
              <td style={{ fontSize: 13 }}>{h.entityName}</td>
              <td style={{ fontSize: 13 }}>{FIELD_LABELS[h.field] || h.field}</td>
              <td style={{ fontSize: 13 }}>{show(h.previousValue)}</td>
              <td style={{ fontSize: 13, fontWeight: 600 }}>{show(h.newValue)}</td>
              <td style={{ fontSize: 12.5 }}>{h.changedBy || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

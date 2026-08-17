"use client";

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { COUNTRIES, STATES_BY_COUNTRY } from "@/lib/countries";
import { getTimezones, formatTimezoneLabel } from "@/lib/timezones";
import { getCurrencyCodes, formatCurrencyLabel } from "@/lib/currencies";

// Shared by /admin (Super Admin) and /profile (any Global Admin / Admin) —
// both are allowed to provision placeholder organization records; see
// requireOrgManager() in lib/firebaseAdmin.js for the server-side gate that
// matches this.
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

const USER_RANGES = ["1-10", "11-20", "21-50", "51-100", "101-200", "201-500", "500+"];
const emptyOrg = {
  organizationName: "", countryCode: "", state: "", timezone: "", currency: "", userRange: "", planId: "",
};

export default function OrganizationsManager() {
  const [orgs, setOrgs] = useState(null);
  const [plans, setPlans] = useState(null);
  const [form, setForm] = useState(emptyOrg);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const timezones = useMemo(() => getTimezones(), []);
  const currencyCodes = useMemo(() => getCurrencyCodes(), []);

  async function load() {
    try {
      const d = await api("/api/admin/organizations", "GET");
      setOrgs(d.organizations || []);
    } catch {
      setOrgs([]);
    }
  }
  async function loadPlans() {
    try {
      const d = await api("/api/admin/plans", "GET");
      setPlans((d.plans || []).filter((p) => p.active !== false));
    } catch {
      setPlans([]);
    }
  }
  useEffect(() => { load(); loadPlans(); }, []);

  function setField(field, value) {
    setForm((f) => (field === "countryCode" ? { ...f, countryCode: value, state: "" } : { ...f, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api("/api/admin/organizations", "POST", { action: "create", ...form });
      setForm(emptyOrg);
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  }

  async function remove(id) {
    if (!confirm("Delete this organization? This does not affect any real customer account.")) return;
    try {
      await api("/api/admin/organizations", "POST", { action: "delete", id });
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  if (orgs === null || plans === null) return <p className="muted">Loading…</p>;

  const statesForCountry = STATES_BY_COUNTRY[form.countryCode];

  return (
    <div style={{ display: "grid", gap: 24, gridTemplateColumns: "1.1fr 1fr" }}>
      <div className="card">
        <h3 style={{ marginBottom: 6 }}>Add Organization</h3>
        <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
          Provisions a placeholder organization record — this is separate from a real signed-up customer
          account. No login is created here; inviting an actual person still happens from that
          organization&apos;s own <code>/team</code> once it has an account.
        </p>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Organization Name *</label>
            <input
              className="input" value={form.organizationName}
              onChange={(e) => setField("organizationName", e.target.value)} required
            />
          </div>

          <div className="row" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Country *</label>
              <select
                className="input" value={form.countryCode}
                onChange={(e) => setField("countryCode", e.target.value)} required
              >
                <option value="" disabled>Select a country</option>
                {COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">State</label>
              {statesForCountry ? (
                <select className="input" value={form.state} onChange={(e) => setField("state", e.target.value)}>
                  <option value="">Select a state</option>
                  {statesForCountry.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="input" value={form.state} onChange={(e) => setField("state", e.target.value)}
                  placeholder={form.countryCode ? "State / Province" : "Select a country first"}
                  disabled={!form.countryCode}
                />
              )}
            </div>
          </div>

          <div className="row" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Time zone *</label>
              <select
                className="input" value={form.timezone}
                onChange={(e) => setField("timezone", e.target.value)} required
              >
                <option value="" disabled>Select a time zone</option>
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>{formatTimezoneLabel(tz)}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Currency *</label>
              <select
                className="input" value={form.currency}
                onChange={(e) => setField("currency", e.target.value)} required
              >
                <option value="" disabled>Select a currency</option>
                {currencyCodes.map((code) => (
                  <option key={code} value={code}>{formatCurrencyLabel(code)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="row" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="label">No of users *</label>
              <select
                className="input" value={form.userRange}
                onChange={(e) => setField("userRange", e.target.value)} required
              >
                <option value="" disabled>Select a range</option>
                {USER_RANGES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Profile *</label>
              <select
                className="input" value={form.planId}
                onChange={(e) => setField("planId", e.target.value)} required
              >
                <option value="" disabled>Select a plan</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {plans.length === 0 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
                  No plans configured yet — add Essential/Business/Premium (or your own) from the Plans tab first.
                </p>
              )}
            </div>
          </div>

          <button className="btn-primary" disabled={busy || plans.length === 0}>
            {busy ? "Adding…" : "Add organization"}
          </button>
          {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 14 }}>Organizations</h3>
        {orgs.length === 0 && <p className="muted">None added yet.</p>}
        {orgs.map((o) => (
          <div key={o.id} style={{ borderBottom: "1px solid var(--line)", padding: "12px 0" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{o.organizationName}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{o.planName}</span>
            </div>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              {[o.state, o.countryName].filter(Boolean).join(", ")} · {o.timezone} · {o.currency} · {o.userRange} users
            </p>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="link-btn danger" onClick={() => remove(o.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

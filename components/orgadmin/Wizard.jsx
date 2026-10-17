"use client";

// Step-by-step "Create organization" wizard. Same three admin-assisted modes
// and the same server action (provision) as before; only the presentation is
// split into steps with validation and a final review.
import { useMemo, useRef, useState } from "react";
import { COUNTRIES, STATES_BY_COUNTRY } from "@/lib/countries";
import { getTimezones, formatTimezoneLabel } from "@/lib/timezones";
import { getCurrencyCodes, formatCurrencyLabel } from "@/lib/currencies";
import { APPS } from "@/lib/appCatalog";
import { PROFILES } from "@/lib/roles";
import { api, MODES, LOGIN_LABEL, newId, blankForm, blankUser, Field, PersonFields, ResultPanel } from "./shared";

const INDUSTRIES = ["Retail", "Services", "Manufacturing", "Marine & Engineering", "Hospitality", "Healthcare", "Education", "Construction", "Technology", "Other"];
const PLAN_LABEL = { TRIAL: "Trial", PAID: "Paid", TEST: "Test (no trial limits, not billed)", INTERNAL: "Internal (Bizzux group company: free, no expiry)" };

export default function Wizard({ onCancel, onOpen, onCreated }) {
  const [form, setForm] = useState(blankForm);
  const [step, setStep] = useState(0);
  const requestId = useRef(newId());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [tzOptions, setTzOptions] = useState(null);

  const timezones = useMemo(() => getTimezones(), []);
  const currencyCodes = useMemo(() => getCurrencyCodes(), []);
  const needsAdmin = form.setupMode !== "ORG_ONLY";
  const mode = MODES.find((m) => m.id === form.setupMode);
  const states = STATES_BY_COUNTRY[form.countryCode];

  const steps = [
    ["type", "Setup type"], ["org", "Organization"], ["plan", "Plan & apps"],
    ...(needsAdmin ? [["admin", "Administrator"]] : []),
    ...(form.setupMode === "ORG_ADMIN_USERS" ? [["users", "Users"]] : []),
    ["review", "Review"],
  ];
  const cur = steps[Math.min(step, steps.length - 1)][0];

  const set = (k, v) => setForm((f) => (k === "countryCode" ? { ...f, countryCode: v, state: "" } : { ...f, [k]: v }));
  const setAdmin = (k, v) => setForm((f) => ({ ...f, admin: { ...f.admin, [k]: v } }));
  const setUser = (i, k, v) => setForm((f) => ({ ...f, users: f.users.map((u, j) => (j === i ? { ...u, [k]: v } : u)) }));
  const toggleApp = (id) => setForm((f) => {
    const apps = f.apps.includes(id) ? f.apps.filter((a) => a !== id) : [...f.apps, id];
    return { ...f, apps, users: f.users.map((u) => ({ ...u, apps: u.apps.filter((a) => apps.includes(a)) })) };
  });

  async function onCountry(code) {
    set("countryCode", code);
    setTzOptions(null);
    if (!code) return;
    try {
      const { Country } = await import("country-state-city");
      const c = Country.getCountryByCode(code);
      if (!c) return;
      const zones = (c.timezones || []).map((z) => z.zoneName);
      setForm((f) => (f.countryCode !== code ? f : {
        ...f, currency: currencyCodes.includes(c.currency) ? c.currency : f.currency, timezone: zones.length === 1 ? zones[0] : "",
      }));
      if (zones.length > 1) setTzOptions(zones);
    } catch { /* manual choice */ }
  }
  async function onState(name) {
    set("state", name);
    if (!name || !form.countryCode) return;
    const code = form.countryCode;
    try {
      const [{ State }, tzlookup] = await Promise.all([import("country-state-city"), import("tz-lookup")]);
      const st = State.getStatesOfCountry(code).find((x) => x.name === name);
      if (!st?.latitude) return;
      const zone = (tzlookup.default || tzlookup)(parseFloat(st.latitude), parseFloat(st.longitude));
      if (zone) setForm((f) => (f.countryCode === code && f.state === name ? { ...f, timezone: zone } : f));
    } catch { /* keep selection */ }
  }
  const tzList = (() => {
    const base = tzOptions || timezones;
    return form.timezone && !base.includes(form.timezone) ? [form.timezone, ...base] : base;
  })();

  const noExpiry = ["TEST", "INTERNAL"].includes(form.planType);

  // Per-step validation so people fix problems where they are, not at the end.
  function problem(which) {
    if (which === "org") {
      if (!form.organizationName.trim()) return "Organization name is required";
      if (!form.industry) return "Choose an industry / business category";
      if (!form.countryCode) return "Choose a country";
      if (!form.timezone) return "Choose a time zone";
      if (!form.currency) return "Choose a currency";
    }
    if (which === "plan") {
      if (!noExpiry && !form.expiryDate) return "Set the subscription expiry date";
      if (!(parseInt(form.licensedSeats, 10) >= 1)) return "Licensed seats must be at least 1";
      if (!form.apps.length) return "Select at least one application";
    }
    const person = (p, label) => {
      if (!p.fullName.trim()) return label + ": full name is required";
      if (p.loginMethod === "EMAIL_INVITE" && !p.email.trim()) return label + ": email is required for an invitation";
      if (p.loginMethod === "USERNAME_TEMP" && !p.username.trim()) return label + ": username is required";
      if (p.loginMethod === "USERNAME_TEMP" && p.passwordMode === "MANUAL" && p.password.length < 8) return label + ": password must be at least 8 characters";
      return "";
    };
    if (which === "admin") return person(form.admin, "Administrator");
    if (which === "users") {
      if (!form.users.length) return "Add at least one user, or go back and choose \"Organization + Admin\"";
      for (let i = 0; i < form.users.length; i++) { const m = person(form.users[i], "User " + (i + 1)); if (m) return m; }
      if (1 + form.users.length > parseInt(form.licensedSeats, 10)) return "Licensed seats is smaller than the number of people being created";
    }
    return "";
  }

  function next() {
    const m = problem(cur);
    if (m) { setErr(m); return; }
    setErr(""); setStep((s) => s + 1);
  }

  async function submit() {
    for (const [id] of steps) { const m = problem(id); if (m) { setErr(m); setStep(steps.findIndex(([x]) => x === id)); return; } }
    setErr(""); setBusy(true);
    try {
      const body = { action: "provision", requestId: requestId.current, ...form };
      if (!needsAdmin) { delete body.admin; delete body.users; }
      if (form.setupMode !== "ORG_ADMIN_USERS") delete body.users;
      const d = await api("/api/admin/organizations", "POST", body);
      setResult({ ...d, name: form.organizationName });
      requestId.current = newId();
      onCreated && onCreated();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  if (result) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Organization created</h3>
        <ResultPanel result={result} />
        <div className="row" style={{ gap: 12 }}>
          <button className="btn-primary" onClick={() => onOpen(result.organizationId)}>Open organization</button>
          <button className="link-btn" onClick={() => { setResult(null); setForm(blankForm()); setStep(0); setTzOptions(null); }}>Create another</button>
          <button className="link-btn" onClick={onCancel}>Back to directory</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>Create organization</h3>
        <button className="link-btn" onClick={onCancel}>Cancel</button>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", margin: "8px 0 14px" }}>
        {steps.map(([id, label], i) => (
          <span key={id} className="status-pill" style={{ opacity: i === step ? 1 : 0.55, fontWeight: i === step ? 700 : 400 }}>
            {i + 1}. {label}
          </span>
        ))}
      </div>

      {cur === "type" && (
        <div>
          <p className="muted" style={{ marginTop: 0 }}>
            Admin-assisted onboarding uses the same organization, membership, plan and app-access records as self-service sign-up.
            The plan is whatever you choose here, never copied from your own subscription.
          </p>
          {MODES.map((m) => (
            <label key={m.id} style={{ display: "block", padding: "8px 0" }}>
              <input type="radio" name="mode" checked={form.setupMode === m.id} onChange={() => { set("setupMode", m.id); setStep(0); }} style={{ marginRight: 8 }} />
              <strong>{m.label}</strong>
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                {{ ORG_ONLY: "Create the organization now; no sign-in is created.", ORG_ADMIN: "Also create its administrator's sign-in.", ORG_ADMIN_USERS: "Also create the administrator and a batch of users." }[m.id]}
              </span>
            </label>
          ))}
        </div>
      )}

      {cur === "org" && (
        <div>
          <Field label="Organization Name *"><input className="input" value={form.organizationName} onChange={(e) => set("organizationName", e.target.value)} /></Field>
          <div className="row">
            <Field label="Industry / Business Category *">
              <select className="input" value={form.industry} onChange={(e) => set("industry", e.target.value)}>
                <option value="" disabled>Select</option>
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="Country *">
              <select className="input" value={form.countryCode} onChange={(e) => onCountry(e.target.value)}>
                <option value="" disabled>Select a country</option>
                {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="State / Province / Region">
              {states ? (
                <select className="input" value={form.state} onChange={(e) => onState(e.target.value)}>
                  <option value="">Select</option>
                  {states.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : <input className="input" value={form.state} onChange={(e) => set("state", e.target.value)} disabled={!form.countryCode} />}
            </Field>
            <Field label="Time Zone *">
              <select className="input" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                <option value="" disabled>Select</option>
                {tzList.map((tz) => <option key={tz} value={tz}>{formatTimezoneLabel(tz)}</option>)}
              </select>
              {tzOptions && <span className="muted" style={{ fontSize: 12 }}>This country has several time zones — pick one.</span>}
            </Field>
            <Field label="Currency *">
              <select className="input" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                <option value="" disabled>Select</option>
                {currencyCodes.map((c) => <option key={c} value={c}>{formatCurrencyLabel(c)}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="Organization contact email"><input className="input" type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></Field>
            <Field label="Organization contact phone"><input className="input" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></Field>
          </div>
        </div>
      )}

      {cur === "plan" && (
        <div>
          <div className="row">
            <Field label="Subscription Plan *">
              <select className="input" value={form.planType} onChange={(e) => set("planType", e.target.value)}>
                {Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            {!noExpiry && <Field label="Subscription expiry *"><input className="input" type="date" value={form.expiryDate} onChange={(e) => set("expiryDate", e.target.value)} /></Field>}
            <Field label="Licensed Seats *"><input className="input" type="number" min="1" max="100000" value={form.licensedSeats} onChange={(e) => set("licensedSeats", e.target.value)} /></Field>
          </div>
          <label className="label">Application Access * <span className="muted" style={{ fontWeight: 400 }}>(none are selected by default)</span></label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
            {APPS.map((a) => (
              <label key={a.id} style={{ fontSize: 13 }}>
                <input type="checkbox" checked={form.apps.includes(a.id)} onChange={() => toggleApp(a.id)} style={{ marginRight: 5 }} />{a.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {cur === "admin" && <PersonFields p={form.admin} onChange={setAdmin} />}

      {cur === "users" && (
        <div>
          {form.users.map((u, i) => (
            <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <PersonFields p={u} onChange={(k, v) => setUser(i, k, v)} />
              <div className="row" style={{ marginTop: 8, alignItems: "flex-start" }}>
                <Field label="Role">
                  <select className="input" value={u.profile} onChange={(e) => setUser(i, "profile", e.target.value)}>
                    {PROFILES.map((p) => <option key={p.value} value={p.value}>{p.label || p.value}</option>)}
                  </select>
                </Field>
                <Field label="Apps (from the organization's selection)">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                    {APPS.filter((a) => form.apps.includes(a.id)).map((a) => (
                      <label key={a.id} style={{ fontSize: 12 }}>
                        <input type="checkbox" checked={u.apps.includes(a.id)} style={{ marginRight: 4 }}
                          onChange={() => setUser(i, "apps", u.apps.includes(a.id) ? u.apps.filter((x) => x !== a.id) : [...u.apps, a.id])} />
                        {a.name.replace("Bizzux ", "")}
                      </label>
                    ))}
                  </div>
                </Field>
              </div>
              <button type="button" className="link-btn danger" onClick={() => setForm((f) => ({ ...f, users: f.users.filter((_, j) => j !== i) }))}>Remove user</button>
            </div>
          ))}
          <button type="button" className="link-btn" onClick={() => setForm((f) => ({ ...f, users: [...f.users, blankUser()] }))}>+ Add user</button>
        </div>
      )}

      {cur === "review" && (
        <div style={{ fontSize: 14 }}>
          <p><strong>{form.organizationName}</strong> · {form.industry} · {COUNTRIES.find(([c]) => c === form.countryCode)?.[1]}{form.state ? ", " + form.state : ""}</p>
          <p className="muted" style={{ margin: "0 0 6px" }}>{form.timezone} · {form.currency}</p>
          <p style={{ margin: "0 0 6px" }}>Plan: <strong>{(PLAN_LABEL[form.planType] || "").split(" (")[0]}</strong>{noExpiry ? "" : " until " + form.expiryDate} · {form.licensedSeats} seats</p>
          <p style={{ margin: "0 0 6px" }}>Applications: {form.apps.map((a) => APPS.find((x) => x.id === a)?.name.replace("Bizzux ", "")).join(", ")}</p>
          {needsAdmin && <p style={{ margin: "0 0 6px" }}>Administrator: <strong>{form.admin.fullName}</strong> · {LOGIN_LABEL[form.admin.loginMethod]}{form.admin.username ? " · " + form.admin.username : ""}</p>}
          {form.setupMode === "ORG_ADMIN_USERS" && <p style={{ margin: "0 0 6px" }}>Users: {form.users.map((u) => u.fullName).join(", ")}</p>}
          <p className="muted" style={{ fontSize: 12 }}>You can change any of this later from the organization's details.</p>
        </div>
      )}

      {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
      <div className="row" style={{ gap: 12, marginTop: 14 }}>
        {step > 0 && <button type="button" className="link-btn" onClick={() => { setErr(""); setStep(step - 1); }}>Back</button>}
        {cur !== "review"
          ? <button type="button" className="btn-primary" onClick={next}>Next</button>
          : <button type="button" className="btn-primary" disabled={busy} onClick={submit}>{busy ? "Creating…" : mode.button}</button>}
      </div>
    </div>
  );
}

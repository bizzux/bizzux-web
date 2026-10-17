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
import { REQUESTER_LABEL, RESTRICTED_MAX_SEATS } from "@/lib/orgContacts";
import { api, MODES, LOGIN_LABEL, newId, blankForm, blankUser, Field, PersonFields, ResultPanel } from "./shared";

const INDUSTRIES = ["Retail", "Services", "Manufacturing", "Marine & Engineering", "Hospitality", "Healthcare", "Education", "Construction", "Technology", "Other"];
const BUSINESS_TYPES = ["Sole proprietorship", "Partnership", "Private limited company", "Public limited company", "LLP", "Non-profit / trust", "Other"];
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
    ["type", "Setup Type"], ["org", "Organization Details"], ["plan", "Subscription & Applications"],
    ["contacts", "Contacts & Administration"],
    ...(form.setupMode === "ORG_ADMIN_USERS" ? [["users", "Users"]] : []),
    ["review", "Review & Create"],
  ];
  const cur = steps[Math.min(step, steps.length - 1)][0];

  const set = (k, v) => setForm((f) => (k === "countryCode" ? { ...f, countryCode: v, state: "" } : { ...f, [k]: v }));
  const setAdmin = (k, v) => setForm((f) => ({ ...f, admin: { ...f.admin, [k]: v } }));
  const setReq = (k, v) => setForm((f) => ({ ...f, requester: { ...f.requester, [k]: v } }));
  const setOwner = (k, v) => setForm((f) => ({ ...f, businessOwner: { ...f.businessOwner, [k]: v } }));
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
    if (which === "contacts") {
      const r = form.requester;
      if (!r.type) return "Choose who requested this organization";
      if (!r.name.trim()) return "Requester: full name is required";
      if (!r.email.trim() && !r.phone.trim()) return "Requester: provide an email address or a phone number";
      if (form.ownerKnown === null) return "Say whether Business Owner details are available";
      if (form.ownerKnown && !form.businessOwner.name.trim()) return "Business Owner: full name is required";
      if (r.type === "employee_other" && form.planType !== "TRIAL") return "An employee / other contact can only start a Trial until their authority is verified (go back to Subscription)";
      if (r.type === "employee_other" && parseInt(form.licensedSeats, 10) > RESTRICTED_MAX_SEATS) return "Until verified, seats are limited to " + RESTRICTED_MAX_SEATS + " for an employee / other contact (go back to Subscription)";
      if (needsAdmin) {
        const a = form.admin;
        if (!form.requesterIsAdmin && !a.fullName.trim()) return "Administrator: full name is required";
        if (a.loginMethod === "EMAIL_INVITE" && !(a.email.trim() || (form.requesterIsAdmin && r.email.trim()))) return "Administrator: email is required for an invitation";
        if (a.loginMethod === "USERNAME_TEMP" && !a.username.trim()) return "Administrator: username is required";
        if (a.loginMethod === "USERNAME_TEMP" && a.passwordMode === "MANUAL" && a.password.length < 8) return "Administrator: password must be at least 8 characters";
      }
      return "";
    }
    const person = (p, label) => {
      if (!p.fullName.trim()) return label + ": full name is required";
      if (p.loginMethod === "EMAIL_INVITE" && !p.email.trim()) return label + ": email is required for an invitation";
      if (p.loginMethod === "USERNAME_TEMP" && !p.username.trim()) return label + ": username is required";
      if (p.loginMethod === "USERNAME_TEMP" && p.passwordMode === "MANUAL" && p.password.length < 8) return label + ": password must be at least 8 characters";
      return "";
    };
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
      if (!needsAdmin) { delete body.admin; delete body.users; body.requesterIsAdmin = false; }
      if (!form.ownerKnown) delete body.businessOwner;
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
            Bizzux-managed onboarding: you set the organization up for a customer. It uses the same organization, membership, plan and app-access records as self-service sign-up.
            You are recorded as the person who created it; you do not become the customer's owner or administrator.
            Customers who sign themselves up use the public sign-up page instead.
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
            <Field label="City"><input className="input" value={form.city} onChange={(e) => set("city", e.target.value)} /></Field>
            <Field label="Employee count (optional)"><input className="input" type="number" min="0" value={form.employeeCount} onChange={(e) => set("employeeCount", e.target.value)} /></Field>
            <Field label="Business type (optional)">
              <select className="input" value={form.businessType} onChange={(e) => set("businessType", e.target.value)}>
                <option value="">Select</option>
                {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="Business contact email (optional)"><input className="input" type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></Field>
            <Field label="Business contact phone (optional)"><input className="input" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></Field>
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

      {cur === "contacts" && (
        <div>
          <Section title="A. Requested by" hint="Who asked Bizzux for this organization? This is a contact record; it does not by itself give anyone access.">
            <Field label="Who requested this organization? *">
              <select className="input" value={form.requester.type} onChange={(e) => setReq("type", e.target.value)}>
                <option value="" disabled>Select</option>
                {Object.entries(REQUESTER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <div className="row">
              <Field label="Requester full name *"><input className="input" value={form.requester.name} onChange={(e) => setReq("name", e.target.value)} /></Field>
              <Field label="Job title (optional)"><input className="input" value={form.requester.jobTitle} onChange={(e) => setReq("jobTitle", e.target.value)} /></Field>
            </div>
            <div className="row">
              <Field label="Email"><input className="input" type="email" value={form.requester.email} onChange={(e) => setReq("email", e.target.value)} /></Field>
              <Field label="Phone"><input className="input" value={form.requester.phone} onChange={(e) => setReq("phone", e.target.value)} /></Field>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Provide at least an email or a phone number.</p>
            {form.requester.type === "manager" && <p className="muted" style={{ fontSize: 12 }}>Choosing Manager / Authorized Representative does not prove authority. Verification is tracked separately in section D.</p>}
            {form.requester.type === "employee_other" && <p className="muted" style={{ fontSize: 12 }}>Employees and other contacts get a restricted organization: Trial only, up to {RESTRICTED_MAX_SEATS} seats, until Bizzux verifies their authority.</p>}
          </Section>

          {needsAdmin && (
            <Section title="B. Primary Organization Admin" hint="The person who will sign in and administer the customer's account.">
              <label style={{ display: "block", fontSize: 14, marginBottom: 8 }}>
                <input type="checkbox" checked={form.requesterIsAdmin} onChange={(e) => set("requesterIsAdmin", e.target.checked)} style={{ marginRight: 8 }} />
                Requester is also the Primary Organization Admin
              </label>
              {form.requesterIsAdmin && <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Using {form.requester.name || "the requester"}'s name{form.requester.phone ? " and phone" : ""}; only the sign-in details are needed.</p>}
              <PersonFields p={form.admin} onChange={setAdmin} hideIdentity={form.requesterIsAdmin} />
            </Section>
          )}

          <Section title={needsAdmin ? "C. Business Owner" : "B. Business Owner"} hint="The business-ownership contact. They do not need a login, and this is optional.">
            <Field label="Are Business Owner details available? *">
              <div>
                <label style={{ marginRight: 18 }}><input type="radio" name="ownerKnown" checked={form.ownerKnown === true} onChange={() => set("ownerKnown", true)} style={{ marginRight: 6 }} />Yes — provide details</label>
                <label><input type="radio" name="ownerKnown" checked={form.ownerKnown === false} onChange={() => set("ownerKnown", false)} style={{ marginRight: 6 }} />No — provide later / unknown</label>
              </div>
            </Field>
            {form.ownerKnown === true && (
              <>
                {form.requester.type === "owner" && (
                  <button type="button" className="link-btn" onClick={() => set("businessOwner", { name: form.requester.name, email: form.requester.email, phone: form.requester.phone, jobTitle: form.requester.jobTitle })}>
                    The requester is the owner: copy their details
                  </button>
                )}
                <div className="row">
                  <Field label="Owner full name *"><input className="input" value={form.businessOwner.name} onChange={(e) => setOwner("name", e.target.value)} /></Field>
                  <Field label="Owner job title (optional)"><input className="input" value={form.businessOwner.jobTitle} onChange={(e) => setOwner("jobTitle", e.target.value)} /></Field>
                </div>
                <div className="row">
                  <Field label="Owner email"><input className="input" type="email" value={form.businessOwner.email} onChange={(e) => setOwner("email", e.target.value)} /></Field>
                  <Field label="Owner phone"><input className="input" value={form.businessOwner.phone} onChange={(e) => setOwner("phone", e.target.value)} /></Field>
                </div>
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>Recorded as declared, not verified. No sign-in is created for the owner.</p>
              </>
            )}
            {form.ownerKnown === false && <p className="muted" style={{ fontSize: 12, margin: 0 }}>The organization is created without a Business Owner. Nothing is guessed from the requester or administrator, and you can add one later.</p>}
          </Section>

          <Section title={needsAdmin ? "D. Authorization" : "C. Authorization"} hint="Whether Bizzux has confirmed this person's authority.">
            <p style={{ fontSize: 13, margin: 0 }}>
              {form.requester.type === "owner" && form.planType !== "PAID"
                ? "Not required for a trial at this stage."
                : "Starts as Pending Verification. A Bizzux Owner confirms authority before paid commitments, full control or any ownership transfer."}
            </p>
          </Section>
        </div>
      )}

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
          <p style={{ margin: "0 0 6px" }}>Requested by: <strong>{form.requester.name}</strong> ({REQUESTER_LABEL[form.requester.type]}{form.requester.jobTitle ? ", " + form.requester.jobTitle : ""}) · {form.requester.email || form.requester.phone}</p>
          {needsAdmin
            ? <p style={{ margin: "0 0 6px" }}>Primary Organization Admin: <strong>{form.requesterIsAdmin ? form.requester.name : form.admin.fullName}</strong>{form.requesterIsAdmin ? " (the requester)" : ""} · {LOGIN_LABEL[form.admin.loginMethod]}{form.admin.username ? " · " + form.admin.username : ""}</p>
            : <p style={{ margin: "0 0 6px" }}>Primary Organization Admin: <span className="muted">none yet</span></p>}
          <p style={{ margin: "0 0 6px" }}>Business Owner: {form.ownerKnown ? <strong>{form.businessOwner.name}</strong> : <span className="muted">Not provided</span>}{form.ownerKnown ? " (declared, not verified)" : ""}</p>
          <p style={{ margin: "0 0 6px" }}>Authorization: {form.requester.type === "owner" && form.planType !== "PAID" ? "Not required for now" : "Pending verification"}</p>
          <p style={{ margin: "0 0 6px" }}>Created by: <strong>you</strong> (recorded from your signed-in session)</p>
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

function Section({ title, hint, children }) {
  return (
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", margin: "0 0 12px" }}>
      <legend style={{ fontWeight: 700, fontSize: 14, padding: "0 6px" }}>{title}</legend>
      {hint && <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>{hint}</p>}
      {children}
    </fieldset>
  );
}

"use client";

// Super Admin -> Organizations. One "Create Organization" form with three
// setup modes, and a management list. All authorization is enforced by
// /api/admin/organizations (lib/orgProvisioning.js); this component only
// reflects it. Customer Admins on /profile keep using OrganizationsManager.
import { useEffect, useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import { COUNTRIES, STATES_BY_COUNTRY } from "@/lib/countries";
import { getTimezones, formatTimezoneLabel } from "@/lib/timezones";
import { getCurrencyCodes, formatCurrencyLabel } from "@/lib/currencies";
import { APPS } from "@/lib/appCatalog";
import { PROFILES } from "@/lib/roles";

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

const MODES = [
  { id: "ORG_ONLY", label: "Organization only", button: "Create Organization" },
  { id: "ORG_ADMIN", label: "Organization + Admin", button: "Create Organization & Admin" },
  { id: "ORG_ADMIN_USERS", label: "Organization + Admin + Users", button: "Create Organization, Admin & Users" },
];
const LOGIN_LABEL = { USERNAME_TEMP: "Username + one-time temporary password", EMAIL_INVITE: "Email invitation" };
const STATUS_LABEL = { active: "Active", suspended: "Suspended", archived: "Archived", pending: "Placeholder", pending_admin: "No administrator", expired: "Expired" };

const newId = () => (globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, "");
const plusDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const blankPerson = () => ({ fullName: "", email: "", phone: "", loginMethod: "USERNAME_TEMP", username: "", requirePasswordChange: true, passwordMode: "AUTO", password: "" });
const blankUser = () => ({ ...blankPerson(), profile: "Staff/Shopkeeper", apps: [] });
const blankForm = () => ({
  setupMode: "ORG_ADMIN", organizationName: "", industry: "", countryCode: "", state: "", timezone: "", currency: "",
  planType: "TRIAL", expiryDate: plusDays(30), licensedSeats: 5, apps: [], contactEmail: "", contactPhone: "",
  admin: blankPerson(), users: [],
});

export default function OrganizationsAdmin() {
  const [orgs, setOrgs] = useState(null);
  const [industries, setIndustries] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState(blankForm);
  const requestId = useRef(newId());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [listErr, setListErr] = useState("");
  const [managing, setManaging] = useState(null);

  const timezones = useMemo(() => getTimezones(), []);
  const currencyCodes = useMemo(() => getCurrencyCodes(), []);

  async function load() {
    try {
      const d = await api("/api/admin/organizations" + (showArchived ? "?archived=1" : ""), "GET");
      setOrgs(d.organizations || []);
      if (d.industries) setIndustries(d.industries);
      setListErr("");
    } catch (e) {
      setOrgs([]);
      setListErr(e.message);
    }
  }
  useEffect(() => { load(); }, [showArchived]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm((f) => (k === "countryCode" ? { ...f, countryCode: v, state: "" } : { ...f, [k]: v }));
  const setAdmin = (k, v) => setForm((f) => ({ ...f, admin: { ...f.admin, [k]: v } }));
  const setUser = (i, k, v) => setForm((f) => ({ ...f, users: f.users.map((u, j) => (j === i ? { ...u, [k]: v } : u)) }));
  const toggleApp = (id) => setForm((f) => {
    const on = f.apps.includes(id);
    const apps = on ? f.apps.filter((a) => a !== id) : [...f.apps, id];
    return { ...f, apps, users: f.users.map((u) => ({ ...u, apps: u.apps.filter((a) => apps.includes(a)) })) };
  });

  const mode = MODES.find((m) => m.id === form.setupMode);
  const needsAdmin = form.setupMode !== "ORG_ONLY";
  const states = STATES_BY_COUNTRY[form.countryCode];

  async function submit(e) {
    e.preventDefault();
    setErr(""); setResult(null); setBusy(true);
    try {
      const body = { action: "provision", requestId: requestId.current, ...form };
      if (!needsAdmin) { delete body.admin; delete body.users; }
      if (form.setupMode !== "ORG_ADMIN_USERS") delete body.users;
      const d = await api("/api/admin/organizations", "POST", body);
      setResult({ ...d, name: form.organizationName });
      setForm(blankForm());
      requestId.current = newId(); // a NEW organization gets a new id; retries of THIS one reuse it
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  }

  async function act(id, action, extra = {}, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    setListErr("");
    try {
      const d = await api("/api/admin/organizations", "POST", { action, id, ...extra });
      if (action === "resendInvite") alert("Invitation sent to " + d.email);
      await load();
    } catch (e2) {
      setListErr(e2.message);
    }
  }

  async function removeForever(o) {
    const typed = prompt(`Permanently delete "${o.name}"? This cannot be undone. Type the organization name to confirm:`);
    if (typed === null) return;
    await act(o.id, "deletePermanently", { confirmName: typed });
  }

  if (orgs === null) return <p className="muted">Loading…</p>;

  const visible = orgs.filter((o) =>
    !filter || [o.name, o.adminName, o.adminContact, o.industry].some((v) => String(v || "").toLowerCase().includes(filter.toLowerCase())));

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card">
        <h3 style={{ marginBottom: 5 }}>Create Organization</h3>
        <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
          Admin-assisted onboarding. Uses the same organization, membership, plan and app-access records as self-service
          sign-up. The plan is whatever you choose here, never copied from your own subscription.
        </p>

        {result && <ResultPanel result={result} onClose={() => setResult(null)} />}

        <form onSubmit={submit}>
          <div className="row" style={{ marginBottom: 14, flexWrap: "wrap", gap: 14 }}>
            {MODES.map((m) => (
              <label key={m.id} style={{ fontSize: 14 }}>
                <input type="radio" name="mode" checked={form.setupMode === m.id} onChange={() => set("setupMode", m.id)} style={{ marginRight: 6 }} />
                {m.label}
              </label>
            ))}
          </div>

          <Section title="Organization">
            <Field label="Organization Name *">
              <input className="input" value={form.organizationName} onChange={(e) => set("organizationName", e.target.value)} required />
            </Field>
            <div className="row">
              <Field label="Industry / Business Category *">
                <select className="input" value={form.industry} onChange={(e) => set("industry", e.target.value)} required>
                  <option value="" disabled>Select</option>
                  {industries.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
              <Field label="Country *">
                <select className="input" value={form.countryCode} onChange={(e) => set("countryCode", e.target.value)} required>
                  <option value="" disabled>Select a country</option>
                  {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select>
              </Field>
            </div>
            <div className="row">
              <Field label="State / Province / Region">
                {states ? (
                  <select className="input" value={form.state} onChange={(e) => set("state", e.target.value)}>
                    <option value="">Select</option>
                    {states.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input className="input" value={form.state} onChange={(e) => set("state", e.target.value)} disabled={!form.countryCode} />
                )}
              </Field>
              <Field label="Time Zone *">
                <select className="input" value={form.timezone} onChange={(e) => set("timezone", e.target.value)} required>
                  <option value="" disabled>Select</option>
                  {timezones.map((tz) => <option key={tz} value={tz}>{formatTimezoneLabel(tz)}</option>)}
                </select>
              </Field>
              <Field label="Currency *">
                <select className="input" value={form.currency} onChange={(e) => set("currency", e.target.value)} required>
                  <option value="" disabled>Select</option>
                  {currencyCodes.map((c) => <option key={c} value={c}>{formatCurrencyLabel(c)}</option>)}
                </select>
              </Field>
            </div>
            <div className="row">
              <Field label="Organization contact email">
                <input className="input" type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
              </Field>
              <Field label="Organization contact phone">
                <input className="input" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Subscription Plan & Application Access">
            <div className="row">
              <Field label="Subscription Plan *">
                <select className="input" value={form.planType} onChange={(e) => set("planType", e.target.value)}>
                  <option value="TRIAL">Trial</option>
                  <option value="PAID">Paid</option>
                </select>
              </Field>
              <Field label="Subscription expiry *">
                <input className="input" type="date" value={form.expiryDate} onChange={(e) => set("expiryDate", e.target.value)} required />
              </Field>
              <Field label="Licensed Seats *">
                <input className="input" type="number" min="1" max="100000" value={form.licensedSeats} onChange={(e) => set("licensedSeats", e.target.value)} required />
              </Field>
            </div>
            <label className="label">Application Access * <span className="muted" style={{ fontWeight: 400 }}>(none are selected by default)</span></label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginBottom: 6 }}>
              {APPS.map((a) => (
                <label key={a.id} style={{ fontSize: 13 }}>
                  <input type="checkbox" checked={form.apps.includes(a.id)} onChange={() => toggleApp(a.id)} style={{ marginRight: 5 }} />
                  {a.name}
                </label>
              ))}
            </div>
          </Section>

          {needsAdmin && (
            <Section title="Organization Admin">
              <PersonFields p={form.admin} onChange={setAdmin} />
            </Section>
          )}

          {form.setupMode === "ORG_ADMIN_USERS" && (
            <Section title="Users">
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
                            <input type="checkbox" checked={u.apps.includes(a.id)}
                              onChange={() => setUser(i, "apps", u.apps.includes(a.id) ? u.apps.filter((x) => x !== a.id) : [...u.apps, a.id])}
                              style={{ marginRight: 4 }} />
                            {a.name.replace("Bizzux ", "")}
                          </label>
                        ))}
                      </div>
                    </Field>
                  </div>
                  <button type="button" className="link-btn danger" onClick={() => setForm((f) => ({ ...f, users: f.users.filter((_, j) => j !== i) }))}>
                    Remove user
                  </button>
                </div>
              ))}
              <button type="button" className="link-btn" onClick={() => setForm((f) => ({ ...f, users: [...f.users, blankUser()] }))}>
                + Add user
              </button>
            </Section>
          )}

          <button className="btn-primary" disabled={busy || !form.apps.length}>{busy ? "Creating…" : mode.button}</button>
          {!form.apps.length && <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>Select at least one application</span>}
          {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
        </form>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0 }}>Organizations</h3>
          <div className="row" style={{ gap: 12 }}>
            <input className="input" style={{ width: 220 }} placeholder="Search name, admin, industry" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <label className="muted" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ marginRight: 5 }} />
              Show archived
            </label>
          </div>
        </div>
        {listErr && <p className="error">{listErr}</p>}
        {visible.length === 0 && <p className="muted">No organizations.</p>}
        <div style={{ overflowX: "auto" }}>
          {visible.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                  <th>Organization</th><th>Administrator</th><th>Plan</th><th>Users</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => (
                  <OrgRow key={o.id} o={o} open={managing === o.id}
                    onManage={() => setManaging(managing === o.id ? null : o.id)}
                    act={act} removeForever={removeForever} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function OrgRow({ o, open, onManage, act, removeForever }) {
  const seats = o.licensedSeats != null ? `${o.activeUsers} / ${o.licensedSeats} seats`
    : o.kind === "placeholder" ? (o.estimatedUsers ? `Est. ${o.estimatedUsers}` : "—")
    : `${o.activeUsers}${o.estimatedUsers ? ` (est. ${o.estimatedUsers})` : ""}`;
  const status = STATUS_LABEL[o.status] || o.status;
  const kind = { "self-service": "Self-service", "admin-provisioned": "Admin-provisioned", placeholder: "Placeholder" }[o.kind];
  return (
    <>
      <tr style={{ borderBottom: "1px solid var(--line)", verticalAlign: "top" }}>
        <td style={{ padding: "8px 8px 8px 0" }}>
          <strong>{o.name}</strong>
          <div className="muted" style={{ fontSize: 12 }}>{[kind, o.industry, o.country].filter(Boolean).join(" · ")}</div>
        </td>
        <td>
          {o.adminName || <span className="muted">Unassigned</span>}
          <div className="muted" style={{ fontSize: 12 }}>{o.adminContact}</div>
        </td>
        <td>{o.planLabel}{o.expiresAt && <div className="muted" style={{ fontSize: 12 }}>to {o.expiresAt.slice(0, 10)}</div>}</td>
        <td>{seats}</td>
        <td>
          {status}
          {o.awaitingActivation && <div className="muted" style={{ fontSize: 12 }}>Awaiting first login</div>}
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          {o.internal ? <span className="muted">Internal</span> : (
            <>
              {o.editable && o.kind === "admin-provisioned" && <button className="link-btn" onClick={onManage}>Manage</button>}{" "}
              {o.adminLoginMethod === "EMAIL_INVITE" && o.awaitingActivation !== false && (
                <button className="link-btn" onClick={() => act(o.id, "resendInvite")}>Resend invite</button>
              )}{" "}
              {o.status === "suspended" || o.status === "archived"
                ? <button className="link-btn" onClick={() => act(o.id, "reactivate", {}, `Reactivate ${o.name}?`)}>Reactivate</button>
                : <button className="link-btn" onClick={() => act(o.id, "suspend", {}, `Suspend ${o.name}? Its users are signed out and blocked until reactivated.`)}>Suspend</button>}{" "}
              {o.status !== "archived" && o.kind !== "placeholder" &&
                <button className="link-btn" onClick={() => act(o.id, "archive", {}, `Archive ${o.name}? It is suspended and hidden from this list; data is kept.`)}>Archive</button>}{" "}
              {(o.status === "archived" || o.status === "pending" || o.status === "pending_admin") &&
                <button className="link-btn danger" onClick={() => removeForever(o)}>Delete permanently</button>}
            </>
          )}
        </td>
      </tr>
      {open && (
        <tr><td colSpan={6}><ManagePanel o={o} act={act} /></td></tr>
      )}
    </>
  );
}

function ManagePanel({ o, act }) {
  const [apps, setApps] = useState(o.apps || []);
  const [planType, setPlanType] = useState(o.planType || "TRIAL");
  const [seats, setSeats] = useState(o.licensedSeats || 1);
  const [expiry, setExpiry] = useState(o.expiresAt ? o.expiresAt.slice(0, 10) : plusDays(30));
  return (
    <div style={{ background: "var(--line, #f1f5f9)", borderRadius: 8, padding: 12, margin: "6px 0 10px" }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <Field label="Plan">
          <select className="input" value={planType} onChange={(e) => setPlanType(e.target.value)}>
            <option value="TRIAL">Trial</option><option value="PAID">Paid</option>
          </select>
        </Field>
        <Field label="Licensed Seats"><input className="input" type="number" min="1" value={seats} onChange={(e) => setSeats(e.target.value)} /></Field>
        <Field label="Expiry"><input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 8 }}>
        {APPS.map((a) => (
          <label key={a.id} style={{ fontSize: 13 }}>
            <input type="checkbox" checked={apps.includes(a.id)}
              onChange={() => setApps(apps.includes(a.id) ? apps.filter((x) => x !== a.id) : [...apps, a.id])} style={{ marginRight: 5 }} />
            {a.name}
          </label>
        ))}
      </div>
      <button className="btn-primary" disabled={!apps.length}
        onClick={() => act(o.id, "updateEntitlements", { apps, planType, licensedSeats: seats, expiryDate: expiry })}>
        Save access &amp; plan
      </button>
      <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>Removing an app immediately blocks it for every user in this organization.</p>
    </div>
  );
}

function ResultPanel({ result, onClose }) {
  return (
    <div style={{ background: "var(--line, #f1f5f9)", borderRadius: 8, padding: 12, marginBottom: 14 }}>
      <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 13 }}>
        {result.replay ? "This organization was already created by an earlier attempt — nothing was duplicated." : `Organization created: ${result.name}`}
      </p>
      {result.credentials?.length > 0 && (
        <>
          <p className="muted" style={{ margin: "0 0 6px", fontSize: 12 }}>
            One-time temporary credentials — shown once, never stored. Where "require password change" was on, each person must choose a new password at first login (within 72 hours).
          </p>
          {result.credentials.map((c, i) => (
            <p key={i} style={{ margin: "0 0 2px", fontFamily: "monospace", fontSize: 13 }}>
              {c.role} · {c.fullName} — username: {c.username} · {c.temporaryPassword ? "password: " + c.temporaryPassword : "password: set by you (not shown)"}
            </p>
          ))}
        </>
      )}
      {result.invites?.map((inv, i) => (
        <p key={i} style={{ margin: "4px 0 0", fontSize: 13 }}>
          Invitation to {inv.email}: {inv.sent ? "sent" : `NOT sent (${inv.error}) — use Resend invite in the list`}
        </p>
      ))}
      <button type="button" className="link-btn" onClick={onClose} style={{ marginTop: 8 }}>Dismiss</button>
    </div>
  );
}

function PersonFields({ p, onChange }) {
  return (
    <>
      <div className="row">
        <Field label="Full name *"><input className="input" value={p.fullName} onChange={(e) => onChange("fullName", e.target.value)} required /></Field>
        <Field label={p.loginMethod === "EMAIL_INVITE" ? "Email *" : "Email (contact)"}>
          <input className="input" type="email" value={p.email} onChange={(e) => onChange("email", e.target.value)} required={p.loginMethod === "EMAIL_INVITE"} />
        </Field>
        <Field label="Phone"><input className="input" value={p.phone} onChange={(e) => onChange("phone", e.target.value)} /></Field>
      </div>
      <div className="row">
        <Field label="Login provisioning method *">
          <select className="input" value={p.loginMethod} onChange={(e) => onChange("loginMethod", e.target.value)}>
            {Object.entries(LOGIN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {p.loginMethod === "USERNAME_TEMP" && (
          <Field label="Username *">
            <input className="input" value={p.username} onChange={(e) => onChange("username", e.target.value)} placeholder="e.g. acme.admin" required />
          </Field>
        )}
      </div>
      {p.loginMethod === "USERNAME_TEMP" && (
        <div className="row">
          <Field label="Password">
            <select className="input" value={p.passwordMode} onChange={(e) => onChange("passwordMode", e.target.value)}>
              <option value="AUTO">Auto-generate</option>
              <option value="MANUAL">Set manually</option>
            </select>
          </Field>
          {p.passwordMode === "MANUAL" && (
            <Field label="Password * (min 8 characters)">
              <input className="input" type="text" autoComplete="off" value={p.password} onChange={(e) => onChange("password", e.target.value)} minLength={8} required />
            </Field>
          )}
        </div>
      )}
      {p.loginMethod === "USERNAME_TEMP" && (
        <label style={{ fontSize: 13, display: "block", marginTop: 2 }}>
          <input type="checkbox" checked={p.requirePasswordChange} onChange={(e) => onChange("requirePasswordChange", e.target.checked)} style={{ marginRight: 6 }} />
          Require password change at first login
        </label>
      )}
      <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
        {p.loginMethod === "USERNAME_TEMP"
          ? (p.passwordMode === "MANUAL" ? "The password you type is stored only as a hash and is not shown again. " : "A random password is generated and shown to you once. ") + (p.requirePasswordChange
            ? "They must set their own at first login, within 72 hours."
            : "They may keep it or change it whenever they like; it does not expire.")
          : "They receive an email link to set their own password; no password is generated."}
      </p>
    </>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{title}</h4>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ flex: 1, marginBottom: 10, minWidth: 160 }}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

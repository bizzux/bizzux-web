"use client";

// Shared pieces for Super Admin -> Organizations (directory, wizard, details).
import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { COUNTRIES, STATES_BY_COUNTRY } from "@/lib/countries";
import { getTimezones, formatTimezoneLabel } from "@/lib/timezones";
import { getCurrencyCodes, formatCurrencyLabel } from "@/lib/currencies";
import { APPS } from "@/lib/appCatalog";
import { PROFILES } from "@/lib/roles";

export async function api(path, method, body) {
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

export const MODES = [
  { id: "ORG_ONLY", label: "Organization only", button: "Create Organization" },
  { id: "ORG_ADMIN", label: "Organization + Admin", button: "Create Organization & Admin" },
  { id: "ORG_ADMIN_USERS", label: "Organization + Admin + Users", button: "Create Organization, Admin & Users" },
];
export const LOGIN_LABEL = { USERNAME_TEMP: "Username + one-time temporary password", EMAIL_INVITE: "Email invitation" };
export const STATUS_LABEL = { active: "Active", suspended: "Suspended", archived: "Archived", pending: "Placeholder", pending_admin: "No administrator", expired: "Expired" };

export const newId = () => (globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, "");
export const plusDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
export const blankPerson = () => ({ fullName: "", email: "", phone: "", loginMethod: "USERNAME_TEMP", username: "", requirePasswordChange: true, passwordMode: "AUTO", password: "" });
export const blankUser = () => ({ ...blankPerson(), profile: "Staff/Shopkeeper", apps: [] });
export const blankForm = () => ({
  setupMode: "ORG_ADMIN", organizationName: "", industry: "", countryCode: "", state: "", timezone: "", currency: "",
  planType: "TRIAL", expiryDate: plusDays(30), licensedSeats: 5, apps: [], contactEmail: "", contactPhone: "",
  admin: blankPerson(), users: [],
});

export const orgCall = (id, action, extra) => api("/api/admin/organizations", "POST", { action, id, ...extra });

export function UsersTab({ o, reload }) {
  const readOnly = !!o.readOnly;
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState(null);

  async function load() {
    try {
      // readOnly = not an admin-managed organization (e.g. self-service): view only.
      setData(readOnly ? await api("/api/admin/org-directory?id=" + o.id + "&section=users", "GET") : await orgCall(o.id, "listUsers"));
      setErr("");
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [o.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn) {
    setErr("");
    try { await fn(); await load(); reload(); } catch (e) { setErr(e.message); }
  }

  async function reset(u) {
    const typed = prompt(`Reset password for ${u.name} (${u.username}).\nType a new password (min 8 characters), or leave blank to auto-generate:`);
    if (typed === null) return;
    const must = confirm("Require them to change it at first login?\nOK = yes (expires in 72 hours), Cancel = no (they may keep it).");
    await run(async () => {
      const d = await orgCall(o.id, "resetUserPassword", { uid: u.uid, password: typed, requirePasswordChange: must });
      setSecret({ name: u.name, ...d });
    });
  }

  if (!data) return <p className="muted">{err || "Loading users…"}</p>;
  return (
    <div>
      {err && <p className="error">{err}</p>}
      {secret && (
        <div style={{ background: "#fff", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Password reset for {secret.name}</p>
          {!secret.invite && <p style={{ margin: "4px 0 0", fontFamily: "monospace", fontSize: 13 }}>
            username: {secret.username} · {secret.temporaryPassword ? "password: " + secret.temporaryPassword : "password: the one you typed (not shown)"}
          </p>}
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            {secret.invite ? (secret.invite.sent ? "Invitation email sent." : "Invitation NOT sent (" + secret.invite.error + ") — use Resend invite.") : "Shown once, never stored. " + (secret.mustChangePassword ? "They must set their own at first login." : "They may keep it.")}
          </p>
          <button type="button" className="link-btn" onClick={() => setSecret(null)}>Dismiss</button>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, margin: "0 0 6px" }}>
        {data.users.length} user{data.users.length === 1 ? "" : "s"}{data.seats ? ` of ${data.seats} licensed seats` : ""}. {readOnly ? "" : "Click a person to edit, reset or remove them."}
      </p>
      {data.users.map((u) => (
        <div key={u.uid} style={{ background: "#fff", borderRadius: 8, marginBottom: 6, border: sel === u.uid ? "1px solid #0e9aa7" : "1px solid transparent" }}>
          <button type="button" onClick={() => setSel(sel === u.uid ? null : u.uid)}
            style={{ width: "100%", textAlign: "left", background: "none", border: 0, padding: "10px 12px", cursor: "pointer", font: "inherit" }}>
            <strong>{u.name || "(no name)"}</strong>{" "}
            <span className="muted" style={{ fontSize: 12 }}>
              {u.isAdmin ? (u.profile === "Organization Owner" ? "Organization Owner" : "Organization Admin") : u.profile} · {u.username ? "username: " + u.username : u.email || "email login"}
              {u.mustChangePassword ? " · awaiting first login" : ""}{u.locked ? " · locked" : ""}{u.disabled || u.status === "disabled" ? " · disabled" : ""}
            </span>
          </button>
          {sel === u.uid && !readOnly && (
            <UserEditor o={o} u={u} data={data} run={run} reset={reset} onDone={() => setSel(null)} />
          )}
        </div>
      ))}
      {readOnly ? <p className="muted" style={{ fontSize: 12 }}>This organization manages its own users (self-service). Use the sign-in &amp; security controls below to help its owner.</p> : adding
        ? <AddUser o={o} data={data} onCancel={() => setAdding(false)} onAdded={(d) => { setAdding(false); setSecret(d.credential ? { name: d.credential.fullName, username: d.credential.username, temporaryPassword: d.credential.temporaryPassword, mustChangePassword: d.credential.mustChangePassword } : (d.invite ? { name: d.invite.email, username: "", invite: d.invite } : null)); load(); reload(); }} />
        : <button type="button" className="link-btn" onClick={() => setAdding(true)}>+ Add user</button>}
    </div>
  );
}

export function UserEditor({ o, u, data, run, reset, onDone }) {
  const [f, setF] = useState({ fullName: u.name, email: u.email, phone: u.phone, profile: u.profile, apps: u.apps });
  const disabled = u.disabled || u.status === "disabled";
  const apps = APPS.filter((a) => data.enabledApps.includes(a.id));
  return (
    <div style={{ padding: "0 12px 12px" }}>
      <div className="row">
        <Field label="Full name (fix spelling here)"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      </div>
      {!u.isAdmin && (
        <Field label="Role">
          <select className="input" value={f.profile} onChange={(e) => setF({ ...f, profile: e.target.value })}>
            {PROFILES.map((p) => <option key={p.value} value={p.value}>{p.label || p.value}</option>)}
          </select>
        </Field>
      )}
      <label className="label">Applications</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 10 }}>
        {apps.map((a) => (
          <label key={a.id} style={{ fontSize: 13 }}>
            <input type="checkbox" checked={f.apps.includes(a.id)} style={{ marginRight: 5 }}
              onChange={() => setF({ ...f, apps: f.apps.includes(a.id) ? f.apps.filter((x) => x !== a.id) : [...f.apps, a.id] })} />
            {a.name}
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
        <button type="button" className="btn-primary"
          onClick={() => run(async () => { await orgCall(o.id, "updateUser", { uid: u.uid, ...f }); onDone(); })}>
          Save changes
        </button>
        {u.hasUsernameLogin && <button type="button" className="link-btn" onClick={() => reset(u)}>Reset password</button>}
        {!u.isAdmin && (
          <button type="button" className="link-btn" onClick={() => run(() => orgCall(o.id, "setUserDisabled", { uid: u.uid, disabled: !disabled }))}>
            {disabled ? "Enable" : "Disable"}
          </button>
        )}
        {!u.isAdmin && (
          <button type="button" className="link-btn danger"
            onClick={() => { if (confirm(`Delete ${u.name}? Their login and data are permanently removed.`)) run(() => orgCall(o.id, "deleteUser", { uid: u.uid })); }}>
            Delete user
          </button>
        )}
      </div>
      {u.isAdmin && (
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
          The administrator can be edited and reset but not deleted — the organization belongs to this login. To block them, use Suspend on the organization.
        </p>
      )}
    </div>
  );
}

export function AddUser({ o, data, onCancel, onAdded }) {
  const [u, setU] = useState({ ...blankUser(), apps: [] });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const apps = APPS.filter((a) => data.enabledApps.includes(a.id));
  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try { onAdded(await orgCall(o.id, "addUser", { user: u })); } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  return (
    <form onSubmit={save} style={{ background: "#fff", borderRadius: 8, padding: 12 }}>
      <PersonFields p={u} onChange={(k, v) => setU({ ...u, [k]: v })} />
      <div className="row" style={{ marginTop: 8 }}>
        <Field label="Role">
          <select className="input" value={u.profile} onChange={(e) => setU({ ...u, profile: e.target.value })}>
            {PROFILES.map((p) => <option key={p.value} value={p.value}>{p.label || p.value}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 10 }}>
        {apps.map((a) => (
          <label key={a.id} style={{ fontSize: 13 }}>
            <input type="checkbox" checked={u.apps.includes(a.id)} style={{ marginRight: 5 }}
              onChange={() => setU({ ...u, apps: u.apps.includes(a.id) ? u.apps.filter((x) => x !== a.id) : [...u.apps, a.id] })} />
            {a.name}
          </label>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Adding…" : "Add user"}</button>{" "}
      <button type="button" className="link-btn" onClick={onCancel}>Cancel</button>
    </form>
  );
}

export function DetailsTab({ o, reload }) {
  const timezones = useMemo(() => getTimezones(), []);
  const currencyCodes = useMemo(() => getCurrencyCodes(), []);
  const [f, setF] = useState({
    organizationName: o.name || "", industry: o.industry || "", countryCode: o.countryCode || "", state: o.state || "",
    city: o.city || "", timezone: o.timezone || "", currency: o.currency || "", contactEmail: o.contactEmail || "", contactPhone: o.contactPhone || "",
  });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const states = STATES_BY_COUNTRY[f.countryCode];
  const tzList = f.timezone && !timezones.includes(f.timezone) ? [f.timezone, ...timezones] : timezones;
  async function save() {
    setErr(""); setMsg("");
    try { await orgCall(o.id, "updateDetails", f); setMsg("Saved."); reload(); } catch (e) { setErr(e.message); }
  }
  return (
    <div>
      <Field label="Organization Name"><input className="input" value={f.organizationName} onChange={(e) => setF({ ...f, organizationName: e.target.value })} /></Field>
      <div className="row">
        <Field label="Industry">
          <select className="input" value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })}>
            <option value="">Select</option>
            {["Retail", "Services", "Manufacturing", "Marine & Engineering", "Hospitality", "Healthcare", "Education", "Construction", "Technology", "Other"].map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="Country">
          <select className="input" value={f.countryCode} onChange={(e) => setF({ ...f, countryCode: e.target.value, state: "" })}>
            {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </Field>
        <Field label="State / Province / Region">
          {states
            ? <select className="input" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="">Select</option>{states.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            : <input className="input" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />}
        </Field>
      </div>
      <div className="row">
        <Field label="City"><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        <Field label="Time Zone">
          <select className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
            {tzList.map((tz) => <option key={tz} value={tz}>{formatTimezoneLabel(tz)}</option>)}
          </select>
        </Field>
        <Field label="Currency">
          <select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            {currencyCodes.map((c) => <option key={c} value={c}>{formatCurrencyLabel(c)}</option>)}
          </select>
        </Field>
      </div>
      <div className="row">
        <Field label="Organization contact email"><input className="input" type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
        <Field label="Organization contact phone"><input className="input" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
      </div>
      <button type="button" className="btn-primary" onClick={save}>Save details</button>
      {msg && <span className="muted" style={{ marginLeft: 10 }}>{msg}</span>}
      {err && <p className="error">{err}</p>}
      <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>To fix the administrator's name or contact details, open the Users tab and click the administrator.</p>
    </div>
  );
}

export function PlanTab({ o, act }) {
  const [apps, setApps] = useState(o.apps || []);
  const [planType, setPlanType] = useState(o.planType || "TRIAL");
  const [seats, setSeats] = useState(o.licensedSeats || 1);
  const [expiry, setExpiry] = useState(o.expiresAt ? o.expiresAt.slice(0, 10) : plusDays(30));
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <Field label="Plan">
          <select className="input" value={planType} onChange={(e) => setPlanType(e.target.value)}>
            {o.planType === "INTERNAL"
              ? <option value="INTERNAL">Internal</option>
              : <><option value="TRIAL">Trial</option><option value="PAID">Paid</option><option value="TEST">Test</option></>}
          </select>
        </Field>
        <Field label="Licensed Seats"><input className="input" type="number" min="1" value={seats} onChange={(e) => setSeats(e.target.value)} /></Field>
        {!["TEST", "INTERNAL"].includes(planType) && <Field label="Expiry"><input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>}
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

export function ResultPanel({ result, onClose }) {
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
      {onClose && <button type="button" className="link-btn" onClick={onClose} style={{ marginTop: 8 }}>Dismiss</button>}
    </div>
  );
}

export function PersonFields({ p, onChange }) {
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

export function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{title}</h4>
      {children}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div style={{ flex: 1, marginBottom: 10, minWidth: 160 }}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

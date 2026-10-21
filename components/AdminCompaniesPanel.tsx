"use client";

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { APPS } from "@/lib/appCatalog";
import { COUNTRIES } from "@/lib/countries";
import { PROFILES } from "@/lib/roles";

// Platform Admin: Company Directory, Create/Edit Company, Company Details
// (profile, entitlements, users, credentials, audit) and a cross-company
// User Directory. All data comes from /api/admin/companies,
// /api/admin/username-users and /api/admin/audit-logs, which enforce the
// real permissions; this UI only reflects them.

type Company = { id: string; name: string; companyCode: string | null; industry: string | null; status: string; planType: string | null; expiresAt: string | null; allowedUsers: number | null };
type User = { uid: string; username: string; name: string; organizationId: string; company: string; role: string; status: string; locked: boolean; apps?: string[]; lastLoginAt: string | null };
type Log = { id: string; action: string; actorEmail?: string; targetId?: string; details: any; createdAt: string | null };

const INDUSTRIES = ["Retail", "Services", "Manufacturing", "Marine & Engineering", "Hospitality", "Healthcare", "Education", "Construction", "Technology", "Other"];
const input = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-brand-blue";
const btn = "px-3 py-1.5 rounded-md text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50";
const btnPrimary = "px-4 py-2 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-brand-tealDark to-brand-blueDark disabled:opacity-60";
const badge = (s: string) => ({ active: "bg-green-100 text-green-800", suspended: "bg-red-100 text-red-800", expired: "bg-amber-100 text-amber-800", "pending activation": "bg-amber-100 text-amber-800" } as Record<string, string>)[s] || "bg-slate-100 text-slate-700";
const appName = (id: string) => APPS.find((a) => a.id === id)?.name.replace("Bizzux ", "") || id;
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

async function api(path: string, body?: any) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
}

function AppChecks({ value, onChange, only }: { value: string[]; onChange: (v: string[]) => void; only?: string[] }) {
  const list = APPS.filter((a) => !only || only.includes(a.id));
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {list.map((a) => (
        <label key={a.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(a.id)} onChange={(e) => onChange(e.target.checked ? [...value, a.id] : value.filter((x) => x !== a.id))} />
          {a.name.replace("Bizzux ", "")}
        </label>
      ))}
      {!list.length && <p className="text-sm text-slate-500 col-span-full">No applications are enabled for this company.</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>{children}</div>;
}

export default function AdminCompaniesPanel() {
  const [view, setView] = useState<"companies" | "users">("companies");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState<{ label: string; username: string; password: string } | null>(null);

  async function load() {
    try { setCompanies((await api("/api/admin/companies?q=" + encodeURIComponent(q))).companies || []); setError(""); }
    catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-4">
      {secret && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-semibold mb-1">{secret.label} — shown once. Hand these over securely; the user must change the password at first sign-in.</p>
          <p>Username: <code className="font-mono">{secret.username}</code> &nbsp; Password: <code className="font-mono">{secret.password}</code></p>
          <div className="mt-2 flex gap-2">
            <button className={btn} onClick={() => navigator.clipboard?.writeText(`Username: ${secret.username}\nTemporary password: ${secret.password}`)}>Copy</button>
            <button className={btn} onClick={() => setSecret(null)}>I&apos;ve saved it</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        {(["companies", "users"] as const).map((v) => (
          <button key={v} className={`${btn} ${view === v ? "!bg-slate-800 !text-white" : ""}`} onClick={() => { setView(v); setSelected(null); setCreating(false); }}>
            {v === "companies" ? "Companies" : "User directory"}
          </button>
        ))}
      </div>

      {view === "users" && <UserDirectory companies={companies} onSecret={setSecret} />}

      {view === "companies" && creating && (
        <CompanyForm onCancel={() => setCreating(false)} onCreated={(r: any, name: string) => {
          setCreating(false); load();
          setSecret({ label: `Company ${name} created (code ${r.companyCode})`, username: r.ownerUsername, password: r.ownerPassword });
          setSelected(r.id);
        }} />
      )}

      {view === "companies" && !creating && selected && (
        <CompanyDetails id={selected} onBack={() => { setSelected(null); load(); }} onSecret={setSecret} />
      )}

      {view === "companies" && !creating && !selected && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-2 mb-3">
            <input className={`${input} max-w-xs`} placeholder="Search name, code or industry" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
            <button className={btn} onClick={load}>Search</button>
            <button className={`${btnPrimary} ml-auto`} onClick={() => setCreating(true)}>Create company</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-2">Company</th><th>Code</th><th>Industry</th><th>Plan</th><th>Expires</th><th>Users</th><th>Status</th></tr></thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(c.id)}>
                    <td className="py-2 font-medium">{c.name}</td><td>{c.companyCode}</td><td>{c.industry || "—"}</td><td>{c.planType || "—"}</td>
                    <td>{day(c.expiresAt)}</td><td>{c.allowedUsers ?? "—"}</td>
                    <td><span className={`px-2 py-0.5 rounded-full text-xs ${badge(c.status)}`}>{c.status}</span></td>
                  </tr>
                ))}
                {!companies.length && <tr><td colSpan={7} className="py-6 text-center text-slate-500">No admin-provisioned companies yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function CompanyForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (r: any, name: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<any>({ name: "", companyCode: "", industry: "Services", businessType: "", address: "", city: "", state: "", countryCode: "IN", phone: "", email: "", planType: "TRIAL", startDate: today, expiryDate: "", allowedUsers: 10, apps: [], owner: { fullName: "", username: "", phone: "", email: "", password: "" } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const setO = (k: string, v: any) => setF((p: any) => ({ ...p, owner: { ...p.owner, [k]: v } }));
  async function submit(e: any) {
    e.preventDefault(); setBusy(true); setErr("");
    try { onCreated(await api("/api/admin/companies", { action: "create", ...f }), f.name); }
    catch (x: any) { setErr(x.message); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
      <h2 className="text-lg font-bold">Create company</h2>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Company name *"><input className={input} value={f.name} onChange={(e) => set("name", e.target.value)} required /></Field>
        <Field label="Company code (blank = auto)"><input className={input} value={f.companyCode} onChange={(e) => set("companyCode", e.target.value)} /></Field>
        <Field label="Industry"><select className={input} value={f.industry} onChange={(e) => set("industry", e.target.value)}>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</select></Field>
        <Field label="Business type"><input className={input} placeholder="Retail, Services, Manufacturing…" value={f.businessType} onChange={(e) => set("businessType", e.target.value)} /></Field>
        <Field label="Country"><select className={input} value={f.countryCode} onChange={(e) => set("countryCode", e.target.value)}>{COUNTRIES.map(([c, n]: any) => <option key={c} value={c}>{n}</option>)}</select></Field>
        <Field label="State"><input className={input} value={f.state} onChange={(e) => set("state", e.target.value)} /></Field>
        <Field label="City"><input className={input} value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="Address"><input className={input} value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Company phone (unverified until OTP)"><input className={input} value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Company email (optional)"><input className={input} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">Subscription</h3>
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label="Plan"><select className={input} value={f.planType} onChange={(e) => set("planType", e.target.value)}><option value="TRIAL">Trial</option><option value="PAID">Paid</option></select></Field>
          <Field label="Start"><input className={input} type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} required /></Field>
          <Field label="Expiry *"><input className={input} type="date" value={f.expiryDate} onChange={(e) => set("expiryDate", e.target.value)} required /></Field>
          <Field label="Allowed users"><input className={input} type="number" min={1} value={f.allowedUsers} onChange={(e) => set("allowedUsers", e.target.value)} /></Field>
        </div>
      </div>
      <div><h3 className="text-sm font-semibold mb-2">Enabled applications *</h3><AppChecks value={f.apps} onChange={(v) => set("apps", v)} /></div>
      <div>
        <h3 className="text-sm font-semibold mb-2">Company owner (signs in with a Bizzux username — no email needed)</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Full name *"><input className={input} value={f.owner.fullName} onChange={(e) => setO("fullName", e.target.value)} required /></Field>
          <Field label="Username * (e.g. arun.ocean001)"><input className={input} value={f.owner.username} onChange={(e) => setO("username", e.target.value)} required autoCapitalize="none" /></Field>
          <Field label="Initial password (blank = generate)"><input className={input} value={f.owner.password} onChange={(e) => setO("password", e.target.value)} /></Field>
          <Field label="Owner mobile (optional)"><input className={input} value={f.owner.phone} onChange={(e) => setO("phone", e.target.value)} /></Field>
          <Field label="Owner email (optional)"><input className={input} type="email" value={f.owner.email} onChange={(e) => setO("email", e.target.value)} /></Field>
        </div>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2"><button className={btnPrimary} disabled={busy}>{busy ? "Creating…" : "Create company"}</button><button type="button" className={btn} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function CompanyDetails({ id, onBack, onSecret }: { id: string; onBack: () => void; onSecret: (s: any) => void }) {
  const [data, setData] = useState<any>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [apps, setApps] = useState<string[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(false);
  const [editApps, setEditApps] = useState<{ uid: string; apps: string[] } | null>(null);

  async function load() {
    try {
      const [c, u, a] = await Promise.all([api("/api/admin/companies?id=" + id), api("/api/admin/username-users?organizationId=" + id), api("/api/admin/audit-logs?organizationId=" + id)]);
      setData(c); setApps(c.enabledApps); setUsers(u.users); setLogs(a.logs); setErr("");
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  const act = async (body: any) => { try { const r = await api("/api/admin/companies", { id, ...body }); await load(); return r; } catch (e: any) { setErr(e.message); } };
  if (!data) return <p className="text-sm text-slate-500">{err || "Loading…"}</p>;
  const c = data.company;
  const status = c.companyStatus || "active";

  return (
    <div className="space-y-4">
      <button className={btn} onClick={onBack}>← All companies</button>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-bold">{c.organizationName}</h2>
          <span className={`px-2 py-0.5 rounded-full text-xs ${badge(status)}`}>{status}</span>
          <div className="ml-auto flex gap-2">
            {status === "active"
              ? <button className={btn} onClick={() => window.confirm("Suspend this company? Nobody in it can open apps or sign in with a username.") && act({ action: "setStatus", status: "suspended" })}>Suspend</button>
              : <button className={btn} onClick={() => act({ action: "setStatus", status: "active" })}>Activate</button>}
            {status !== "expired" && <button className={btn} onClick={() => act({ action: "setStatus", status: "expired" })}>Mark expired</button>}
            <button className={btn} onClick={() => setEdit({ industry: c.industry || "", businessType: c.businessType || "", address: c.address || "", city: c.city || "", state: c.state || "", phone: c.phone || "", allowedUsers: c.allowedUsers || 1, planType: c.planType || "TRIAL", expiryDate: c.trialEndDate ? c.trialEndDate.slice(0, 10) : "" })}>Edit</button>
          </div>
        </div>
        <dl className="grid sm:grid-cols-4 gap-3 mt-4 text-sm">
          {[["Code", c.companyCode], ["Industry", c.industry], ["Business type", c.businessType], ["Location", [c.city, c.state, c.country].filter(Boolean).join(", ")],
            ["Phone", c.phone ? `${c.phone} (${c.phoneVerified ? "verified" : "unverified"})` : "—"], ["Plan", c.planType], ["Subscription", `${day(c.trialStartDate)} → ${day(c.trialEndDate)}`],
            ["Users", `${data.userCount} of ${c.allowedUsers ?? "∞"}`], ["Owner", c.owner ? `${c.owner.name} (${c.owner.username})` : "—"]].map(([k, v]) => (
            <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{(v as string) || "—"}</dd></div>))}
        </dl>
      </div>

      {edit && (
        <form className="rounded-xl border border-slate-200 bg-white p-5 grid sm:grid-cols-4 gap-3" onSubmit={async (e) => { e.preventDefault(); await act({ action: "update", ...edit }); setEdit(null); }}>
          {["industry", "businessType", "address", "city", "state", "phone"].map((k) => <Field key={k} label={k}><input className={input} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></Field>)}
          <Field label="Allowed users"><input className={input} type="number" min={1} value={edit.allowedUsers} onChange={(e) => setEdit({ ...edit, allowedUsers: e.target.value })} /></Field>
          <Field label="Plan"><select className={input} value={edit.planType} onChange={(e) => setEdit({ ...edit, planType: e.target.value })}><option value="TRIAL">Trial</option><option value="PAID">Paid</option></select></Field>
          <Field label="Expiry"><input className={input} type="date" value={edit.expiryDate} onChange={(e) => setEdit({ ...edit, expiryDate: e.target.value })} /></Field>
          <div className="flex items-end gap-2"><button className={btnPrimary}>Save</button><button type="button" className={btn} onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="font-semibold mb-1">Application entitlements</h3>
        <p className="text-xs text-slate-500 mb-3">Turning an app off immediately removes it from every user in this company.</p>
        <AppChecks value={apps} onChange={setApps} />
        <button className={`${btn} mt-3`} onClick={() => act({ action: "setApps", apps })}>Save entitlements</button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center mb-3"><h3 className="font-semibold">Users &amp; credentials</h3><button className={`${btn} ml-auto`} onClick={() => setLinking(true)}>Link existing user</button><button className={btn + " ml-2"} onClick={() => setAdding(true)}>Add user</button></div>
        {linking && <LinkUser orgId={id} enabled={data.enabledApps} onDone={() => { setLinking(false); load(); }} />}
        {adding && <AddUser orgId={id} enabled={data.enabledApps} onDone={(r) => { setAdding(false); if (r) onSecret({ label: "User created", username: r.username, password: r.password }); load(); }} />}
        <UserTable users={users} onChanged={load} onSecret={onSecret} showApps onEditApps={(u) => setEditApps({ uid: u.uid, apps: u.apps || [] })} />
        {editApps && (
          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium mb-2">Applications for this user (company-enabled only)</p>
            <AppChecks value={editApps.apps} only={data.enabledApps} onChange={(v) => setEditApps({ ...editApps, apps: v })} />
            <div className="mt-2 flex gap-2">
              <button className={btn} onClick={async () => { try { await api("/api/admin/username-users", { action: "setApps", uid: editApps.uid, apps: editApps.apps }); setEditApps(null); load(); } catch (e: any) { setErr(e.message); } }}>Save</button>
              <button className={btn} onClick={() => setEditApps(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="font-semibold mb-3">Audit history</h3>
        <ul className="divide-y divide-slate-100 text-sm max-h-80 overflow-y-auto">
          {logs.map((l) => <li key={l.id} className="py-2 flex gap-3"><span className="text-xs text-slate-500 w-40 shrink-0">{l.createdAt ? new Date(l.createdAt).toLocaleString() : ""}</span><span className="font-mono text-xs w-52 shrink-0">{l.action}</span><span className="text-slate-600 truncate">{l.actorEmail || "—"} {l.details?.username ? `· ${l.details.username}` : ""}{l.details?.apps ? ` · ${[].concat(l.details.apps).map(appName).join(", ")}` : ""}{l.details?.status ? ` · ${l.details.status}` : ""}</span></li>)}
          {!logs.length && <li className="py-3 text-slate-500">No events yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function AddUser({ orgId, enabled, onDone }: { orgId: string; enabled: string[]; onDone: (r?: any) => void }) {
  const [f, setF] = useState<any>({ fullName: "", username: "", profile: "Staff/Shopkeeper", employeeId: "", department: "", branch: "", designation: "", mobile: "", employmentType: "Employee", accountExpiresAt: "", apps: [] });
  const [err, setErr] = useState("");
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  return (
    <form className="mb-4 rounded-lg border border-slate-200 p-3 grid sm:grid-cols-4 gap-3" onSubmit={async (e) => { e.preventDefault(); try { onDone(await api("/api/admin/username-users", { action: "create", organizationId: orgId, ...f })); } catch (x: any) { setErr(x.message); } }}>
      <Field label="Full name *"><input className={input} value={f.fullName} onChange={(e) => set("fullName", e.target.value)} required /></Field>
      <Field label="Username *"><input className={input} value={f.username} onChange={(e) => set("username", e.target.value)} required autoCapitalize="none" /></Field>
      <Field label="Role"><select className={input} value={f.profile} onChange={(e) => set("profile", e.target.value)}>{PROFILES.map((p: any) => <option key={p.value}>{p.value}</option>)}</select></Field>
      <Field label="Mobile"><input className={input} value={f.mobile} onChange={(e) => set("mobile", e.target.value)} /></Field>
      <Field label="Employee ID"><input className={input} value={f.employeeId} onChange={(e) => set("employeeId", e.target.value)} /></Field>
      <Field label="Department"><input className={input} value={f.department} onChange={(e) => set("department", e.target.value)} /></Field>
      <Field label="Branch"><input className={input} value={f.branch} onChange={(e) => set("branch", e.target.value)} /></Field>
      <Field label="Designation"><input className={input} value={f.designation} onChange={(e) => set("designation", e.target.value)} /></Field>
      <Field label="Employment type"><select className={input} value={f.employmentType} onChange={(e) => set("employmentType", e.target.value)}>{["Employee", "Contractor", "Other"].map((t) => <option key={t}>{t}</option>)}</select></Field>
      <Field label="Access ends on (optional)"><input type="date" className={input} value={f.accountExpiresAt} onChange={(e) => set("accountExpiresAt", e.target.value)} /></Field>
      <div className="sm:col-span-4"><AppChecks value={f.apps} only={enabled} onChange={(v) => set("apps", v)} /></div>
      {err && <p className="text-sm text-red-600 sm:col-span-4">{err}</p>}
      <div className="sm:col-span-4 flex gap-2"><button className={btnPrimary}>Create user</button><button type="button" className={btn} onClick={() => onDone()}>Cancel</button></div>
    </form>
  );
}

function UserTable({ users, onChanged, onSecret, showApps, onEditApps }: { users: User[]; onChanged: () => void; onSecret: (s: any) => void; showApps?: boolean; onEditApps?: (u: User) => void }) {
  const [err, setErr] = useState("");
  async function act(u: User, action: string) {
    if (action === "suspend" && !window.confirm(`Suspend ${u.username}? They are signed out and cannot sign in.`)) return;
    if (action === "resetPassword" && !window.confirm(`Reset password for ${u.username}? Their current password and sessions stop working.`)) return;
    try {
      const r = await api("/api/admin/username-users", { action, uid: u.uid });
      if (action === "resetPassword") onSecret({ label: "Password reset", username: u.username, password: r.password });
      onChanged();
    } catch (e: any) { setErr(e.message); }
  }
  return (
    <div className="overflow-x-auto">
      {err && <p className="text-sm text-red-600">{err}</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500"><th className="py-2">User</th><th>Company</th><th>Role</th>{showApps && <th>Apps</th>}<th>Status</th><th>Last sign-in</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.uid} className="border-t border-slate-100">
              <td className="py-2"><div className="font-medium">{u.name}</div><div className="text-xs text-slate-500 font-mono">{u.username}</div></td>
              <td>{u.company}</td><td>{u.role}</td>
              {showApps && <td className="text-xs">{(u.apps || []).map(appName).join(", ") || "—"}</td>}
              <td><span className={`px-2 py-0.5 rounded-full text-xs ${badge(u.status)}`}>{u.status}</span>{u.locked && <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800">locked</span>}</td>
              <td className="text-xs">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "never"}</td>
              <td className="text-right whitespace-nowrap space-x-1">
                {onEditApps && <button className={btn} onClick={() => onEditApps(u)}>Apps</button>}
                <button className={btn} onClick={() => act(u, "resetPassword")}>Reset password</button>
                {u.locked && <button className={btn} onClick={() => act(u, "unlock")}>Unlock</button>}
                {u.status === "suspended" ? <button className={btn} onClick={() => act(u, "activate")}>Activate</button> : <button className={btn} onClick={() => act(u, "suspend")}>Suspend</button>}
              </td>
            </tr>
          ))}
          {!users.length && <tr><td colSpan={7} className="py-6 text-center text-slate-500">No username users.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function UserDirectory({ companies, onSecret }: { companies: Company[]; onSecret: (s: any) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState(""); const [co, setCo] = useState(""); const [role, setRole] = useState(""); const [st, setSt] = useState("");
  const [err, setErr] = useState("");
  async function load() { try { setUsers((await api("/api/admin/username-users")).users); setErr(""); } catch (e: any) { setErr(e.message); } }
  useEffect(() => { load(); }, []);
  const shown = useMemo(() => users.filter((u) =>
    (!co || u.organizationId === co) && (!role || u.role === role) && (!st || u.status === st || (st === "locked" && u.locked)) &&
    (!q || (u.name + u.username + u.company).toLowerCase().includes(q.toLowerCase()))), [users, q, co, role, st]);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${input} max-w-xs`} placeholder="Search name, username, company" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${input} max-w-[12rem]`} value={co} onChange={(e) => setCo(e.target.value)}><option value="">All companies</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className={`${input} max-w-[10rem]`} value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{["Owner", ...PROFILES.map((p: any) => p.value)].map((r) => <option key={r}>{r}</option>)}</select>
        <select className={`${input} max-w-[10rem]`} value={st} onChange={(e) => setSt(e.target.value)}><option value="">Any status</option><option value="active">active</option><option value="pending activation">pending activation</option><option value="suspended">suspended</option><option value="locked">locked</option></select>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <p className="text-xs text-slate-500">Filter by application from a company&apos;s detail page.</p>
      <UserTable users={shown} onChanged={load} onSecret={onSecret} />
    </div>
  );
}

// One login, several companies: attaches an existing username user to this
// company with its own role and apps (they then get a company switcher).
function LinkUser({ orgId, enabled, onDone }: { orgId: string; enabled: string[]; onDone: () => void }) {
  const [f, setF] = useState<any>({ username: "", profile: "Staff/Shopkeeper", apps: [] });
  const [err, setErr] = useState("");
  return (
    <form className="mb-4 rounded-lg border border-slate-200 p-3 grid sm:grid-cols-3 gap-3" onSubmit={async (e) => { e.preventDefault(); try { await api("/api/admin/username-users", { action: "linkUser", organizationId: orgId, ...f }); onDone(); } catch (x: any) { setErr(x.message); } }}>
      <Field label="Existing username *"><input className={input} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required autoCapitalize="none" /></Field>
      <Field label="Role in this company"><select className={input} value={f.profile} onChange={(e) => setF({ ...f, profile: e.target.value })}>{PROFILES.map((p: any) => <option key={p.value}>{p.value}</option>)}</select></Field>
      <div className="sm:col-span-3"><AppChecks value={f.apps} only={enabled} onChange={(v) => setF({ ...f, apps: v })} /></div>
      {err && <p className="text-sm text-red-600 sm:col-span-3">{err}</p>}
      <div className="sm:col-span-3 flex gap-2"><button className={btnPrimary}>Link user</button><button type="button" className={btn} onClick={onDone}>Cancel</button></div>
    </form>
  );
}

"use client";
// "Add a user": Microsoft-style slide-over wizard (Basics, Apps & licences, Optional settings, Review and finish) over the Active users list.
// Reuses the existing server paths: a new username login goes through the shared IAM service, an invitation through /api/team "invite",
// and an existing login through a link request the person must accept. The server re-validates everything at Finish.
import { useEffect, useMemo, useRef, useState } from "react";
import Drawer from "./Drawer";
import { APPS } from "@/lib/appCatalog";
import { PROFILES } from "@/lib/roles";
import { passwordStrength } from "@/lib/adminPassword";

const STEPS = ["Basics", "Apps & licences", "Optional settings", "Review and finish"];
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const METHODS = [
  { id: "username", title: "Bizzux username and password", hint: "For someone with no email. You hand over a temporary password; no email address is invented." },
  { id: "invite", title: "Invite by email (Google or email)", hint: "They get an invitation and sign in with their own Google or email account. An existing Bizzux account is attached, never duplicated." },
  { id: "link", title: "Link an existing Bizzux user", hint: "They already have a Bizzux username login (for example from another company). They must accept before they join." },
];
const EMPLOYMENT = ["", "Full-time", "Part-time", "Contractor", "Intern"];
const blank = (method) => ({
  method, first: "", last: "", display: "", displayTouched: false, username: "", usernameTouched: false, autoPw: false, password: "", showPw: false, mustChange: true,
  email: "", linkUsername: "", apps: [], noApps: false, orgRole: "MEMBER", profile: "Staff/Shopkeeper", appRoles: {},
  contact: { jobTitle: "", department: "", employmentType: "", office: "", officePhone: "", mobilePhone: "", streetAddress: "", city: "", state: "", zip: "", country: "" },
  employeeId: "", branch: "", accountExpiresAt: "",
});
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
const appName = (id) => APPS.find((a) => a.id === id)?.name || id;

export default function AddUserWizard({ open, method: initialMethod = "username", api, directory, canAssignAdmin, onClose, onCreated, onManage }) {
  const [f, setF] = useState(() => blank(initialMethod));
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState(false);
  const [uCheck, setUCheck] = useState({ state: "idle", message: "" });
  const [server, setServer] = useState({ checking: false, problems: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [openSec, setOpenSec] = useState({ roles: true, profile: false, info: false });
  const key = useRef("");
  const mounted = useRef(false);

  useEffect(() => {
    if (!open) { mounted.current = false; return; }
    if (mounted.current) return;
    mounted.current = true;
    setF(blank(initialMethod)); setStep(0); setTried(false); setUCheck({ state: "idle", message: "" }); setServer({ checking: false, problems: [] }); setError(""); setResult(null); setBusy(false);
    key.current = (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "k" + Date.now() + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  }, [open, initialMethod]);

  const set = (patch) => setF((c) => ({ ...c, ...patch }));
  const setContact = (patch) => setF((c) => ({ ...c, contact: { ...c.contact, ...patch } }));
  // Display name follows First + Last until the administrator types their own; the username suggestion follows the name until edited.
  const onName = (patch) => setF((c) => {
    const n = { ...c, ...patch };
    if (!n.displayTouched) n.display = [n.first, n.last].filter(Boolean).join(" ");
    if (!n.usernameTouched && n.method === "username") n.username = slug([n.first, n.last].filter(Boolean).join(" ")).slice(0, 32);
    return n;
  });

  // Live username availability (platform-wide namespace), debounced.
  useEffect(() => {
    if (!open || f.method !== "username") return undefined;
    const u = f.username.trim().toLowerCase();
    if (!u) { setUCheck({ state: "idle", message: "" }); return undefined; }
    if (!USERNAME_RE.test(u)) { setUCheck({ state: "bad", message: "3 to 32 letters, numbers, dots, dashes or underscores. No spaces or @." }); return undefined; }
    setUCheck({ state: "checking", message: "Checking…" });
    const t = setTimeout(() => {
      api("/api/iam/identities?checkUsername=" + encodeURIComponent(u), "GET")
        .then((d) => setUCheck(d.ok ? { state: "ok", message: "“" + u + "” is available" } : { state: "bad", message: d.problem }))
        .catch(() => setUCheck({ state: "idle", message: "" }));
    }, 400);
    return () => clearTimeout(t);
  }, [f.username, f.method, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const strength = passwordStrength(f.password);
  const held = new Set(directory?.enabledApps || []);
  const seats = directory?.seats;

  // ---- per-step validation (advisory; the server re-checks) ----
  const basics = useMemo(() => {
    const p = {};
    if (!f.display.trim()) p.display = "Display name is required.";
    if (f.method === "username") {
      if (!f.username.trim()) p.username = "Choose a username.";
      else if (uCheck.state === "bad") p.username = uCheck.message;
      else if (uCheck.state === "checking") p.username = "Wait for the username check to finish.";
      if (!f.autoPw) { if (!f.password) p.password = "Enter a temporary password or choose automatic."; else if (!strength.ok) p.password = "Choose a stronger password (at least 8 characters with a mix of letters, numbers or symbols)."; }
    } else if (f.method === "invite") {
      if (!f.first.trim()) p.first = "First name is required.";
      if (!EMAIL_RE.test(f.email.trim())) p.email = "Enter a valid email address.";
    } else if (!USERNAME_RE.test(f.linkUsername.trim().toLowerCase())) p.linkUsername = "Enter their exact Bizzux username.";
    return p;
  }, [f, uCheck, strength.ok]);
  const stepProblems = [basics, {}, {}, {}][step] || {};
  const canNext = Object.keys(stepProblems).length === 0;

  // Final server-side validation when the Review step opens (username method; the other methods are validated by their own routes at Finish).
  useEffect(() => {
    if (!open || step !== 3 || f.method !== "username") return;
    let live = true;
    setServer({ checking: true, problems: [] });
    api("/api/iam/identities", "POST", { kind: "validate", fullName: f.display, username: f.username.trim().toLowerCase(), password: f.autoPw ? "" : f.password, apps: f.apps, appRoles: f.appRoles, orgRole: f.orgRole })
      .then((d) => live && setServer({ checking: false, problems: d.problems || [] }))
      .catch((e) => live && setServer({ checking: false, problems: [{ field: "server", message: e.message }] }));
    return () => { live = false; setServer((c) => (c.checking ? { ...c, checking: false } : c)); };
  }, [step, open, f.method]); // eslint-disable-line react-hooks/exhaustive-deps

  const goNext = () => { setTried(true); if (!canNext) return; setTried(false); setStep((s) => Math.min(3, s + 1)); };
  const goTo = (i) => { if (i < step) setStep(i); };

  async function finish() {
    setBusy(true); setError("");
    try {
      const apps = f.noApps ? [] : f.apps;
      if (f.method === "username") {
        const c = f.contact;
        const r = await api("/api/iam/identities", "POST", {
          kind: "username", idempotencyKey: key.current, fullName: f.display.trim(), username: f.username.trim().toLowerCase(), password: f.autoPw ? "" : f.password,
          mustChangePassword: f.mustChange, profile: f.profile, apps, appRoles: f.appRoles, orgRole: f.orgRole, employeeId: f.employeeId, branch: f.branch,
          department: c.department, designation: c.jobTitle, mobile: c.mobilePhone, employmentType: c.employmentType === "Contractor" ? "Contractor" : "Employee",
          accountExpiresAt: f.accountExpiresAt, contactInfo: c,
        });
        setResult({ kind: "username", username: r.username, password: r.password, apps, orgRole: f.orgRole, appRoles: f.appRoles, reused: !!r.reused });
      } else if (f.method === "invite") {
        const r = await api("/api/team", "POST", {
          action: "invite", firstName: f.first.trim(), lastName: f.last.trim(), email: f.email.trim().toLowerCase(), profile: f.profile, role: f.contact.jobTitle,
          loginMethod: "email", apps: apps.map((appId) => ({ appId, role: f.appRoles[appId] === "ADMIN" ? "ADMIN" : "MEMBER" })), contactInfo: f.contact,
        });
        setResult({ kind: "invite", email: f.email.trim().toLowerCase(), apps, detail: r });
      } else {
        await api("/api/iam/identities", "POST", { kind: "link", username: f.linkUsername.trim().toLowerCase(), profile: f.profile, apps });
        setResult({ kind: "link", username: f.linkUsername.trim().toLowerCase(), apps });
      }
      onCreated?.();
    } catch (e) { setError(e.message || "Could not create the user."); }
    setBusy(false);
  }

  const toggleApp = (id) => setF((c) => {
    const on = c.apps.includes(id);
    const apps = on ? c.apps.filter((x) => x !== id) : [...c.apps, id];
    const appRoles = { ...c.appRoles }; if (on) delete appRoles[id];
    return { ...c, apps, appRoles, noApps: false };
  });

  const show = (k) => (tried ? stepProblems[k] : undefined);

  const body = result ? <Done r={result} onManage={onManage} onClose={onClose} onAnother={() => { setF(blank(f.method)); setStep(0); setResult(null); setTried(false); key.current = key.current + "n"; }} /> : (
    <div className="adm-wiz">
      <ol className="adm-stepper" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "cur" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>
            <button type="button" disabled={i >= step} onClick={() => goTo(i)}><span className="dot" aria-hidden="true">{i < step ? "✓" : ""}</span><span>{s}</span></button>
          </li>
        ))}
      </ol>
      <div className="adm-wizmain">
        {step === 0 && (
          <section aria-labelledby="w0">
            <h3 id="w0">Set up the basics</h3>
            <p className="muted">To get started, fill out some basic information about who you are adding.</p>
            <fieldset className="adm-methods"><legend className="adm-lab">How will they sign in?</legend>
              {METHODS.map((m) => (
                <label key={m.id} className={"adm-radio" + (f.method === m.id ? " on" : "")}>
                  <input type="radio" name="method" checked={f.method === m.id} onChange={() => set({ method: m.id, usernameTouched: false })} />
                  <span><b>{m.title}</b><span className="adm-hint">{m.hint}</span></span>
                </label>
              ))}
            </fieldset>
            {f.method !== "link" && (
              <div className="adm-grid">
                <Field label="First name" required={f.method === "invite"} error={show("first")}><input className="input" data-autofocus value={f.first} onChange={(e) => onName({ first: e.target.value })} /></Field>
                <Field label="Last name"><input className="input" value={f.last} onChange={(e) => onName({ last: e.target.value })} /></Field>
              </div>
            )}
            <Field label="Display name" required error={show("display")} wide><input className="input" value={f.display} onChange={(e) => set({ display: e.target.value, displayTouched: true })} /></Field>
            {f.method === "username" && (
              <>
                <Field label="Username" required error={show("username") || (uCheck.state === "bad" ? uCheck.message : undefined)} wide
                  hint={uCheck.state === "ok" ? undefined : "Unique across Bizzux. Suggested from the name."}>
                  <input className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={f.username} onChange={(e) => set({ username: e.target.value.toLowerCase(), usernameTouched: true })} aria-invalid={uCheck.state === "bad"} />
                  {uCheck.state === "ok" && <div className="adm-ok" role="status">✓ {uCheck.message}</div>}
                  {uCheck.state === "checking" && <div className="adm-hint" role="status">Checking…</div>}
                </Field>
                <label className="adm-check"><input type="checkbox" checked={f.autoPw} onChange={(e) => set({ autoPw: e.target.checked, password: "" })} /> Automatically create a password</label>
                {!f.autoPw && (
                  <Field label="Temporary password" required error={show("password")} wide hint="At least 8 characters; your company's password policy is checked again when you finish.">
                    <div className="adm-pw">
                      <input className="input" type={f.showPw ? "text" : "password"} autoComplete="new-password" value={f.password} onChange={(e) => set({ password: e.target.value })} aria-describedby="pwmeter" />
                      <button type="button" className="adm-link" onClick={() => set({ showPw: !f.showPw })}>{f.showPw ? "Hide" : "Show"}</button>
                    </div>
                    <div id="pwmeter" className={"adm-meter l" + strength.level} role="status"><span /><span /><span /><em>{strength.label}</em></div>
                  </Field>
                )}
                <label className="adm-check"><input type="checkbox" checked={f.mustChange} onChange={(e) => set({ mustChange: e.target.checked })} /> Require this user to change their password when they first sign in</label>
              </>
            )}
            {f.method === "invite" && <Field label="Email" required error={show("email")} wide hint="The invitation is sent here. Never a made-up address."><input className="input" type="email" autoCapitalize="none" value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>}
            {f.method === "link" && <Field label="Their exact Bizzux username" required error={show("linkUsername")} wide hint="They keep one login and must accept your request after signing in."><input className="input" data-autofocus autoCapitalize="none" value={f.linkUsername} onChange={(e) => set({ linkUsername: e.target.value.toLowerCase() })} /></Field>}
          </section>
        )}
        {step === 1 && (
          <section aria-labelledby="w1">
            <h3 id="w1">Assign apps</h3>
            <p className="muted">Choose the Bizzux applications this person can open. Their identity is created once; giving access to another app later never creates a second login.</p>
            {seats && <p className="adm-seats">Company seats: <b>{seats.used}</b> in use{seats.allowed ? <> of <b>{seats.allowed}</b></> : " (no limit set)"}</p>}
            <label className={"adm-radio" + (!f.noApps ? " on" : "")}><input type="radio" name="apps" checked={!f.noApps} onChange={() => set({ noApps: false })} /><span><b>Give access to apps</b></span></label>
            <ul className="adm-apps" aria-label="Applications">
              {APPS.map((a) => {
                const isHeld = held.has(a.id);
                return (
                  <li key={a.id} className={isHeld ? "" : "off"}>
                    <label>
                      <input type="checkbox" disabled={!isHeld || f.noApps} checked={f.apps.includes(a.id)} onChange={() => toggleApp(a.id)} />
                      <span>{a.name}</span>
                      <span className={"adm-badge " + (isHeld ? "ok" : "")}>{isHeld ? "Licensed" : "Not licensed"}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <label className={"adm-radio" + (f.noApps ? " on" : "")}><input type="radio" name="apps" checked={f.noApps} onChange={() => set({ noApps: true, apps: [], appRoles: {} })} /><span><b>Create the user without app access</b> (not recommended)<span className="adm-hint">They can sign in, but cannot open any Bizzux application until an administrator assigns one. Nothing is lost: you can add apps at any time.</span></span></label>
            <details className="adm-acc"><summary>About app access and licences</summary>
              <p className="muted">An app appears as Licensed when your company holds it. You cannot assign an app your company does not hold. App access is separate from the organization role you choose on the next step.</p>
            </details>
          </section>
        )}
        {step === 2 && (
          <section aria-labelledby="w2">
            <h3 id="w2">Optional settings</h3>
            <p className="muted">You can manage roles and fill in profile information now, or leave everything as it is and change it later.</p>
            <details className="adm-acc" open={openSec.roles} onToggle={(e) => { const v = e.currentTarget.open; setOpenSec((o) => ({ ...o, roles: v })); }}><summary>Roles</summary>
              {f.method === "username" ? (
                <>
                  <fieldset className="adm-methods"><legend className="adm-lab">Organization role <span className="adm-info" title="Controls what they can do in the organization: users, roles and app assignment. It grants no application permission.">ⓘ</span></legend>
                    {[["MEMBER", "Member", "Standard user. No administration."], ["VIEWER", "Viewer", "Read-only. No administration."], ["ADMIN", "Admin", canAssignAdmin ? "Can manage users and app access." : "Only the Owner can make someone an Admin."]].map(([v, t, h]) => (
                      <label key={v} className={"adm-radio" + (f.orgRole === v ? " on" : "")}><input type="radio" name="orgrole" disabled={v === "ADMIN" && !canAssignAdmin} checked={f.orgRole === v} onChange={() => set({ orgRole: v })} /><span><b>{t}</b><span className="adm-hint">{h}</span></span></label>
                    ))}
                  </fieldset>
                  {f.apps.length > 0 && (
                    <div><div className="adm-lab">App roles <span className="adm-info" title="The role inside each app. Independent of the organization role.">ⓘ</span></div>
                      {f.apps.map((id) => (
                        <div key={id} className="adm-approle"><span>{appName(id)}</span>
                          <select className="input" value={f.appRoles[id] === "ADMIN" ? "ADMIN" : "MEMBER"} onChange={(e) => set({ appRoles: { ...f.appRoles, [id]: e.target.value } })} aria-label={appName(id) + " role"}><option value="MEMBER">Member</option><option value="ADMIN">Admin</option></select>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : <p className="muted">Organization and app roles can be set once the person has joined. For now choose their business profile below.</p>}
              <Field label="Business profile" hint="Describes the job in the business apps. Separate from the organization role.">
                <select className="input" value={f.profile} onChange={(e) => set({ profile: e.target.value })}>{PROFILES.filter((p) => p.value !== "Global Admin").map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
              </Field>
            </details>
            {f.method !== "link" && (
              <details className="adm-acc" open={openSec.profile} onToggle={(e) => { const v = e.currentTarget.open; setOpenSec((o) => ({ ...o, profile: v })); }}><summary>Profile information</summary>
                <div className="adm-grid">
                  <Field label="Job title"><input className="input" value={f.contact.jobTitle} onChange={(e) => setContact({ jobTitle: e.target.value })} /></Field>
                  <Field label="Department"><input className="input" value={f.contact.department} onChange={(e) => setContact({ department: e.target.value })} /></Field>
                  <Field label="Employment type"><select className="input" value={f.contact.employmentType} onChange={(e) => setContact({ employmentType: e.target.value })}>{EMPLOYMENT.map((x) => <option key={x} value={x}>{x || "Not set"}</option>)}</select></Field>
                  <Field label="Employee ID"><input className="input" value={f.employeeId} onChange={(e) => set({ employeeId: e.target.value })} /></Field>
                  <Field label="Branch"><input className="input" value={f.branch} onChange={(e) => set({ branch: e.target.value })} /></Field>
                  <Field label="Office"><input className="input" value={f.contact.office} onChange={(e) => setContact({ office: e.target.value })} /></Field>
                  <Field label="Office phone"><input className="input" value={f.contact.officePhone} onChange={(e) => setContact({ officePhone: e.target.value })} /></Field>
                  <Field label="Mobile number"><input className="input" value={f.contact.mobilePhone} onChange={(e) => setContact({ mobilePhone: e.target.value })} /></Field>
                  <Field label="Street address" wide><input className="input" value={f.contact.streetAddress} onChange={(e) => setContact({ streetAddress: e.target.value })} /></Field>
                  <Field label="City"><input className="input" value={f.contact.city} onChange={(e) => setContact({ city: e.target.value })} /></Field>
                  <Field label="State or province"><input className="input" value={f.contact.state} onChange={(e) => setContact({ state: e.target.value })} /></Field>
                  <Field label="Postal code"><input className="input" value={f.contact.zip} onChange={(e) => setContact({ zip: e.target.value })} /></Field>
                  <Field label="Country or region"><input className="input" value={f.contact.country} onChange={(e) => setContact({ country: e.target.value })} /></Field>
                  {f.method === "username" && <Field label="Account expires on" hint="Optional. For temporary staff."><input className="input" type="date" value={f.accountExpiresAt} onChange={(e) => set({ accountExpiresAt: e.target.value })} /></Field>}
                </div>
                <p className="muted" style={{ fontSize: 12 }}>Workforce details (shift, work location, reporting manager) stay in the Attendance profile, linked to this person.</p>
              </details>
            )}
          </section>
        )}
        {step === 3 && (
          <section aria-labelledby="w3">
            <h3 id="w3">Review and finish</h3>
            <p className="muted">Check everything. Select Edit to change a section; your entries are kept.</p>
            <dl className="adm-review">
              <Row label="Display name" value={f.display} onEdit={() => goTo(0)} />
              <Row label="Username / email" value={f.method === "username" ? f.username : f.method === "invite" ? f.email : f.linkUsername} onEdit={() => goTo(0)} />
              <Row label="Sign-in" value={METHODS.find((m) => m.id === f.method).title} onEdit={() => goTo(0)} />
              {f.method === "username" && <Row label="Password" value={(f.autoPw ? "Generated automatically" : "Set by you") + (f.mustChange ? ", must be changed at first sign-in" : "")} onEdit={() => goTo(0)} />}
              <Row label="Applications" value={f.noApps || !f.apps.length ? "None (identity only)" : f.apps.map((id) => appName(id) + (f.appRoles[id] === "ADMIN" ? " (Admin)" : "")).join(", ")} onEdit={() => goTo(1)} />
              {f.method === "username" && <Row label="Organization role" value={f.orgRole === "ADMIN" ? "Admin" : f.orgRole === "VIEWER" ? "Viewer" : "Member"} onEdit={() => goTo(2)} />}
              <Row label="Business profile" value={PROFILES.find((p) => p.value === f.profile)?.label || f.profile} onEdit={() => goTo(2)} />
              {f.contact.jobTitle && <Row label="Job title" value={f.contact.jobTitle} onEdit={() => goTo(2)} />}
              {f.contact.department && <Row label="Department" value={f.contact.department} onEdit={() => goTo(2)} />}
            </dl>
            {f.noApps || !f.apps.length ? <p className="adm-warn">No apps are assigned: they will be able to sign in but not open any application.</p> : null}
            {f.method === "username" && server.checking && <p className="muted" role="status">Checking with the server…</p>}
            {f.method === "username" && server.problems.length > 0 && <ul className="adm-problems" role="alert">{server.problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>}
            {error && <p className="error" role="alert">{error}</p>}
          </section>
        )}
      </div>
    </div>
  );

  const footer = result ? null : (
    <>
      {step > 0 && <button type="button" className="btn-outline-dark" onClick={() => setStep((s) => s - 1)} disabled={busy}>Back</button>}
      {step < 3 ? <button type="button" className="btn-primary-sm" onClick={goNext}>Next</button>
        : <button type="button" className="btn-primary-sm" onClick={finish} disabled={busy || (f.method === "username" && (server.checking || server.problems.length > 0))}>{busy ? "Adding…" : f.method === "username" ? "Finish adding" : f.method === "invite" ? "Send invitation" : "Send request"}</button>}
      <button type="button" className="btn-outline-dark" style={{ marginLeft: "auto" }} onClick={onClose} disabled={busy}>Cancel</button>
    </>
  );
  return <Drawer open={open} title={result ? "User added" : "Add a user"} size="wide" onClose={onClose} footer={footer} label="Add a user">{body}</Drawer>;
}

// Defined at module level so inputs keep focus while typing (a component created inside another component remounts on every render).
function Field({ label, required, error: err, children, hint, wide }) {
  return (
    <div className={"adm-field" + (wide ? " wide" : "")}>
      <label className="adm-lab">{label}{required && <span className="adm-req" aria-hidden="true"> *</span>}</label>
      {children}
      {hint && !err && <div className="adm-hint">{hint}</div>}
      {err && <div className="adm-err" role="alert">{err}</div>}
    </div>
  );
}

function Row({ label, value, onEdit }) {
  return (<div className="adm-rv"><dt>{label}</dt><dd>{value || "—"}</dd><dd><button type="button" className="adm-link" onClick={onEdit}>Edit</button></dd></div>);
}

function Done({ r, onManage, onClose, onAnother }) {
  const [copied, setCopied] = useState(false);
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  return (
    <div className="adm-done">
      <p className="adm-ok" style={{ fontSize: 15 }}>✓ {r.kind === "username" ? "The user was created." : r.kind === "invite" ? "The invitation was sent." : "The request was sent."}</p>
      {r.kind === "username" && (
        <div className="adm-cred" role="group" aria-label="Sign-in details, shown once">
          <b>Save these now. They are shown only once.</b>
          <div>Username: <code>{r.username}</code></div>
          <div>Temporary password: <code>{r.password}</code> <button type="button" className="adm-link" onClick={() => copy(`Username: ${r.username}\nTemporary password: ${r.password}`)}>{copied ? "Copied" : "Copy"}</button></div>
          <p className="muted" style={{ marginBottom: 0 }}>Give these to the person in a secure way. They sign in with the username and set their own password.{r.reused ? " A new temporary password was issued for the same user." : ""}</p>
        </div>
      )}
      {r.kind === "invite" && <p>An invitation was emailed to <b>{r.email}</b>. If they already have a Bizzux account, it is attached to your company instead of creating a second one.</p>}
      {r.kind === "link" && <p>If <b>{r.username}</b> is a Bizzux user, they will see your request the next time they sign in. Nothing changes for them until they accept.</p>}
      <p><b>Access:</b> {r.apps.length ? r.apps.map(appName).join(", ") : "no applications assigned yet"}{r.orgRole && r.orgRole !== "MEMBER" ? `; organization role ${r.orgRole === "ADMIN" ? "Admin" : "Viewer"}` : ""}.</p>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn-primary-sm" onClick={() => { onManage?.(r.username || r.email); onClose(); }}>Manage this user</button>
        <button type="button" className="btn-outline-dark" onClick={onAnother}>Add another</button>
        <button type="button" className="btn-outline-dark" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { PROFILES, ORGANIZATION_ROLES, ACCOUNT_ADMIN_PROFILES } from "@/lib/roles";
import { APPS, appName } from "@/lib/appCatalog";
import Link from "next/link";
import Nav from "@/components/Nav";
import AccountTabs from "@/components/AccountTabs";
import { useMe } from "@/lib/useMe";
import { roleLabel } from "@/lib/roleLabel";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export default function TeamPage() {
  const router = useRouter();
  // useMe() (lib/useMe.js) shares this /api/me lookup with Nav instead of
  // each firing its own duplicate request, and starts a remount from the
  // last known answer instead of a blank "checking…" state.
  const { user, me } = useMe();
  const isAdmin = me ? me.isAccountAdmin === true : null; // null = checking
  const isSuper = me?.superAdmin === true;
  const myRoleLabel = isSuper ? "Platform " + (me?.platformRole === "OWNER" ? "Owner" : "Admin") : roleLabel(me);
  const [members, setMembers] = useState(null);
  const [organizationName, setOrganizationName] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [credentials, setCredentials] = useState(null); // { email, password } shown once after a credentials-based add or a password reset
  const [managingMember, setManagingMember] = useState(null); // the member row for "Manage roles & app access", or null

  useEffect(() => {
    if (user === null) router.push("/sign-in");
  }, [user, router]);

  async function load() {
    try {
      const d = await api("/api/team", "GET");
      setMembers(d.members || []);
      setOrganizationName(d.organizationName || null);
    } catch (e) {
      setErr(e.message);
      setMembers([]);
    }
  }

  useEffect(() => {
    if (!user || !me) return;
    if (me.isAccountAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, me]);

  if (!user || isAdmin === null) {
    return (
      <div>
        <Nav />
        <AccountTabs active="team" isAccountAdmin={!!isAdmin} isSuper={isSuper} roleLabel={myRoleLabel} />
        <div className="admin-shell"><p className="muted">Loading…</p></div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div>
        <Nav />
        <AccountTabs active="team" isAccountAdmin={false} isSuper={isSuper} roleLabel={myRoleLabel} />
        <div className="admin-shell">
          <p>You don&apos;t have access to this page.</p>
          <Link href="/dashboard" className="btn-primary-sm">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  async function remove(id) {
    if (!confirm("Remove this teammate?")) return;
    try {
      await api("/api/team", "POST", { action: "remove", id });
      setErr("");
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function resend(id) {
    try {
      await api("/api/team", "POST", { action: "resend", id });
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }

  async function resetPasswordEmail(m) {
    if (!confirm(`Send a password-reset email to ${m.email}?`)) return;
    setBusyId(m.id);
    setErr("");
    try {
      await api("/api/team", "POST", { action: "resetPasswordEmail", id: m.id });
      alert(`Password-reset email sent to ${m.email}.`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function setPassword(m) {
    const entered = prompt(`New password for ${m.email} (leave blank to auto-generate):`);
    if (entered === null) return;
    setBusyId(m.id);
    setErr("");
    try {
      const d = await api("/api/team", "POST", { action: "setPassword", id: m.id, password: entered.trim() });
      setCredentials({ email: m.email, password: d.password });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function changeOrgRole(m, role) {
    setMembers((cur) => cur.map((x) => (x.id === m.id ? { ...x, orgRole: role } : x)));
    try {
      await api("/api/team", "POST", { action: "setOrgRole", id: m.id, role });
    } catch (e) {
      setErr(e.message);
      load();
    }
  }

  async function toggleDisabled(m) {
    const disabling = m.status !== "disabled";
    if (!confirm(disabling ? `Disable ${m.email}? They'll immediately lose access.` : `Re-enable ${m.email}?`)) return;
    setBusyId(m.id);
    setErr("");
    try {
      await api("/api/team", "POST", { action: disabling ? "disable" : "enable", id: m.id });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <Nav />
      <AccountTabs active="team" isAccountAdmin={!!isAdmin} isSuper={isSuper} roleLabel={myRoleLabel} />

      <div className="admin-shell">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h1 className="dash-heading" style={{ fontSize: 20 }}>Users</h1>
            {organizationName && <p className="muted" style={{ margin: "0 0 4px", fontSize: 13 }}>{organizationName}</p>}
            <p className="dash-sub" style={{ marginBottom: 0 }}>Invite teammates and manage who has access to your Bizzux apps.</p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn-outline-dark" onClick={() => setShowBulkAdd(true)}>Bulk add users</button>
            <button className="btn-primary-sm" onClick={() => setShowAdd(true)}>+ New User</button>
          </div>
        </div>

        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

        {credentials && (
          <div className="card" style={{ marginBottom: 16, background: "var(--line, #f1f5f9)" }}>
            <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 13 }}>
              Save these now, shown only once
              <button className="link-btn" style={{ float: "right" }} onClick={() => setCredentials(null)}>Dismiss</button>
            </p>
            <p style={{ margin: "0 0 2px", fontFamily: "monospace", fontSize: 13 }}>Username: {credentials.email}</p>
            <p style={{ margin: 0, fontFamily: "monospace", fontSize: 13 }}>Password: {credentials.password}</p>
          </div>
        )}

        <div className="card">
          {members === null && <p className="muted">Loading…</p>}
          {members && members.length === 0 && <p className="muted">No teammates yet.</p>}
          {members && members.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th><th>Email</th><th>Role</th><th>Profile</th><th>Org role</th><th>App access</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>{[m.firstName, m.lastName].filter(Boolean).join(" ") || "N/A"}</td>
                    <td>{m.email}</td>
                    <td>{m.role || "N/A"}</td>
                    <td>{m.profile}</td>
                    <td>
                      {m.isOwner ? (
                        "OWNER"
                      ) : (
                        <select
                          className="input" style={{ fontSize: 12.5, padding: "3px 6px" }}
                          value={m.orgRole} onChange={(e) => changeOrgRole(m, e.target.value)}
                        >
                          {ORGANIZATION_ROLES.filter((r) => r !== "OWNER").map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      {m.appAccess && m.appAccess.length > 0 ? (
                        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                          {m.appAccess.map((name) => (
                            <span key={name} className="status-pill active" style={{ fontSize: 11 }}>{name}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>None</span>
                      )}
                    </td>
                    <td>
                      <span className={"status-pill " + (m.status === "active" ? "active" : m.status === "disabled" ? "expired" : "trial")}>
                        {m.status === "active" ? "Active" : m.status === "disabled" ? "Disabled" : "Invited"}
                      </span>
                    </td>
                    <td>
                      {!m.isOwner && (
                        <TeamRowMenu
                          items={[
                            { label: "Manage roles & app access", onClick: () => setManagingMember(m) },
                            ...(m.status === "invited" ? [{ label: "Resend invite email", onClick: () => resend(m.id) }] : []),
                            ...(m.status !== "invited" ? [{ label: "Send password-reset email", onClick: () => resetPasswordEmail(m) }] : []),
                            { label: busyId === m.id ? "Working…" : "Set new password directly", onClick: () => setPassword(m) },
                            {
                              label: m.status === "disabled" ? "Re-enable" : "Disable",
                              onClick: () => toggleDisabled(m),
                            },
                            { label: "Remove", danger: true, onClick: () => remove(m.id) },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showAdd && (
        <AddUserModal
          onClose={() => setShowAdd(false)}
          onAdded={async (creds) => {
            if (creds) setCredentials(creds);
            await load();
          }}
        />
      )}

      {showBulkAdd && (
        <BulkAddModal
          onClose={() => setShowBulkAdd(false)}
          onDone={async () => {
            setShowBulkAdd(false);
            await load();
          }}
        />
      )}

      {managingMember && (
        <ManageAccessModal
          member={managingMember}
          onClose={() => setManagingMember(null)}
          onSaved={async () => {
            setManagingMember(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// The "Manage roles & app access" panel — org role plus per-app
// granted/admin toggles for one existing teammate, edited and saved
// together instead of separate visits to the inline Org role selector and
// Team > Apps > Manage Users.
function ManageAccessModal({ member, onClose, onSaved }) {
  const [detail, setDetail] = useState(null); // { uid, orgRole, apps: [{appId,name,granted,admin}] }
  const [orgRole, setOrgRole] = useState(member.orgRole);
  const [apps, setApps] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await api(`/api/team?memberId=${member.id}`, "GET");
        setDetail(d);
        setOrgRole(d.orgRole);
        setApps(d.apps);
      } catch (e) {
        setError(e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleApp(appId, field, value) {
    setApps((cur) =>
      cur.map((a) => (a.appId === appId ? { ...a, [field]: value, ...(field === "admin" && value ? { granted: true } : {}) } : a))
    );
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (orgRole !== member.orgRole) {
        await api("/api/team", "POST", { action: "setOrgRole", id: member.id, role: orgRole });
      }
      await api("/api/team", "POST", {
        action: "setAppAccess", id: member.id,
        apps: apps.map((a) => ({ appId: a.appId, granted: a.granted, admin: a.admin })),
      });
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h2 style={{ marginBottom: 4 }}>Manage roles &amp; app access</h2>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>{member.email}</p>

        {error && <p className="error">{error}</p>}
        {!detail && !error && <p className="muted">Loading…</p>}

        {detail && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label className="label">Organization role</label>
              <select className="input" value={orgRole} onChange={(e) => setOrgRole(e.target.value)}>
                {ORGANIZATION_ROLES.filter((r) => r !== "OWNER").map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label className="label">App access</label>
              {apps.map((a) => (
                <div key={a.appId} className="row" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                  <label className="row" style={{ gap: 8, fontSize: 13.5 }}>
                    <input type="checkbox" checked={a.granted} onChange={(e) => toggleApp(a.appId, "granted", e.target.checked)} />
                    {a.name}
                  </label>
                  <label className="muted row" style={{ gap: 6, fontSize: 12.5 }}>
                    <input type="checkbox" checked={a.admin} onChange={(e) => toggleApp(a.appId, "admin", e.target.checked)} />
                    Admin
                  </label>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !detail} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const EMPTY_ROW = { firstName: "", lastName: "", email: "", profile: "" };

// Bulk add — like M365's "Add multiple users", scoped down: email-invite
// only (no per-row passwords to manage), one shared App access selection
// applied to everyone in the batch rather than per row. Reuses the exact
// same /api/team "invite" action as the single-user form, once per row, so
// there's no separate bulk endpoint to keep in sync with it.
function BulkAddModal({ onClose, onDone }) {
  const [rows, setRows] = useState([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }]);
  const [appAccess, setAppAccess] = useState(() =>
    Object.fromEntries(APPS.map((a) => [a.id, { granted: false, admin: false }]))
  );
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null); // [{ email, ok, error }]

  function updateRow(i, field, value) {
    setRows((cur) => cur.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }
  function addRow() {
    setRows((cur) => [...cur, { ...EMPTY_ROW }]);
  }
  function removeRow(i) {
    setRows((cur) => cur.filter((_, idx) => idx !== i));
  }
  function toggleApp(appId, field, value) {
    setAppAccess((cur) => ({ ...cur, [appId]: { ...cur[appId], [field]: value, ...(field === "admin" && value ? { granted: true } : {}) } }));
  }
  function toggleAllApps(checked) {
    setAppAccess((cur) => Object.fromEntries(APPS.map((a) => [a.id, { granted: checked, admin: checked ? cur[a.id].admin : false }])));
  }
  const allAppsGranted = APPS.every((a) => appAccess[a.id].granted);

  async function submit() {
    const valid = rows.filter((r) => r.firstName.trim() && EMAIL_RE.test(r.email.trim()) && r.profile);
    if (valid.length === 0) return;
    setBusy(true);
    const apps = Object.entries(appAccess)
      .filter(([, v]) => v.granted)
      .map(([appId, v]) => ({ appId, role: v.admin ? "ADMIN" : "MEMBER" }));

    const outcomes = [];
    for (const r of valid) {
      try {
        await api("/api/team", "POST", {
          action: "invite", firstName: r.firstName, lastName: r.lastName, email: r.email,
          profile: r.profile, apps, loginMethod: "email",
        });
        outcomes.push({ email: r.email, ok: true });
      } catch (e) {
        outcomes.push({ email: r.email, ok: false, error: e.message });
      }
    }
    setResults(outcomes);
    setBusy(false);
  }

  const allDone = results && results.every((r) => r.ok);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <h2 style={{ marginBottom: 4 }}>Bulk add users</h2>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
          Each person gets an email invite. Rows with no first name, a valid email, and a role are skipped.
        </p>

        {results ? (
          <>
            {results.map((r) => (
              <div key={r.email} className="row" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                <span style={{ fontSize: 13.5 }}>{r.email}</span>
                <span className={"status-pill " + (r.ok ? "active" : "expired")}>{r.ok ? "Invited" : r.error}</span>
              </div>
            ))}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn-primary" onClick={onDone}>Close</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ overflowX: "auto", marginBottom: 14 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>First name</th><th>Last name</th><th>Email</th><th>Role</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td><input className="input" style={{ fontSize: 13 }} value={r.firstName} onChange={(e) => updateRow(i, "firstName", e.target.value)} /></td>
                      <td><input className="input" style={{ fontSize: 13 }} value={r.lastName} onChange={(e) => updateRow(i, "lastName", e.target.value)} /></td>
                      <td><input className="input" type="email" style={{ fontSize: 13 }} value={r.email} onChange={(e) => updateRow(i, "email", e.target.value)} /></td>
                      <td>
                        <select className="input" style={{ fontSize: 13 }} value={r.profile} onChange={(e) => updateRow(i, "profile", e.target.value)}>
                          <option value="">Select</option>
                          {PROFILES.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {rows.length > 1 && <button type="button" className="link-btn danger" onClick={() => removeRow(i)}>✕</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="link-btn" style={{ marginBottom: 16 }} onClick={addRow}>+ Add row</button>

            <div style={{ marginBottom: 16 }}>
              <label className="label">App access (applied to everyone added)</label>
              <label className="row" style={{ gap: 8, fontSize: 13, fontWeight: 600, padding: "4px 0 6px", cursor: "pointer" }}>
                <input type="checkbox" checked={allAppsGranted} onChange={(e) => toggleAllApps(e.target.checked)} />
                Select all apps
              </label>
              {APPS.map((a) => {
                const v = appAccess[a.id];
                return (
                  <div key={a.id} className="row" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                    <label className="row" style={{ gap: 8, fontSize: 13.5 }}>
                      <input type="checkbox" checked={v.granted} onChange={(e) => toggleApp(a.id, "granted", e.target.checked)} />
                      {a.name}
                    </label>
                    <label className="muted row" style={{ gap: 6, fontSize: 12.5 }}>
                      <input type="checkbox" checked={v.admin} onChange={(e) => toggleApp(a.id, "admin", e.target.checked)} />
                      Admin
                    </label>
                  </div>
                );
              })}
            </div>

            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
              <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? "Adding…" : "Add users"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TeamRowMenu({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="link-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ fontSize: 16, padding: "2px 8px" }}
      >
        ⋯
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 29 }} onClick={() => setOpen(false)} />
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 30, minWidth: 200, padding: 6, boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}
          >
            {items.map((it, i) => (
              <button
                key={i} type="button"
                className={"link-btn" + (it.danger ? " danger" : "")}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 8px", fontSize: 13 }}
                onClick={() => { setOpen(false); it.onClick(); }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ADD_USER_STEPS = [
  { key: "basics", label: "Basics" },
  { key: "access", label: "App access" },
  { key: "role", label: "Role" },
  { key: "review", label: "Review & finish" },
  { key: "finish", label: "Finish" },
];
const REVIEW_STEP = 3;
const FINISH_STEP = 4;

const EMPTY_CONTACT_INFO = {
  jobTitle: "", department: "", office: "", officePhone: "", faxNumber: "",
  mobilePhone: "", streetAddress: "", city: "", state: "", zip: "", country: "",
};

// Left-hand step list — a circle per step (filled + connecting line for
// done/current, hollow for not-yet-reached), matching the M365 admin
// center's "Add a user" wizard shape. Purely a layout/flow change from the
// old single scrolling form; same fields, same submit call.
function WizardSteps({ steps, currentIndex }) {
  return (
    <div style={{ minWidth: 160 }}>
      {steps.map((s, i) => (
        <div key={s.key} className="row" style={{ alignItems: "flex-start", gap: 10, minHeight: 44 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span
              style={{
                width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                background: i <= currentIndex ? "var(--brand-gradient, #2563eb)" : "transparent",
                border: i <= currentIndex ? "none" : "2px solid var(--line)",
              }}
            />
            {i < steps.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 20, background: "var(--line)" }} />}
          </div>
          <span style={{ fontSize: 13.5, fontWeight: i === currentIndex ? 700 : 500, color: i === currentIndex ? "inherit" : "var(--muted, #64748b)" }}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function AddUserModal({ onClose, onAdded }) {
  const [step, setStep] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState("");
  const [loginMethod, setLoginMethod] = useState("email"); // "email" | "credentials"
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // { [appId]: { granted: bool, admin: bool } } — which apps this new user
  // gets, and whether they're an admin of each (AppAssignment.role:
  // ADMIN | MEMBER, see lib/appAccess.js) rather than one all-or-nothing
  // permission. PaisaTrack isn't listed here — it's a separate Firebase
  // project with its own login, outside this organization/app model.
  const [appAccess, setAppAccess] = useState(() =>
    Object.fromEntries(APPS.map((a) => [a.id, { granted: false, admin: false }]))
  );
  // Purely descriptive, optional fields (M365 "Add a user" wizard's Profile
  // info section) — none of them gate access or feed role/permission logic.
  const [contactInfo, setContactInfo] = useState(EMPTY_CONTACT_INFO);
  function setContactField(field, value) {
    setContactInfo((cur) => ({ ...cur, [field]: value }));
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // set on success, drives the Finish step
  const [showResultPassword, setShowResultPassword] = useState(false);

  function toggleApp(appId, field, value) {
    setAppAccess((cur) => ({ ...cur, [appId]: { ...cur[appId], [field]: value, ...(field === "admin" && value ? { granted: true } : {}) } }));
  }
  function toggleAllApps(checked) {
    setAppAccess((cur) => Object.fromEntries(APPS.map((a) => [a.id, { granted: checked, admin: checked ? cur[a.id].admin : false }])));
  }
  const allAppsGranted = APPS.every((a) => appAccess[a.id].granted);

  function validateStep(i) {
    if (i === 0) {
      if (!firstName.trim()) return "First name is required";
      if (!EMAIL_RE.test(email.trim())) return loginMethod === "credentials" ? "Enter a login username in email format" : "Enter a valid email address";
    }
    if (i === 2 && !profile) return "Select a role";
    return null;
  }

  function goNext() {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError("");
    setStep((s) => Math.min(s + 1, ADD_USER_STEPS.length - 1));
  }
  function goBack() {
    setError("");
    setStep((s) => Math.max(s - 1, 0));
  }

  async function finish() {
    const err = validateStep(0) || validateStep(2);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const apps = Object.entries(appAccess)
        .filter(([, v]) => v.granted)
        .map(([appId, v]) => ({ appId, role: v.admin ? "ADMIN" : "MEMBER" }));
      const d = await api("/api/team", "POST", {
        action: "invite", firstName, lastName, email, profile, apps, contactInfo,
        loginMethod, ...(loginMethod === "credentials" ? { password } : {}),
      });
      const creds = loginMethod === "credentials" ? { email: d.email, password: d.password } : null;
      await onAdded(creds);
      setResult({ apps, creds });
      setStep(FINISH_STEP);
      setBusy(false);
    } catch (e2) {
      setError(e2.message);
      setBusy(false);
    }
  }

  const grantedApps = APPS.filter((a) => appAccess[a.id].granted);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700, width: "100%" }}>
        <h2 style={{ marginBottom: 18 }}>Add New User</h2>
        <div className="row" style={{ alignItems: "flex-start", gap: 28 }}>
          <WizardSteps steps={ADD_USER_STEPS} currentIndex={step} />

          <div style={{ flex: 1, minWidth: 0 }}>
            {step === 0 && (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: 4 }}>Set up the basics</h3>
                <p className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>Who are you adding, and how will they sign in?</p>

                <div className="row" style={{ gap: 12, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label className="label">First name *</label>
                    <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="label">Last name</label>
                    <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                </div>

                <div className="mode-toggle" role="tablist" aria-label="How they'll sign in" style={{ marginBottom: 10 }}>
                  <button
                    type="button" role="tab" aria-selected={loginMethod === "email"}
                    className={"mode-toggle-btn" + (loginMethod === "email" ? " active" : "")}
                    onClick={() => setLoginMethod("email")}
                  >
                    Email invite
                  </button>
                  <button
                    type="button" role="tab" aria-selected={loginMethod === "credentials"}
                    className={"mode-toggle-btn" + (loginMethod === "credentials" ? " active" : "")}
                    onClick={() => setLoginMethod("credentials")}
                  >
                    Set username &amp; password
                  </button>
                </div>

                <div style={{ marginBottom: 4 }}>
                  <label className="label">{loginMethod === "credentials" ? "Username (email format) *" : "Email *"}</label>
                  <input
                    className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder={loginMethod === "credentials" ? "name@bizzux.login" : ""}
                  />
                </div>
                {loginMethod === "email" ? (
                  <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                    An invitation will be sent to this email address.
                  </p>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <label className="label">Password (leave blank to auto-generate)</label>
                    <div className="row" style={{ gap: 6 }}>
                      <input
                        className="input" type={showPassword ? "text" : "password"} value={password}
                        onChange={(e) => setPassword(e.target.value)} style={{ flex: 1 }}
                      />
                      <button type="button" className="link-btn" onClick={() => setPassword(genPassword())}>Generate</button>
                    </div>
                    {password && (
                      <label className="muted" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
                        <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} style={{ marginRight: 6 }} />
                        Show password
                      </label>
                    )}
                    <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
                      No email is sent — this account is active immediately. Give the credentials to them yourself.
                    </p>
                  </div>
                )}
              </div>
            )}

            {step === 1 && (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: 4 }}>Assign app access</h3>
                <p className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>
                  Choose which Bizzux apps this person can open, and whether they administer each one.
                </p>
                <label className="row" style={{ gap: 8, fontSize: 13, fontWeight: 600, padding: "0 0 10px", cursor: "pointer" }}>
                  <input type="checkbox" checked={allAppsGranted} onChange={(e) => toggleAllApps(e.target.checked)} />
                  Select all apps
                </label>
                {APPS.map((a) => {
                  const v = appAccess[a.id];
                  return (
                    <div key={a.id} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                      <label className="row" style={{ gap: 8, fontSize: 13.5 }}>
                        <input type="checkbox" checked={v.granted} onChange={(e) => toggleApp(a.id, "granted", e.target.checked)} />
                        {a.name}
                      </label>
                      <label className="muted row" style={{ gap: 6, fontSize: 12.5 }}>
                        <input type="checkbox" checked={v.admin} onChange={(e) => toggleApp(a.id, "admin", e.target.checked)} />
                        Admin
                      </label>
                    </div>
                  );
                })}
                <p className="muted" style={{ fontSize: 11.5, marginTop: 8, marginBottom: 0 }}>
                  PaisaTrack has its own separate sign-in and isn't managed here.
                </p>
              </div>
            )}

            {step === 2 && (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: 4 }}>Choose a role</h3>
                <p className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>What can this person do at the organization level?</p>
                <label className="label">Roles *</label>
                <select className="input" value={profile} onChange={(e) => setProfile(e.target.value)}>
                  <option value="" disabled>Select role</option>
                  {PROFILES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label} — {ACCOUNT_ADMIN_PROFILES.includes(p.value) ? "Admin Center access" : "no Admin Center access"}
                    </option>
                  ))}
                </select>
                <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
                  {PROFILES.find((p) => p.value === profile)?.desc}
                </p>

                <h3 style={{ marginTop: 24, marginBottom: 4 }}>Profile info</h3>
                <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
                  Optional — shown on this person's detail panel, doesn't affect access.
                </p>
                <div className="row" style={{ gap: 12, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label className="label">Job title</label>
                    <input className="input" value={contactInfo.jobTitle} onChange={(e) => setContactField("jobTitle", e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="label">Department</label>
                    <input className="input" value={contactInfo.department} onChange={(e) => setContactField("department", e.target.value)} />
                  </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label className="label">Office</label>
                  <input className="input" value={contactInfo.office} onChange={(e) => setContactField("office", e.target.value)} />
                </div>
                <div className="row" style={{ gap: 12, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label className="label">Office phone</label>
                    <input className="input" value={contactInfo.officePhone} onChange={(e) => setContactField("officePhone", e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="label">Fax number</label>
                    <input className="input" value={contactInfo.faxNumber} onChange={(e) => setContactField("faxNumber", e.target.value)} />
                  </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label className="label">Mobile phone</label>
                  <input className="input" value={contactInfo.mobilePhone} onChange={(e) => setContactField("mobilePhone", e.target.value)} />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label className="label">Street address</label>
                  <input className="input" value={contactInfo.streetAddress} onChange={(e) => setContactField("streetAddress", e.target.value)} />
                </div>
                <div className="row" style={{ gap: 12, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label className="label">City</label>
                    <input className="input" value={contactInfo.city} onChange={(e) => setContactField("city", e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="label">State or province</label>
                    <input className="input" value={contactInfo.state} onChange={(e) => setContactField("state", e.target.value)} />
                  </div>
                </div>
                <div className="row" style={{ gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label className="label">Zip or postal code</label>
                    <input className="input" value={contactInfo.zip} onChange={(e) => setContactField("zip", e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="label">Country or region</label>
                    <input className="input" value={contactInfo.country} onChange={(e) => setContactField("country", e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {step === REVIEW_STEP && (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: 4 }}>Review and finish</h3>
                <p className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>Review everything before adding this person.</p>

                <div style={{ marginBottom: 14 }}>
                  <div className="label">Name and sign-in</div>
                  <div style={{ fontSize: 13.5 }}>{[firstName, lastName].filter(Boolean).join(" ") || "—"}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{email || "—"} · {loginMethod === "credentials" ? "Username & password" : "Email invite"}</div>
                  <button type="button" className="link-btn" style={{ fontSize: 12 }} onClick={() => setStep(0)}>Edit</button>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div className="label">App access</div>
                  {grantedApps.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12.5 }}>No apps granted</div>
                  ) : (
                    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                      {grantedApps.map((a) => (
                        <span key={a.id} className="status-pill active" style={{ fontSize: 11 }}>
                          {a.name}{appAccess[a.id].admin ? " (Admin)" : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  <button type="button" className="link-btn" style={{ fontSize: 12 }} onClick={() => setStep(1)}>Edit</button>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div className="label">Role</div>
                  <div style={{ fontSize: 13.5 }}>{PROFILES.find((p) => p.value === profile)?.label || "—"}</div>
                  <button type="button" className="link-btn" style={{ fontSize: 12 }} onClick={() => setStep(2)}>Edit</button>
                </div>

                <div style={{ marginBottom: 0 }}>
                  <div className="label">Profile info</div>
                  {Object.values(contactInfo).some(Boolean) ? (
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {[contactInfo.jobTitle, contactInfo.department, contactInfo.office].filter(Boolean).join(" · ") || "Set"}
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: 12.5 }}>Not set</div>
                  )}
                  <button type="button" className="link-btn" style={{ fontSize: 12 }} onClick={() => setStep(2)}>Edit</button>
                </div>
              </div>
            )}

            {step === FINISH_STEP && result && (
              <div>
                <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 22, height: 22, borderRadius: "50%", background: "#16a34a", color: "#fff", fontSize: 13, flexShrink: 0,
                  }}>✓</span>
                  <h3 style={{ margin: 0 }}>
                    {[firstName, lastName].filter(Boolean).join(" ") || "User"} added to your team
                  </h3>
                </div>
                <p className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>
                  {loginMethod === "credentials"
                    ? "They can sign in right away with the credentials below."
                    : "They'll appear as \"Invited\" until they accept the emailed invitation."}
                </p>

                <div style={{ marginBottom: 14 }}>
                  <div className="label">User details</div>
                  <div style={{ fontSize: 13.5 }}>Display name: {[firstName, lastName].filter(Boolean).join(" ") || "—"}</div>
                  <div style={{ fontSize: 13.5 }}>Email: {email}</div>
                  {result.creds && (
                    <div className="row" style={{ gap: 6, fontSize: 13.5 }}>
                      Password: {showResultPassword ? result.creds.password : "•".repeat(10)}
                      <button type="button" className="link-btn" style={{ fontSize: 12 }} onClick={() => setShowResultPassword((v) => !v)}>
                        {showResultPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: 0 }}>
                  <div className="label">App access assigned</div>
                  {result.apps.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12.5 }}>None</div>
                  ) : (
                    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                      {result.apps.map((a) => (
                        <span key={a.appId} className="status-pill active" style={{ fontSize: 11 }}>
                          {appName(a.appId)}{a.role === "ADMIN" ? " (Admin)" : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {error && <p className="error" style={{ marginTop: 16 }}>{error}</p>}

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 20, gap: 8 }}>
          {step === FINISH_STEP ? (
            <button type="button" className="btn-primary" onClick={onClose}>Close</button>
          ) : (
            <>
              <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
              {step > 0 && <button type="button" className="btn-outline-dark" onClick={goBack}>Back</button>}
              {step < REVIEW_STEP ? (
                <button type="button" className="btn-primary" onClick={goNext}>Next</button>
              ) : (
                <button type="button" className="btn-primary" disabled={busy} onClick={finish}>{busy ? "Adding…" : "Finish adding"}</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

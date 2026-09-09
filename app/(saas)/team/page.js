"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { PROFILES } from "@/lib/roles";
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
  const [showAdd, setShowAdd] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [credentials, setCredentials] = useState(null); // { email, password } shown once after a credentials-based add or a password reset

  useEffect(() => {
    if (user === null) router.push("/sign-in");
  }, [user, router]);

  async function load() {
    try {
      const d = await api("/api/team", "GET");
      setMembers(d.members || []);
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
            <p className="dash-sub" style={{ marginBottom: 0 }}>Invite teammates and manage who has access to your Bizzux apps.</p>
          </div>
          <button className="btn-primary-sm" onClick={() => setShowAdd(true)}>+ New User</button>
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
                  <th>Name</th><th>Email</th><th>Role</th><th>Profile</th><th>Status</th><th></th>
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
                      <span className={"status-pill " + (m.status === "active" ? "active" : m.status === "disabled" ? "expired" : "trial")}>
                        {m.status === "active" ? "Active" : m.status === "disabled" ? "Disabled" : "Invited"}
                      </span>
                    </td>
                    <td>
                      {!m.isOwner && (
                        <TeamRowMenu
                          items={[
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
            setShowAdd(false);
            if (creds) setCredentials(creds);
            await load();
          }}
        />
      )}
    </div>
  );
}

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
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

function AddUserModal({ onClose, onAdded }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState("");
  const [loginMethod, setLoginMethod] = useState("email"); // "email" | "credentials"
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!firstName.trim()) {
      setError("First name is required");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError(loginMethod === "credentials" ? "Enter a login username in email format" : "Enter a valid email address");
      return;
    }
    if (!profile) {
      setError("Select a role");
      return;
    }
    setBusy(true);
    try {
      // `role` (free-text job title) is no longer collected here — the API
      // still accepts it and defaults it to "" server-side, so nothing else
      // needs to change for this field to just go away.
      const d = await api("/api/team", "POST", {
        action: "invite", firstName, lastName, email, profile,
        loginMethod, ...(loginMethod === "credentials" ? { password } : {}),
      });
      onAdded(loginMethod === "credentials" ? { email: d.email, password: d.password } : null);
    } catch (e2) {
      setError(e2.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 14 }}>Add New User</h2>
        <form onSubmit={submit} noValidate>
          <div style={{ marginBottom: 10 }}>
            <label className="label">First name *</label>
            <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus required />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="label">Last name</label>
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
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
              placeholder={loginMethod === "credentials" ? "name@bizzux.login" : ""} required
            />
          </div>
          {loginMethod === "email" ? (
            <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              An invitation will be sent to this email address.
            </p>
          ) : (
            <div style={{ marginBottom: 10 }}>
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

          <div style={{ marginBottom: 16 }}>
            <label className="label">Roles *</label>
            <select className="input" value={profile} onChange={(e) => setProfile(e.target.value)} required>
              <option value="" disabled>Select role</option>
              {PROFILES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
              {PROFILES.find((p) => p.value === profile)?.desc}
            </p>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}

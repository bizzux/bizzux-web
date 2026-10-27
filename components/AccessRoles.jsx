"use client";

import { useEffect, useMemo, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

// Security & Governance -> Access & Roles. Everything here is a request to
// /api/admin/platform-admins, which enforces who may do what; hiding a button
// below is only a convenience. Owners manage; Admins see the roster read-only.
async function api(method, body, query = "") {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch("/api/admin/platform-admins" + query, {
    method,
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || "Request failed"), { code: data.code });
  return data;
}

const when = (v) => (v ? new Date(v).toLocaleString() : "—");

export default function AccessRoles({ isOwner }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [history, setHistory] = useState(null);

  async function load() {
    try {
      const d = await api("GET");
      setData(d);
      setRole((r) => r || d.roles[0]?.id || "");
    } catch (e) {
      setErr(e);
      setData({ admins: [], invitations: [], roles: [] });
    }
  }
  useEffect(() => { load(); }, []);

  async function act(key, body, success) {
    setBusy(key); setErr(null); setNote("");
    window.scrollTo({ top: 0, behavior: "smooth" }); // an error or a "sign in again" prompt shows at the top; make sure it is seen
    try {
      await api("POST", body);
      if (success) setNote(success);
      await load();
      return true;
    } catch (e) {
      setErr(e);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function invite(e) {
    e.preventDefault();
    if (await act("invite", { action: "invite", email: email.trim(), role }, `Invitation sent to ${email.trim()}.`)) setEmail("");
  }

  async function openHistory(a) {
    setHistory({ admin: a, rows: null });
    try {
      const d = await api("GET", null, "?history=" + encodeURIComponent(a.uid));
      setHistory({ admin: a, rows: d.history });
    } catch (e) {
      setHistory({ admin: a, rows: [] });
      setErr(e);
    }
  }

  const admins = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.admins || []).filter((a) => !s || [a.email, a.displayName, a.roleLabel].some((v) => (v || "").toLowerCase().includes(s)));
  }, [data, q]);

  if (!data) return <p className="muted">Loading…</p>;
  const roleLabel = (id) => data.roles.find((r) => r.id === id)?.label || id;
  const selected = data.roles.find((r) => r.id === role);

  return (
    <div>
      {err && (
        <div className="error" style={{ marginBottom: 12 }} role="alert">
          {err.message}{" "}
          {err.code === "reauth_required" && (
            <button className="link-btn" onClick={async () => { await signOut(auth); window.location.href = "/sign-in"; }}>Sign in again</button>
          )}
        </div>
      )}
      {note && <p className="muted" style={{ marginBottom: 12 }} role="status">{note}</p>}

      {isOwner && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, marginBottom: 6 }}>Invite administrator</h3>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
            They don&apos;t need an account yet. The link expires in 7 days, works only for this email address, and access
            activates once they have verified their email and turned on two-step verification.
          </p>
          <form onSubmit={invite} className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <label className="sr-only" htmlFor="inv-email">Email address</label>
            <input id="inv-email" className="input" type="email" placeholder="teammate@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)} style={{ maxWidth: 300 }} required />
            <label className="sr-only" htmlFor="inv-role">Role</label>
            <select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value)} style={{ maxWidth: 260 }}>
              {data.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <button className="btn-primary-sm" disabled={busy === "invite" || !email.trim()}>{busy === "invite" ? "Sending…" : "Send invitation"}</button>
          </form>
          {selected && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{selected.summary}</p>}
        </div>
      )}

      {isOwner && data.invitations.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Pending invitations</h3>
          <table className="table">
            <thead><tr><th>Email</th><th>Role</th><th>Invited by</th><th>Invited</th><th>Expires</th><th></th></tr></thead>
            <tbody>
              {data.invitations.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td><td>{i.roleLabel}</td><td>{i.invitedBy}</td><td>{when(i.invitedAt)}</td>
                  <td>{i.expired ? <span className="status-pill expired">Expired</span> : when(i.expiresAt)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="link-btn" disabled={!!busy} onClick={() => act("r" + i.id, { action: "resend", email: i.email, role: i.role }, `Invitation re-sent to ${i.email}.`)}>Resend</button>{" "}
                    <button className="link-btn danger" disabled={!!busy} onClick={() => confirm(`Revoke the invitation for ${i.email}?`) && act("v" + i.id, { action: "revokeInvitation", id: i.id }, "Invitation revoked.")}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ fontSize: 15 }}>Platform administrators ({data.admins.length})</h3>
          <input className="input" aria-label="Search administrators" placeholder="Search name, email or role" value={q}
            onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Administrator</th><th>Role</th><th>Status</th><th>MFA</th><th>Last sign-in</th><th>Invited by</th><th>Invited</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.uid}>
                  <td>{a.displayName && <div>{a.displayName}</div>}<div className={a.displayName ? "muted" : ""}>{a.email}</div></td>
                  <td>
                    {isOwner && a.role !== "OWNER" ? (
                      <select className="input" aria-label={`Role for ${a.email}`} value={a.role} disabled={!!busy}
                        onChange={(e) => confirm(`Change ${a.email} to ${roleLabel(e.target.value)}?`) ? act("c" + a.uid, { action: "changeRole", uid: a.uid, role: e.target.value }, "Role updated.") : load()}>
                        {data.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                    ) : a.roleLabel}
                  </td>
                  <td><span className={"status-pill " + (a.status === "disabled" ? "expired" : "active")}>{a.status}</span></td>
                  <td>{a.mfaEnabled ? "On" : <span className="muted">Not enrolled</span>}</td>
                  <td>{when(a.lastSignIn)}</td>
                  <td>{a.invitedBy || "—"}</td>
                  <td>{when(a.invitedAt)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="link-btn" onClick={() => openHistory(a)}>History</button>
                    {isOwner && a.role !== "OWNER" && (
                      <>{" "}
                        <button className={"link-btn" + (a.status === "disabled" ? "" : " danger")} disabled={!!busy}
                          onClick={() => {
                            const enable = a.status === "disabled";
                            if (enable || confirm(`Disable platform access for ${a.email}? They lose access immediately.`)) {
                              act("d" + a.uid, { action: enable ? "reactivate" : "disable", uid: a.uid }, enable ? "Access restored." : "Access disabled.");
                            }
                          }}>
                          {a.status === "disabled" ? "Reactivate" : "Disable access"}
                        </button>{" "}
                        <button className="link-btn danger" disabled={!!busy}
                          onClick={() => {
                            if (confirm(`Remove ${a.email} from the platform team? They lose all platform access. You can invite them again later.`)) {
                              act("r" + a.uid, { action: "remove", uid: a.uid }, "Removed. You can invite them again.");
                            }
                          }}>
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {admins.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>No administrators match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {history && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <h3 style={{ fontSize: 15 }}>Audit history — {history.admin.email}</h3>
            <button className="link-btn" onClick={() => setHistory(null)}>Close</button>
          </div>
          {history.rows === null ? <p className="muted">Loading…</p> : history.rows.length === 0 ? <p className="muted">No recorded changes.</p> : (
            <table className="table">
              <thead><tr><th>When</th><th>By</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>
                {history.rows.map((h) => (
                  <tr key={h.id}><td>{when(h.createdAt)}</td><td>{h.actorEmail}</td><td>{h.action}</td>
                    <td style={{ fontSize: 11.5, whiteSpace: "normal" }}>{JSON.stringify(h.details)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

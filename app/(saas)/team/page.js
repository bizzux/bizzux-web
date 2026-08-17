"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { PROFILES } from "@/lib/roles";
import Link from "next/link";
import AppTopbar from "@/components/AppTopbar";

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
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(null); // null = checking
  const [members, setMembers] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.push("/sign-in");
        return;
      }
      setUser(u);
    });
    return unsub;
  }, [router]);

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
    if (!user) return;
    (async () => {
      try {
        const t = await user.getIdToken();
        const r = await fetch("/api/me", { headers: { Authorization: "Bearer " + t } });
        const d = await r.json();
        setIsAdmin(d.isAccountAdmin === true);
        if (d.isAccountAdmin) await load();
      } catch {
        setIsAdmin(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user || isAdmin === null) {
    return <div className="admin-shell"><p className="muted">Loading…</p></div>;
  }
  if (!isAdmin) {
    return (
      <div className="admin-shell">
        <p>You don&apos;t have access to this page.</p>
        <Link href="/dashboard" className="btn-primary-sm">Back to dashboard</Link>
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

  return (
    <div>
      <AppTopbar links={[{ href: "/dashboard", label: "Dashboard" }, { href: "/profile", label: "Profile" }]} />

      <div className="admin-shell">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <h1 className="dash-heading">Users</h1>
            <p className="dash-sub" style={{ marginBottom: 0 }}>Invite teammates and manage who has access to your Bizzux apps.</p>
          </div>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>+ New User</button>
        </div>

        {err && <p className="error" style={{ marginBottom: 14 }}>{err}</p>}

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
                    <td>{[m.firstName, m.lastName].filter(Boolean).join(" ") || "—"}</td>
                    <td>{m.email}</td>
                    <td>{m.role || "—"}</td>
                    <td>{m.profile}</td>
                    <td>
                      <span className={"status-pill " + (m.status === "active" ? "active" : "trial")}>
                        {m.status === "active" ? "Active" : "Invited"}
                      </span>
                    </td>
                    <td>
                      {!m.isOwner && (
                        <div className="row" style={{ gap: 14 }}>
                          {m.status !== "active" && (
                            <button className="link-btn" onClick={() => resend(m.id)}>Resend</button>
                          )}
                          <button className="link-btn danger" onClick={() => remove(m.id)}>Remove</button>
                        </div>
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
          onAdded={async () => { setShowAdd(false); await load(); }}
        />
      )}
    </div>
  );
}

function AddUserModal({ onClose, onAdded }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState("");
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
      setError("Enter a valid email address");
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
      await api("/api/team", "POST", { action: "invite", firstName, lastName, email, profile });
      onAdded();
    } catch (e2) {
      setError(e2.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 18 }}>Add New User</h2>
        <form onSubmit={submit} noValidate>
          <div style={{ marginBottom: 12 }}>
            <label className="label">First name *</label>
            <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus required />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Last name</label>
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div style={{ marginBottom: 4 }}>
            <label className="label">Email *</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            An invitation will be sent to this email address.
          </p>
          <div style={{ marginBottom: 20 }}>
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
            <button className="btn-primary" disabled={busy}>{busy ? "Sending…" : "Save"}</button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}

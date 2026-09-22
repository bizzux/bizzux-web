"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import Link from "next/link";
import Nav from "@/components/Nav";
import AccountTabs from "@/components/AccountTabs";
import { useMe } from "@/lib/useMe";
import { roleLabel } from "@/lib/roleLabel";

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

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

// Password policy (governs passwords Bizzux itself sets — see
// app/api/team/security/route.js's file comment) plus a read-only view of
// this org's own audit trail. Deliberately not a full SSO/IAM console —
// see the conversation this was scoped from: just the two realistic pieces
// at Bizzux's current size, reusing the existing team/apps/groups page shell.
export default function SecurityPage() {
  const router = useRouter();
  const { user, me } = useMe();
  const isAdmin = me ? me.isAccountAdmin === true : null;
  const isSuper = me?.superAdmin === true;
  const myRoleLabel = isSuper ? "Platform " + (me?.platformRole === "OWNER" ? "Owner" : "Admin") : roleLabel(me);

  const [policy, setPolicy] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [err, setErr] = useState("");
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    if (user === null) router.push("/sign-in");
  }, [user, router]);

  async function load() {
    try {
      const [p, l] = await Promise.all([
        api("/api/team/security", "GET"),
        api("/api/team/audit-log", "GET"),
      ]);
      setPolicy(p.policy);
      setLogs(l.logs || []);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    if (!user || !me) return;
    if (me.isAccountAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, me]);

  async function savePolicy(e) {
    e.preventDefault();
    setSaving(true);
    setSavedMsg("");
    setErr("");
    try {
      const d = await api("/api/team/security", "POST", policy);
      setPolicy(d.policy);
      setSavedMsg("Saved.");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSaving(false);
    }
  }

  if (!user || isAdmin === null) {
    return (
      <div>
        <Nav />
        <AccountTabs active="team-security" isAccountAdmin={!!isAdmin} isSuper={isSuper} roleLabel={myRoleLabel} />
        <div className="admin-shell"><p className="muted">Loading…</p></div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div>
        <Nav />
        <AccountTabs active="team-security" isAccountAdmin={false} isSuper={isSuper} roleLabel={myRoleLabel} />
        <div className="admin-shell">
          <p>You don&apos;t have access to this page.</p>
          <Link href="/dashboard" className="btn-primary-sm">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Nav />
      <AccountTabs active="team-security" isAccountAdmin={isAdmin} isSuper={isSuper} roleLabel={myRoleLabel} />
      <div className="admin-shell">
        <h1 className="dash-heading" style={{ fontSize: 20 }}>Security</h1>
        <p className="dash-sub">Password requirements for teammates you add directly, and a log of sensitive actions on your team.</p>

        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

        <div className="card" style={{ marginBottom: 24, maxWidth: 480 }}>
          <h3 style={{ marginTop: 0 }}>Password Policy</h3>
          {!policy && !err && <p className="muted">Loading…</p>}
          {policy && (
            <form onSubmit={savePolicy}>
              <div style={{ marginBottom: 14 }}>
                <label className="label">Minimum length</label>
                <input
                  className="input" type="number" min={6} max={64} style={{ maxWidth: 120 }}
                  value={policy.minLength}
                  onChange={(e) => setPolicy((p) => ({ ...p, minLength: Number(e.target.value) }))}
                />
              </div>
              <label className="checkbox-row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <input
                  type="checkbox" checked={policy.requireMixedCase}
                  onChange={(e) => setPolicy((p) => ({ ...p, requireMixedCase: e.target.checked }))}
                />
                <span style={{ fontSize: 13.5 }}>Require both uppercase and lowercase letters</span>
              </label>
              <label className="checkbox-row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
                <input
                  type="checkbox" checked={policy.requireNumber}
                  onChange={(e) => setPolicy((p) => ({ ...p, requireNumber: e.target.checked }))}
                />
                <span style={{ fontSize: 13.5 }}>Require at least one number</span>
              </label>
              <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
                Only applies when you set a teammate's password directly (Team &gt; "Add via credentials" or "Set password") —
                not to teammates who set their own password via an email invite.
              </p>
              <button className="btn-primary-sm" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
              {savedMsg && <span className="muted" style={{ marginLeft: 10, fontSize: 12.5 }}>{savedMsg}</span>}
            </form>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Audit Log</h3>
          {logs === null && !err && <p className="muted">Loading…</p>}
          {logs && logs.length === 0 && <p className="muted">No recorded activity yet.</p>}
          {logs && logs.length > 0 && (
            <table className="table">
              <thead><tr><th>When</th><th>Action</th><th>By</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(l.createdAt)}</td>
                    <td>{l.action}</td>
                    <td>{l.actorEmail || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import AdminNav from "@/components/AdminNav";
import AccountTabs from "@/components/AccountTabs";
import { useMe } from "@/lib/useMe";
import { useIsAdminHost, wwwHrefFor } from "@/lib/adminLinks";

async function api(path, method, body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(path, { method, headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// The companies this login belongs to, and which one is active. Reuses /api/organizations and /api/switch-organization (server-validated against the
// membership record); nothing here decides access.
export default function OrganizationsPage() {
  const router = useRouter();
  const onAdminHost = useIsAdminHost();
  const { user, me } = useMe();
  const isAdmin = me ? me.isAccountAdmin === true : null;
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => { if (user === null) router.push("/sign-in"); }, [user, router]);
  // The switchable companies and the active one come from /api/me (the same source the rest of the portal uses; the active company is the one
  // the server resolves for every app). A login with a single company just shows that company.
  const current = me?.activeOrganizationId || null;
  const orgs = me ? (me.organizations || (me.organizationName ? [{ id: current || "current", name: me.organizationName, role: me.profile || "" }] : [])) : null;

  async function switchTo(id) {
    setBusy(id); setErr("");
    try { await api("/api/switch-organization", "POST", { organizationId: id }); window.location.reload(); } catch (e) { setErr(e.message); setBusy(""); }
  }

  if (!user || isAdmin === null) return <div><AdminNav active="team-orgs" /><div className="admin-shell"><p className="muted">Loading…</p></div></div>;
  if (!isAdmin) return (<div><AdminNav active="team-orgs" /><div className="admin-shell"><p>You don&apos;t have access to this page.</p><a href={wwwHrefFor(onAdminHost, "/dashboard")} className="btn-primary-sm">Back to dashboard</a></div></div>);

  return (
    <div>
      <AdminNav active="team-orgs" />
      <AccountTabs active="team-orgs" isAccountAdmin />
      <div className="admin-shell">
        <div style={{ marginBottom: 18 }}>
          <h1 className="dash-heading" style={{ fontSize: 20 }}>Organizations</h1>
          <p className="dash-sub" style={{ marginBottom: 0 }}>The companies this login belongs to. Switching changes which company every Bizzux app shows you.</p>
        </div>
        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}
        {orgs === null ? <p className="muted">Loading…</p> : orgs.length === 0 ? <p className="muted">No organizations found.</p> : (
          <div className="card" style={{ padding: 0 }}>
            {orgs.map((o) => (
              <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid #eef2f7" }}>
                <div style={{ flex: 1 }}>
                  <strong>{o.name || "Organization"}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>{o.role || ""}</div>
                </div>
                {(o.id === current || orgs.length === 1) ? <span className="badge">Active</span> : <button className="btn-primary-sm" disabled={!!busy} onClick={() => switchTo(o.id)}>{busy === o.id ? "Switching…" : "Switch"}</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

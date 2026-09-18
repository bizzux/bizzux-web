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

// "Organization > Apps" — which Bizzux apps this org is subscribed to, and
// how many members are assigned to each. Subscription status itself isn't
// editable here (see lib/appAccess.js's file comment — that's an
// entitlement lever, provisioned automatically for now); only WHO on the
// team can use an app the org already has is something the org's own
// admin controls, via "Manage Users".
export default function OrganizationAppsPage() {
  const router = useRouter();
  const { user, me } = useMe();
  const isAdmin = me ? me.isAccountAdmin === true : null;
  const isSuper = me?.superAdmin === true;
  const myRoleLabel = isSuper ? "Platform " + (me?.platformRole === "OWNER" ? "Owner" : "Admin") : roleLabel(me);
  const [apps, setApps] = useState(null);
  const [err, setErr] = useState("");
  const [managingAppId, setManagingAppId] = useState(null);

  useEffect(() => {
    if (user === null) router.push("/sign-in");
  }, [user, router]);

  async function load() {
    try {
      const d = await api("/api/organization/apps", "GET");
      setApps(d.apps || []);
    } catch (e) {
      setErr(e.message);
      setApps([]);
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
        <AccountTabs active="team-apps" isAccountAdmin={!!isAdmin} isSuper={isSuper} roleLabel={myRoleLabel} />
        <div className="admin-shell"><p className="muted">Loading…</p></div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div>
        <Nav />
        <AccountTabs active="team-apps" isAccountAdmin={false} isSuper={isSuper} roleLabel={myRoleLabel} />
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
      <AccountTabs active="team-apps" isAccountAdmin={!!isAdmin} isSuper={isSuper} roleLabel={myRoleLabel} />

      <div className="admin-shell">
        <div style={{ marginBottom: 18 }}>
          <h1 className="dash-heading" style={{ fontSize: 20 }}>Apps</h1>
          <p className="dash-sub" style={{ marginBottom: 0 }}>Which Bizzux apps your organization has, and who on your team can use each one.</p>
        </div>

        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

        {apps === null && <p className="muted">Loading…</p>}
        {apps && apps.map((a) => (
          <div key={a.appId} className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <h3 style={{ margin: "0 0 4px" }}>{a.name}</h3>
                <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                  <span className={"status-pill " + (a.status === "ACTIVE" ? "active" : "expired")}>
                    {a.status === "ACTIVE" ? "Active" : "Inactive"}
                  </span>
                  {a.subscriptionType && <span className="muted" style={{ fontSize: 12 }}>{a.subscriptionType}</span>}
                  <span className="muted" style={{ fontSize: 12 }}>Assigned users: {a.assignedCount}</span>
                </div>
              </div>
              <button className="btn-small" onClick={() => setManagingAppId(a.appId)}>
                Manage Users
              </button>
            </div>
          </div>
        ))}
      </div>

      {managingAppId && (
        <ManageUsersModal appId={managingAppId} onClose={() => setManagingAppId(null)} onChanged={load} />
      )}
    </div>
  );
}

function ManageUsersModal({ appId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busyUid, setBusyUid] = useState(null);

  async function load() {
    try {
      setData(await api(`/api/organization/apps/${appId}`, "GET"));
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  async function toggle(m) {
    setBusyUid(m.uid);
    try {
      await api(`/api/organization/apps/${appId}`, "POST", { uid: m.uid, assigned: !m.assigned });
      await load();
      onChanged && onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h2 style={{ marginBottom: 4 }}>{data?.appName || "Manage users"}</h2>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>Choose who on your team can use this app.</p>
        {err && <p className="error">{err}</p>}
        {!data && !err && <p className="muted">Loading…</p>}
        {data && data.members.map((m) => (
          <div key={m.uid} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <div>
              <div style={{ fontSize: 13.5 }}>{m.name}{m.isOwner && " (Owner)"}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>{m.email}</div>
            </div>
            <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
              <input
                type="checkbox" checked={m.assigned} disabled={busyUid === m.uid || m.isOwner}
                onChange={() => toggle(m)}
              />
              Assigned
            </label>
          </div>
        ))}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn-outline-dark" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

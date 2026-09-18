"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import Link from "next/link";
import Nav from "@/components/Nav";
import AccountTabs from "@/components/AccountTabs";
import { useMe } from "@/lib/useMe";
import { APPS } from "@/lib/appCatalog";

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

// Groups: a named set of existing team members, used to grant several
// people app access at once (see lib/organizationGroups.js's file comment
// — a one-time bulk action, not a live permission-inheritance system).
export default function GroupsPage() {
  const router = useRouter();
  const { user, me } = useMe();
  const isAdmin = me ? me.isAccountAdmin === true : null;
  const [groups, setGroups] = useState(null);
  const [err, setErr] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [managingGroup, setManagingGroup] = useState(null); // { id, name } | null

  useEffect(() => {
    if (user === null) router.push("/sign-in");
  }, [user, router]);

  async function load() {
    try {
      const d = await api("/api/organization/groups", "GET");
      setGroups(d.groups || []);
    } catch (e) {
      setErr(e.message);
      setGroups([]);
    }
  }

  useEffect(() => {
    if (!user || !me) return;
    if (me.isAccountAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, me]);

  async function createGroup(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setErr("");
    try {
      await api("/api/organization/groups", "POST", { action: "create", name: newName.trim() });
      setNewName("");
      await load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setCreating(false);
    }
  }

  async function removeGroup(groupId) {
    if (!confirm("Delete this group? This doesn't remove anyone's existing app access, just the group itself.")) return;
    try {
      await api("/api/organization/groups", "POST", { action: "delete", groupId });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  if (!user || isAdmin === null) {
    return (
      <div>
        <Nav />
        <AccountTabs active="team-groups" isAccountAdmin={!!isAdmin} />
        <div className="admin-shell"><p className="muted">Loading…</p></div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div>
        <Nav />
        <AccountTabs active="team-groups" isAccountAdmin={false} />
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
      <AccountTabs active="team-groups" isAccountAdmin={!!isAdmin} />

      <div className="admin-shell">
        <div style={{ marginBottom: 18 }}>
          <h1 className="dash-heading" style={{ fontSize: 20 }}>Groups</h1>
          <p className="dash-sub" style={{ marginBottom: 0 }}>Grant several people app access at once by grouping them together.</p>
        </div>

        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

        <form onSubmit={createGroup} className="row" style={{ gap: 8, marginBottom: 18 }}>
          <input className="input" style={{ maxWidth: 260 }} placeholder="New group name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn-primary-sm" disabled={creating}>{creating ? "Creating…" : "+ New group"}</button>
        </form>

        {groups === null && <p className="muted">Loading…</p>}
        {groups && groups.length === 0 && <p className="muted">No groups yet.</p>}
        {groups && groups.map((g) => (
          <div key={g.id} className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: "0 0 4px" }}>{g.name}</h3>
                <span className="muted" style={{ fontSize: 12 }}>{g.memberCount} member{g.memberCount === 1 ? "" : "s"}</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn-small" onClick={() => setManagingGroup(g)}>Manage</button>
                <button className="link-btn danger" onClick={() => removeGroup(g.id)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {managingGroup && (
        <ManageGroupModal group={managingGroup} onClose={() => setManagingGroup(null)} onChanged={load} />
      )}
    </div>
  );
}

function ManageGroupModal({ group, onClose, onChanged }) {
  const [data, setData] = useState(null); // { members, availableToAdd }
  const [err, setErr] = useState("");
  const [grantApps, setGrantApps] = useState(() =>
    Object.fromEntries(APPS.map((a) => [a.id, { granted: false, admin: false }]))
  );
  const [granting, setGranting] = useState(false);
  const [grantResult, setGrantResult] = useState(null);

  async function load() {
    try {
      setData(await api(`/api/organization/groups/${group.id}`, "GET"));
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addMember(userId) {
    try {
      await api(`/api/organization/groups/${group.id}`, "POST", { action: "addMember", userId });
      await load();
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function removeMember(userId) {
    try {
      await api(`/api/organization/groups/${group.id}`, "POST", { action: "removeMember", userId });
      await load();
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
  }

  function toggleApp(appId, field, value) {
    setGrantApps((cur) => ({ ...cur, [appId]: { ...cur[appId], [field]: value, ...(field === "admin" && value ? { granted: true } : {}) } }));
  }

  async function submitGrant() {
    setGranting(true);
    setErr("");
    try {
      const apps = Object.entries(grantApps)
        .filter(([, v]) => v.granted)
        .map(([appId, v]) => ({ appId, admin: v.admin }));
      const d = await api(`/api/organization/groups/${group.id}`, "POST", { action: "grantApps", apps });
      setGrantResult(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setGranting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h2 style={{ marginBottom: 4 }}>{group.name}</h2>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>Manage members and grant app access to everyone in this group at once.</p>

        {err && <p className="error">{err}</p>}
        {!data && !err && <p className="muted">Loading…</p>}

        {data && (
          <>
            <label className="label">Members</label>
            {data.members.length === 0 && <p className="muted" style={{ fontSize: 12.5 }}>No members yet.</p>}
            {data.members.map((m) => (
              <div key={m.uid} className="row" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                <div>
                  <div style={{ fontSize: 13.5 }}>{m.name}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{m.email}</div>
                </div>
                <button className="link-btn danger" onClick={() => removeMember(m.uid)}>Remove</button>
              </div>
            ))}

            {data.availableToAdd.length > 0 && (
              <div style={{ marginTop: 10, marginBottom: 16 }}>
                <select className="input" value="" onChange={(e) => e.target.value && addMember(e.target.value)}>
                  <option value="" disabled>+ Add a member</option>
                  {data.availableToAdd.map((m) => (
                    <option key={m.uid} value={m.uid}>{m.name} ({m.email})</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              <label className="label">Grant apps to everyone in this group</label>
              {grantResult ? (
                <p className="muted" style={{ fontSize: 12.5 }}>
                  Granted {grantResult.appCount} app{grantResult.appCount === 1 ? "" : "s"} to {grantResult.memberCount} member{grantResult.memberCount === 1 ? "" : "s"}.
                </p>
              ) : (
                <>
                  {APPS.map((a) => {
                    const v = grantApps[a.id];
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
                  <button className="btn-primary-sm" style={{ marginTop: 10 }} disabled={granting} onClick={submitGrant}>
                    {granting ? "Granting…" : "Grant to group"}
                  </button>
                </>
              )}
            </div>
          </>
        )}

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn-outline-dark" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

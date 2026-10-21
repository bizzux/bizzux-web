"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { PROFILES, ORGANIZATION_ROLES, ACCOUNT_ADMIN_PROFILES } from "@/lib/roles";
import { APPS, appName } from "@/lib/appCatalog";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import { useIsAdminHost, wwwHrefFor } from "@/lib/adminLinks";
import AccountTabs from "@/components/AccountTabs";
import JoinRequestsPanel from "@/components/JoinRequestsPanel";
import { useMe } from "@/lib/useMe";
import { CommandBar, Cmd, CmdMenu, CmdSep, Pager } from "@/components/admin/CommandBar";
import { sortRows, paginate, toCsv } from "@/lib/adminTable";
import { USER_COLUMNS, DEFAULT_COLUMNS, cleanColumns } from "@/lib/adminColumns";
import ColumnChooser from "@/components/admin/ColumnChooser";
import AddUserWizard from "@/components/admin/AddUserWizard";
import ResetPasswordDrawer from "@/components/admin/ResetPasswordDrawer";
import UserDetailsDrawer from "@/components/admin/UserDetailsDrawer";
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

const ORG_SOURCE = { owner: "company owner", explicit: "set by an administrator", "legacy-profile": "from business profile" };
const LOGIN_LABEL = { google: "Google", email: "Email & password", username: "Bizzux username", "attendance-username": "Attendance username" };

// Merge the legacy team list (row actions need its ids) with the canonical IAM directory (login type, last sign-in, app access). People who exist
// only in the directory (for example Attendance username logins) are shown read-only.
function mergeRows(members, directory, f) {
  const dir = new Map((directory?.users || []).map((u) => [u.uid, u]));
  const seen = new Set();
  const ownerDir = (directory?.users || []).find((u) => u.orgRole === "OWNER");
  const rows = (members || []).map((m) => {
    const d = m.uid ? dir.get(m.uid) : m.isOwner ? ownerDir : null; // the legacy owner row has no uid: it is the directory's OWNER
    if (d) seen.add(d.uid);
    return {
      ...m, firstName: m.firstName || d?.name || "", loginKind: d?.loginKind || (m.username ? "username" : m.email ? "email" : ""), lastSignIn: d?.lastSignIn || null,
      appIds: d?.apps || null, appAccess: d ? d.apps.map(appName) : m.appAccess,
      orgRoleEffective: d?.orgRoleEffective || null, orgRoleSource: d?.orgRoleSource || null,
      appChips: d ? d.effective.filter((e) => e.access).map((e) => ({ name: appName(e.appId), role: e.appRole, source: e.source })) : null,
    };
  });
  (directory?.users || []).filter((u) => !seen.has(u.uid)).forEach((u) => rows.push({
    id: "dir_" + u.uid, uid: u.uid, dirOnly: true, firstName: u.name || u.username, lastName: "", email: u.email, username: u.username,
    role: "", profile: u.profile, orgRole: u.orgRoleEffective || u.orgRole, orgRoleEffective: u.orgRoleEffective, orgRoleSource: u.orgRoleSource, appChips: u.effective.filter((e) => e.access).map((e) => ({ name: appName(e.appId), role: e.appRole, source: e.source })), appAccess: u.apps.map(appName), appIds: u.apps, loginKind: u.loginKind, lastSignIn: u.lastSignIn,
    status: u.disabled ? "disabled" : u.pendingActivation ? "invited" : "active",
  }));
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && ![r.firstName, r.lastName, r.email, r.username].some((x) => String(x || "").toLowerCase().includes(q))) return false;
    if (f.login && r.loginKind !== f.login) return false;
    if (f.role && (r.orgRoleEffective || r.orgRole) !== f.role) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.app === "none") return !(r.appAccess || []).length;
    if (f.app && !(r.appIds || []).includes(f.app)) return false;
    return true;
  });
}

export default function TeamPage() {
  const router = useRouter();
  const onAdminHost = useIsAdminHost();
  // useMe() (lib/useMe.js) shares this /api/me lookup with Nav instead of
  // each firing its own duplicate request, and starts a remount from the
  // last known answer instead of a blank "checking…" state.
  const { user, me } = useMe();
  const isAdmin = me ? me.isAccountAdmin === true : null; // null = checking
  const isSuper = me?.superAdmin === true;
  const canAssignAdmin = isSuper || (me?.orgPermissions || []).includes("roles.assign_admin"); // only an Owner can make or remove an Admin; the server enforces it
  const myRoleLabel = isSuper ? "Platform " + (me?.platformRole === "OWNER" ? "Owner" : "Admin") : roleLabel(me);
  const [members, setMembers] = useState(null);
  const [organizationName, setOrganizationName] = useState(null);
  const [directory, setDirectory] = useState(null); // canonical rows from the shared IAM service (/api/iam/directory), null until loaded
  const [filters, setFilters] = useState({ q: "", login: "", status: "", app: "", role: "" });
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [pageNo, setPageNo] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { setPageNo(0); }, [filters, sort.key, sort.dir, pageSize]);
  // Choose columns: the administrator's own saved column set (server validated), shown or hidden per column.
  const [wizard, setWizard] = useState({ open: false, method: "username" });
  const [detail, setDetail] = useState(null); // the row whose details drawer is open
  const [resetFor, setResetFor] = useState(null); // the row whose reset-password drawer is open
  const [colKeys, setColKeys] = useState(DEFAULT_COLUMNS);
  const [showCols, setShowCols] = useState(false);
  const [savingCols, setSavingCols] = useState(false);
  const [colErr, setColErr] = useState("");
  useEffect(() => {
    if (!user || !me?.isAccountAdmin) return;
    api("/api/iam/prefs", "GET").then((d) => setColKeys(cleanColumns(d.activeUsers?.columns))).catch(() => { /* defaults stay */ });
  }, [user, me]); // eslint-disable-line react-hooks/exhaustive-deps
  async function saveCols(cols) {
    setSavingCols(true); setColErr("");
    try { const d = await api("/api/iam/prefs", "PUT", { activeUsers: { columns: cols } }); setColKeys(cleanColumns(d.activeUsers.columns)); setShowCols(false); }
    catch (e) { setColErr(e.message); }
    setSavingCols(false);
  }
  const [selected, setSelected] = useState(() => new Set()); // row ids ticked for a bulk action
  const [bulkApp, setBulkApp] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showUsernameAdd, setShowUsernameAdd] = useState(false);
  const [showLink, setShowLink] = useState(false);
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
      // The shared IAM directory adds login type, last sign-in and canonical app access. If it is unavailable the page still works from /api/team.
      api("/api/iam/directory", "GET").then(setDirectory).catch(() => setDirectory({ users: [], enabledApps: [], unavailable: true }));
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

  const rows = mergeRows(members, directory, filters);
  const sorted = sortRows(rows, sort);
  const pg = paginate(sorted, pageNo, pageSize);
  const sortTh = (key, label, title) => (
    <th className="adm-sortable" title={title} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => setSort((c) => (c.key === key ? { key, dir: c.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }))}>
        {label}<span className="adm-sortmark" aria-hidden="true">{sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
  // Bulk selection: the Owner is never selectable; "select all" means every selectable row that matches the current filters.
  const selectable = (r) => !!r.uid && !r.isOwner && r.orgRoleEffective !== "OWNER";
  const visibleSelectable = rows.filter(selectable);
  const chosen = visibleSelectable.filter((r) => selected.has(r.id));
  const allTicked = visibleSelectable.length > 0 && chosen.length === visibleSelectable.length;
  const toggleAll = () => setSelected(allTicked ? new Set() : new Set(visibleSelectable.map((r) => r.id)));
  const toggleOne = (id) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const colLabel = Object.fromEntries(USER_COLUMNS.map((c) => [c.key, c.label]));
  const headCell = (k) => {
    if (k === "name") return sortTh("name", "Name");
    if (k === "signin") return sortTh("signin", "Sign-in");
    if (k === "orgRole") return sortTh("orgRole", "Organization role", "What this person may do in the ORGANIZATION: users, roles, app assignment. Grants no application permission.");
    if (k === "status") return sortTh("status", "Status");
    if (k === "lastSignIn") return sortTh("lastSignIn", "Last sign-in");
    if (k === "created") return sortTh("created", "Created date");
    if (k === "apps") return <th key={k} title="Per application: the role inside that app and where the access comes from. Granted separately from the organization role.">{colLabel[k]}</th>;
    if (k === "profile") return <th key={k} title="Describes the job in the business apps. Separate from the organization role and from app roles.">{colLabel[k]}</th>;
    return <th key={k}>{colLabel[k]}</th>;
  };
  const dash = <span className="muted">—</span>;
  const cellFor = (k, m) => {
    switch (k) {
      case "name": return m.uid ? <button type="button" className="adm-namebtn" onClick={() => setDetail(m)} title="Open details">{[m.firstName, m.lastName].filter(Boolean).join(" ") || m.username || m.email || "N/A"}</button> : ([m.firstName, m.lastName].filter(Boolean).join(" ") || "N/A");
      case "signin": return (<><div>{m.email || (m.username ? "@" + m.username : "")}</div><div className="muted" style={{ fontSize: 11.5 }}>{LOGIN_LABEL[m.loginKind] || ""}</div></>);
      case "method": return LOGIN_LABEL[m.loginKind] || dash;
      case "orgRole": return (
        <>
          {m.isOwner || m.orgRole === "OWNER" ? "OWNER" : m.dirOnly ? m.orgRole : (
            <select className="input" style={{ fontSize: 12.5, padding: "3px 6px" }} value={m.orgRoleEffective || m.orgRole} onChange={(e) => changeOrgRole(m, e.target.value)}
              disabled={!canAssignAdmin && (m.orgRoleEffective || m.orgRole) === "ADMIN"}>
              {ORGANIZATION_ROLES.filter((r) => r !== "OWNER").map((r) => (<option key={r} value={r} disabled={r === "ADMIN" && !canAssignAdmin}>{r}</option>))}
            </select>
          )}
          <div className="muted" style={{ fontSize: 11 }}>{ORG_SOURCE[m.orgRoleSource] || ""}</div>
        </>
      );
      case "apps": return (m.appChips || m.appAccess || []).length > 0 ? (
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {(m.appChips || m.appAccess.map((name) => ({ name }))).map((c) => (
            <span key={c.name} className="status-pill active" style={{ fontSize: 11 }} title={c.source ? "Source: " + (c.source === "assignment" ? "assigned to this person" : c.source === "owner" ? "company owner" : c.source) : ""}>{c.name}{c.role ? " · " + (c.role === "ADMIN" ? "Admin" : "Member") : ""}</span>
          ))}
        </div>
      ) : <span className="muted" style={{ fontSize: 12 }}>None</span>;
      case "status": return (<span className={"status-pill " + (m.status === "active" ? "active" : m.status === "disabled" ? "expired" : "trial")}>{m.status === "active" ? "Active" : m.status === "disabled" ? "Disabled" : "Invited"}</span>);
      case "lastSignIn": return <span className="muted" style={{ fontSize: 12 }}>{m.lastSignIn ? new Date(m.lastSignIn).toLocaleDateString() : "—"}</span>;
      case "created": return <span className="muted" style={{ fontSize: 12 }}>{m.created ? new Date(m.created).toLocaleDateString() : "—"}</span>;
      case "jobTitle": return m.designation || dash;
      case "profile": return m.isOwner ? dash : PROFILES.find((p) => p.value === m.profile)?.label || m.profile || dash;
      case "department": return m.department || dash;
      case "branch": return m.branch || dash;
      case "employeeId": return m.employeeId || dash;
      case "employmentType": return m.employmentType || dash;
      default: return null;
    }
  };
  const one = chosen.length === 1 ? chosen[0] : null;
  function resetForSelected() { if (one) setResetFor(one); }
  async function removeSelected() {
    const list = chosen.filter((r) => !r.dirOnly);
    if (!list.length) { setErr("Nothing removable is selected."); return; }
    if (!window.confirm("Remove " + list.length + " " + (list.length === 1 ? "person" : "people") + " from your company? They keep their Bizzux login and any other companies, and you can restore them for 60 days.")) return;
    setErr(""); setBulkMsg("Working…");
    let ok = 0; const failed = [];
    for (const r of list) { try { await api("/api/team", "POST", { action: "remove", id: r.id }); ok++; } catch (e) { failed.push((r.firstName || r.username || r.email) + ": " + e.message); } }
    setBulkMsg(ok + " removed" + (failed.length ? ", " + failed.length + " failed (" + failed.slice(0, 3).join("; ") + ")" : ""));
    setSelected(new Set());
    await load();
  }
  function exportCsv() {
    const blob = new Blob(["\ufeff" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "bizzux-users-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function bulk(kind) {
    if (!chosen.length) return;
    const label = kind === "disable" ? "disable" : kind === "grant" ? "give " + appName(bulkApp) + " to" : "remove " + appName(bulkApp) + " from";
    if ((kind !== "disable" && !bulkApp) || !window.confirm("Really " + label + " " + chosen.length + " user" + (chosen.length === 1 ? "" : "s") + "?")) return;
    setErr(""); setBulkMsg("Working…");
    let ok = 0; const failed = [];
    for (const r of chosen) {
      try {
        if (kind === "disable") {
          if (r.dirOnly || r.status === "disabled") continue;
          await api("/api/team", "POST", { action: "disable", id: r.id });
        } else {
          const cur = r.appIds || [];
          const next = kind === "grant" ? [...new Set([...cur, bulkApp])] : cur.filter((a) => a !== bulkApp);
          await api("/api/iam/identities", "POST", { kind: "apps", uid: r.uid, apps: next });
        }
        ok++;
      } catch (e) { failed.push((r.firstName || r.username || r.email || r.uid) + ": " + e.message); }
    }
    setBulkMsg(ok + " done" + (failed.length ? ", " + failed.length + " failed (" + failed.slice(0, 3).join("; ") + ")" : ""));
    setSelected(new Set());
    await load();
  }

  if (!user || isAdmin === null) {
    return (
      <div>
        <AdminNav active="team" />
        <AccountTabs active="team" isAccountAdmin={!!isAdmin} isSuper={isSuper} roleLabel={myRoleLabel} />
        <div className="admin-shell"><p className="muted">Loading…</p></div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div>
        <AdminNav active="team" />
        <AccountTabs active="team" isAccountAdmin={false} isSuper={isSuper} roleLabel={myRoleLabel} />
        <div className="admin-shell">
          <p>You don&apos;t have access to this page.</p>
          <a href={wwwHrefFor(onAdminHost, "/dashboard")} className="btn-primary-sm">Back to dashboard</a>
        </div>
      </div>
    );
  }

  async function remove(id) {
    if (!confirm("Remove this person from your company? They keep their Bizzux login and any other companies, and you can restore them for 60 days.")) return;
    try {
      await api("/api/team", "POST", { action: "remove", id });
      setErr("");
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function usernameAction(m, action) {
    if (action !== "unlock" && !window.confirm("Continue? This signs " + m.username + " out and issues new credentials.")) return;
    setBusyId(m.id);
    try {
      // A pending account is re-issued through the shared IAM service (organization-role authorization, home-company rule, audit); everything else keeps its action.
      const d = action === "resetPassword" && m.status === "invited"
        ? await api("/api/iam/identities", "POST", { kind: "reissue", uid: m.uid })
        : await api("/api/admin/username-users", "POST", { action, uid: m.uid });
      if (d.password) setCredentials({ email: m.username, password: d.password });
      if (d.recoveryCodes) setCredentials({ email: m.username, password: "(unchanged) — recovery codes: " + d.recoveryCodes.join("  ") });
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setBusyId(null);
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
      <AdminNav active="team" />
      <AccountTabs active="team" isAccountAdmin={!!isAdmin} isSuper={isSuper} roleLabel={myRoleLabel} />

      <div className="admin-shell">
        <JoinRequestsPanel />
        <h1 className="dash-heading" style={{ fontSize: 22, margin: "4px 0 0" }}>Active users</h1>
        {organizationName && <p className="muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>{organizationName}</p>}
        <CommandBar label="User actions">
          <CmdMenu primary icon="plus" label="Add a user" items={[
            { label: "Create user (username and password)", icon: "plus", onClick: () => setWizard({ open: true, method: "username" }) },
            { label: "Invite user (Google or email)", icon: "people", onClick: () => setWizard({ open: true, method: "invite" }) },
            { label: "Link existing user", icon: "link", onClick: () => setWizard({ open: true, method: "link" }) },
          ]} />
          <Cmd icon="people" onClick={() => setShowBulkAdd(true)}>Add multiple users</Cmd>
          <CmdSep />
          <Cmd icon="key" onClick={resetForSelected} disabled={!one} title={one ? "" : "Select exactly one user"}>Reset password</Cmd>
          <Cmd icon="trash" onClick={removeSelected} disabled={!chosen.length} title={chosen.length ? "" : "Select one or more users"}>Remove from company</Cmd>
          <CmdSep />
          <Cmd icon="download" onClick={exportCsv} disabled={!rows.length} title="Exports the users matching the current filters">Export users</Cmd>
          <Cmd icon="refresh" onClick={() => { setBulkMsg(""); load(); }}>Refresh</Cmd>
          <Cmd icon="columns" onClick={() => { setColErr(""); setShowCols(true); }}>Choose columns</Cmd>
        </CommandBar>

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

        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input className="input" style={{ maxWidth: 240 }} placeholder="Search name, email or username" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
            <select className="input" style={{ maxWidth: 180 }} value={filters.login} onChange={(e) => setFilters({ ...filters, login: e.target.value })}>
              <option value="">All sign-in types</option>
              {Object.entries(LOGIN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="input" style={{ maxWidth: 170 }} value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })} aria-label="Organization role">
              <option value="">Any organization role</option><option value="OWNER">Owner</option><option value="ADMIN">Admin</option><option value="MEMBER">Member</option><option value="VIEWER">Viewer</option>
            </select>
            <select className="input" style={{ maxWidth: 160 }} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">Any status</option><option value="active">Active</option><option value="invited">Invited / not activated</option><option value="disabled">Disabled</option>
            </select>
            <select className="input" style={{ maxWidth: 190 }} value={filters.app} onChange={(e) => setFilters({ ...filters, app: e.target.value })}>
              <option value="">Any app access</option><option value="none">No app access</option>
              {(directory?.enabledApps || []).map((a) => <option key={a} value={a}>{appName(a)}</option>)}
            </select>
            {(filters.q || filters.login || filters.status || filters.app || filters.role) && <button className="link-btn" onClick={() => setFilters({ q: "", login: "", status: "", app: "", role: "" })}>Clear</button>}
          </div>
        </div>

        {(chosen.length > 0 || bulkMsg) && (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <strong style={{ fontSize: 13 }}>{chosen.length} selected</strong>
              <select className="input" style={{ maxWidth: 200 }} value={bulkApp} onChange={(e) => setBulkApp(e.target.value)} aria-label="Application for bulk grant or remove">
                <option value="">Choose an app…</option>
                {(directory?.enabledApps || []).map((a) => <option key={a} value={a}>{appName(a)}</option>)}
              </select>
              <button className="btn-outline-dark" disabled={!chosen.length || !bulkApp} onClick={() => bulk("grant")}>Give access</button>
              <button className="btn-outline-dark" disabled={!chosen.length || !bulkApp} onClick={() => bulk("revoke")}>Remove access</button>
              <button className="btn-outline-dark" disabled={!chosen.length} onClick={() => bulk("disable")}>Disable</button>
              <button className="link-btn" onClick={() => { setSelected(new Set()); setBulkMsg(""); }}>Clear selection</button>
              {bulkMsg && <span className="muted" style={{ fontSize: 12.5 }}>{bulkMsg}</span>}
            </div>
          </div>
        )}

        <div className="card">
          {members === null && <p className="muted">Loading…</p>}
          {members && members.length === 0 && <p className="muted">No teammates yet.</p>}
          {members && rows.length === 0 && members.length > 0 && <p className="muted">No users match these filters.</p>}
          {members && rows.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}><input type="checkbox" aria-label="Select all users shown" checked={allTicked} onChange={toggleAll} disabled={!visibleSelectable.length} /></th>{colKeys.map((k) => headCell(k))}<th></th>
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((m) => (
                  <tr key={m.id}>
                    <td>{selectable(m) ? <input type="checkbox" aria-label={"Select " + (m.firstName || m.username || m.email)} checked={selected.has(m.id)} onChange={() => toggleOne(m.id)} /> : null}</td>
                    {colKeys.map((k) => <td key={k}>{cellFor(k, m)}</td>)}
                    <td>
                      {m.dirOnly && <span className="muted" style={{ fontSize: 11.5 }}>Read-only here: no team record</span>}
                      {!m.isOwner && !m.dirOnly && (
                        <TeamRowMenu
                          items={[
                            { label: "Manage roles & app access", onClick: () => setManagingMember(m) },
                            ...(m.status === "invited" ? [{ label: "Resend invite email", onClick: () => resend(m.id) }] : []),
                            ...(m.status !== "invited" ? [{ label: "Send password-reset email", onClick: () => resetPasswordEmail(m) }] : []),
                            ...(m.username ? [
                              { label: "Reset username password", onClick: () => usernameAction(m, "resetPassword") },
                              { label: "Unlock sign-in", onClick: () => usernameAction(m, "unlock") },
                              { label: "New recovery codes", onClick: () => usernameAction(m, "regenerateRecoveryCodes") },
                            ] : [
                              { label: busyId === m.id ? "Working…" : "Set new password directly", onClick: () => setPassword(m) },
                            ]),
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
          {members && rows.length > 0 && <Pager info={pg} onPage={setPageNo} onSize={setPageSize} />}
        </div>
      </div>

      <UserDetailsDrawer open={!!detail} uid={detail?.uid} row={detail} api={api} canAssignAdmin={canAssignAdmin} onClose={() => setDetail(null)}
        onResetPassword={(r) => { setDetail(null); setResetFor(r); }}
        onManageAccess={(r) => { if (r.dirOnly) { setErr("This person has no team record here, so roles and app access are changed from the Add or Link flows."); return; } setDetail(null); setManagingMember(r); }}
        onRoleChange={(r, role) => changeOrgRole(r, role)} onUnlock={(r) => usernameAction(r, "unlock")} onRecoveryCodes={(r) => usernameAction(r, "regenerateRecoveryCodes")} />
      <ResetPasswordDrawer open={!!resetFor} user={resetFor} api={api} onClose={() => setResetFor(null)} onDone={() => load()} onSendEmail={(r) => resetPasswordEmail(r)} />

      <ColumnChooser open={showCols} columns={colKeys} onClose={() => setShowCols(false)} onSave={saveCols} saving={savingCols} error={colErr} />

      <AddUserWizard open={wizard.open} method={wizard.method} api={api} directory={directory} canAssignAdmin={canAssignAdmin}
        onClose={() => setWizard((w) => ({ ...w, open: false }))} onCreated={() => load()}
        onManage={(q) => { setFilters({ q: String(q || ""), login: "", status: "", app: "", role: "" }); }} />

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
  jobTitle: "", department: "", employmentType: "", office: "", officePhone: "", faxNumber: "",
  mobilePhone: "", streetAddress: "", city: "", state: "", zip: "", country: "",
};

const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contractor", "Intern"];

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
  // country/state/city are stored as display names (what the API expects
  // and what shows on the detail panel); the ISO codes below only exist to
  // drive the cascading dropdowns (State needs the country's ISO code,
  // City needs both) and aren't sent anywhere.
  const [contactInfo, setContactInfo] = useState(EMPTY_CONTACT_INFO);
  const [countryIso, setCountryIso] = useState("");
  const [stateIso, setStateIso] = useState("");
  // The worldwide country/state/city dataset is a couple MB — way too big
  // to bundle into every /team page load for one optional wizard step, so
  // it's code-split and only fetched once this modal actually mounts.
  const [csc, setCsc] = useState(null);
  useEffect(() => {
    let cancelled = false;
    import("country-state-city").then((mod) => {
      if (!cancelled) setCsc(mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  function setContactField(field, value) {
    setContactInfo((cur) => ({ ...cur, [field]: value }));
  }
  function selectCountry(iso) {
    setCountryIso(iso);
    setStateIso("");
    const c = csc?.Country.getCountryByCode(iso);
    setContactInfo((cur) => ({ ...cur, country: c?.name || "", state: "", city: "" }));
  }
  function selectState(iso) {
    setStateIso(iso);
    const s = csc?.State.getStateByCodeAndCountry(iso, countryIso);
    setContactInfo((cur) => ({ ...cur, state: s?.name || "", city: "" }));
  }
  const allCountries = csc ? csc.Country.getAllCountries() : [];
  const availableStates = csc && countryIso ? csc.State.getStatesOfCountry(countryIso) : [];
  const availableCities = csc && countryIso && stateIso ? csc.City.getCitiesOfState(countryIso, stateIso) : [];
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
                <div style={{ marginBottom: 10, maxWidth: "50%", paddingRight: 6 }}>
                  <label className="label">Employment type</label>
                  <select className="input" value={contactInfo.employmentType} onChange={(e) => setContactField("employmentType", e.target.value)}>
                    <option value="">Not specified</option>
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
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
                <div style={{ marginBottom: 10 }}>
                  <label className="label">Country or region</label>
                  <select className="input" value={countryIso} onChange={(e) => selectCountry(e.target.value)} disabled={!csc}>
                    <option value="">{csc ? "Select a country" : "Loading countries…"}</option>
                    {allCountries.map((c) => (
                      <option key={c.isoCode} value={c.isoCode}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="row" style={{ gap: 12, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label className="label">State or province</label>
                    <select
                      className="input" value={stateIso} onChange={(e) => selectState(e.target.value)}
                      disabled={!countryIso || availableStates.length === 0}
                    >
                      <option value="">{countryIso ? (availableStates.length ? "Select a state" : "No states listed") : "Select a country first"}</option>
                      {availableStates.map((s) => (
                        <option key={s.isoCode} value={s.isoCode}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="label">City</label>
                    <select
                      className="input" value={contactInfo.city} onChange={(e) => setContactField("city", e.target.value)}
                      disabled={!stateIso || availableCities.length === 0}
                    >
                      <option value="">{stateIso ? (availableCities.length ? "Select a city" : "No cities listed") : "Select a state first"}</option>
                      {availableCities.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ maxWidth: "50%", paddingRight: 6 }}>
                  <label className="label">Zip or postal code</label>
                  <input className="input" value={contactInfo.zip} onChange={(e) => setContactField("zip", e.target.value)} />
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
                      {[contactInfo.jobTitle, contactInfo.department, contactInfo.employmentType, contactInfo.office].filter(Boolean).join(" · ") || "Set"}
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

// Company admins create employees who sign in with a Bizzux username
// (no email needed). Only company-enabled apps are offered; the server
// enforces the same rule (and the plan's user limit) regardless.
function UsernameUserModal({ onClose, onCreated }) {
  const [f, setF] = useState({ fullName: "", username: "", password: "", mustChangePassword: true, profile: "Staff/Shopkeeper", employeeId: "", department: "", branch: "", designation: "", mobile: "", apps: [] });
  const [enabled, setEnabled] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    api("/api/admin/username-users", "GET").then((d) => setEnabled(d.enabledApps || [])).catch((e) => setErr(e.message));
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      onCreated(await api("/api/admin/username-users", "POST", { action: "create", ...f }));
    } catch (x) {
      setErr(x.message);
      setBusy(false);
    }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>New username user</h2>
        <p className="muted" style={{ fontSize: 12.5 }}>They sign in with this username and a temporary password you hand over, then set their own. No email address is needed.</p>
        <label className="label">Full name</label>
        <input className="input" value={f.fullName} onChange={(e) => set("fullName", e.target.value)} required />
        <label className="label">Username (e.g. priya.ocean001)</label>
        <input className="input" value={f.username} onChange={(e) => set("username", e.target.value)} required autoCapitalize="none" />
        <label className="label">Role</label>
        <select className="input" value={f.profile} onChange={(e) => set("profile", e.target.value)}>
          {PROFILES.filter((p) => p.value !== "Global Admin").map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <label>Temporary password (optional)
          <input className="input" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Leave blank to generate one" value={f.password} onChange={(e) => set("password", e.target.value)} />
          <span className="muted" style={{ fontSize: 12 }}>Set your own, or leave it blank and one is generated. It must meet your company's password policy. It is shown once after you create the user.</span>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={f.mustChangePassword} onChange={(e) => set("mustChangePassword", e.target.checked)} /> Ask them to choose their own password at first sign-in (recommended)
        </label>
        {["employeeId", "department", "branch", "designation", "mobile"].map((k) => (
          <div key={k}>
            <label className="label" style={{ textTransform: "capitalize" }}>{k.replace(/([A-Z])/g, " $1")} (optional)</label>
            <input className="input" value={f[k]} onChange={(e) => set(k, e.target.value)} />
          </div>
        ))}
        <label className="label">Applications</label>
        {enabled === null ? <p className="muted">Loading…</p> : enabled.length === 0 ? <p className="muted">No applications are enabled for your company.</p> : (
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            {APPS.filter((a) => enabled.includes(a.id)).map((a) => (
              <label key={a.id} style={{ fontSize: 13 }}>
                <input type="checkbox" checked={f.apps.includes(a.id)} onChange={(e) => set("apps", e.target.checked ? [...f.apps, a.id] : f.apps.filter((x) => x !== a.id))} /> {a.name.replace("Bizzux ", "")}
              </label>
            ))}
          </div>
        )}
        {err && <p className="error">{err}</p>}
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <button className="btn-primary-sm" disabled={busy}>{busy ? "Creating…" : "Create user"}</button>
          <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

// Ask someone who already has a Bizzux username login to join this company. They accept it themselves after signing in; nothing changes for
// them until then, and this form says the same thing whether or not the username exists.
function LinkExistingUserModal({ onClose }) {
  const [f, setF] = useState({ username: "", profile: "Staff/Shopkeeper", apps: [] });
  const [enabled, setEnabled] = useState(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    api("/api/admin/username-users", "GET").then((d) => setEnabled(d.enabledApps || [])).catch((e) => setErr(e.message));
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const d = await api("/api/admin/username-users", "POST", { action: "requestLink", ...f });
      setDone(d.message);
    } catch (x) {
      setErr(x.message);
    }
    setBusy(false);
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>Link an existing user</h2>
        <p className="muted" style={{ fontSize: 12.5 }}>For someone who already has a Bizzux username login (for example from another company). They keep one login and must accept before they join. For an email address, use Invite instead.</p>
        {done ? <p role="status">{done}</p> : (
          <>
            <label className="label">Their exact username</label>
            <input className="input" value={f.username} onChange={(e) => set("username", e.target.value)} required autoCapitalize="none" />
            <label className="label">Role</label>
            <select className="input" value={f.profile} onChange={(e) => set("profile", e.target.value)}>
              {PROFILES.filter((p) => p.value !== "Global Admin").map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <label className="label">Applications</label>
            {enabled === null ? <p className="muted">Loading…</p> : (
              <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                {APPS.filter((a) => enabled.includes(a.id)).map((a) => (
                  <label key={a.id} style={{ fontSize: 13 }}>
                    <input type="checkbox" checked={f.apps.includes(a.id)} onChange={(e) => set("apps", e.target.checked ? [...f.apps, a.id] : f.apps.filter((x) => x !== a.id))} /> {a.name.replace("Bizzux ", "")}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        {err && <p className="error">{err}</p>}
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          {!done && <button className="btn-primary-sm" disabled={busy}>{busy ? "Sending…" : "Send request"}</button>}
          <button type="button" className="btn-outline-dark" onClick={onClose}>{done ? "Close" : "Cancel"}</button>
        </div>
      </form>
    </div>
  );
}

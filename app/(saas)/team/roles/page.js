"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import AdminNav from "@/components/AdminNav";
import AccountTabs from "@/components/AccountTabs";
import { useMe } from "@/lib/useMe";
import { PROFILES, ORGANIZATION_ROLES } from "@/lib/roles";
import { useIsAdminHost, wwwHrefFor } from "@/lib/adminLinks";

async function api(path) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(path, { headers: { Authorization: "Bearer " + token } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const ROLE_HELP = {
  OWNER: "Owns the company. Full control, including billing and who else is an admin. Cannot be changed here.",
  ADMIN: "Manages people, apps and settings for the company. Only an Owner or Admin can open this Admin Center.",
  MEMBER: "Uses the apps they have been given. Cannot manage people or settings.",
  VIEWER: "Read-only access to the apps they have been given.",
};

// Read-only for now: what each organization role and business profile means, and how many people hold each. Changing a person's role or app access
// is still done on Users (it uses the audited /api/team actions); this page adds no new way to change access.
export default function RolesPage() {
  const router = useRouter();
  const onAdminHost = useIsAdminHost();
  const { user, me } = useMe();
  const isAdmin = me ? me.isAccountAdmin === true : null;
  const [members, setMembers] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => { if (user === null) router.push("/sign-in"); }, [user, router]);
  useEffect(() => { if (user && isAdmin) api("/api/team").then((d) => setMembers(d.members || [])).catch((e) => setErr(e.message)); }, [user, isAdmin]);

  if (!user || isAdmin === null) return <div><AdminNav active="team-roles" /><div className="admin-shell"><p className="muted">Loading…</p></div></div>;
  if (!isAdmin) return (<div><AdminNav active="team-roles" /><div className="admin-shell"><p>You don&apos;t have access to this page.</p><a href={wwwHrefFor(onAdminHost, "/dashboard")} className="btn-primary-sm">Back to dashboard</a></div></div>);

  const countBy = (k, v) => (members || []).filter((m) => m[k] === v).length;
  return (
    <div>
      <AdminNav active="team-roles" />
      <AccountTabs active="team-roles" isAccountAdmin />
      <div className="admin-shell">
        <div style={{ marginBottom: 18 }}>
          <h1 className="dash-heading" style={{ fontSize: 20 }}>Roles</h1>
          <p className="dash-sub" style={{ marginBottom: 0 }}>What each role means in your company. To change a person&apos;s role or app access, use Users.</p>
        </div>
        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}
        <h2 style={{ fontSize: 15, margin: "8px 0" }}>Organization roles</h2>
        <div className="card" style={{ padding: 0, marginBottom: 20 }}>
          {ORGANIZATION_ROLES.map((r) => (
            <div key={r} style={{ display: "flex", gap: 12, padding: "12px 16px", borderBottom: "1px solid #eef2f7" }}>
              <strong style={{ width: 90 }}>{r[0] + r.slice(1).toLowerCase()}</strong>
              <span className="muted" style={{ flex: 1, fontSize: 13 }}>{ROLE_HELP[r]}</span>
              <span style={{ fontSize: 13 }}>{members ? countBy("orgRole", r) : "…"} {members && (countBy("orgRole", r) === 1 ? "person" : "people")}</span>
            </div>
          ))}
        </div>
        <h2 style={{ fontSize: 15, margin: "8px 0" }}>Business profiles</h2>
        <div className="card" style={{ padding: 0 }}>
          {PROFILES.map((p) => (
            <div key={p.value} style={{ display: "flex", gap: 12, padding: "12px 16px", borderBottom: "1px solid #eef2f7" }}>
              <strong style={{ width: 160 }}>{p.label || p.value}</strong>
              <span className="muted" style={{ flex: 1, fontSize: 13 }}>{p.desc || ""}</span>
              <span style={{ fontSize: 13 }}>{members ? countBy("profile", p.value) : "…"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

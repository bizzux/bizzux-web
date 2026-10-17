"use client";

// Super Admin -> Organizations: the single customer administration workspace.
//   Directory  server-searched, filtered, sorted, paginated list
//   Details    one organization's seven-section workspace
//   Wizard     step-by-step create organization (3 admin-assisted modes)
// Pieces live in components/orgadmin/. `legacy` carries the existing
// Support/Customers modals and helpers (passed in from SuperAdminPanel) so
// every control that tab offers is also available here.
import { useEffect, useState } from "react";
import Directory from "./orgadmin/Directory";
import Details from "./orgadmin/Details";
import Wizard from "./orgadmin/Wizard";

export default function OrganizationsAdmin({ legacy, platformRole }) {
  const [view, setView] = useState({ name: "list" }); // list | wizard | details
  const [refresh, setRefresh] = useState(0);
  const canManage = platformRole === "OWNER" || platformRole === "ADMIN";

  // Deep link: #org=<id> opens that organization.
  useEffect(() => {
    const m = typeof window !== "undefined" && window.location.hash.match(/org=([^&]+)/);
    if (m) setView({ name: "details", id: decodeURIComponent(m[1]) });
  }, []);

  const open = (id, tab) => {
    setView({ name: "details", id, tab });
    try { window.history.replaceState(null, "", "#org=" + encodeURIComponent(id)); } catch { /* ignore */ }
  };
  const toList = () => {
    setView({ name: "list" });
    setRefresh((n) => n + 1);
    try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch { /* ignore */ }
  };

  if (view.name === "wizard") {
    return <Wizard onCancel={toList} onOpen={open} onCreated={() => setRefresh((n) => n + 1)} />;
  }
  if (view.name === "details") {
    return <Details key={view.id} id={view.id} initialTab={view.tab} onBack={toList} onChanged={() => setRefresh((n) => n + 1)} legacy={legacy} />;
  }
  return (
    <Directory
      key={refresh}
      onOpen={open}
      onCreate={() => setView({ name: "wizard" })}
      canCreate={canManage}
      canReindex={canManage}
      isOwner={platformRole === "OWNER"}
    />
  );
}

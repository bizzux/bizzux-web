"use client";

import { useAdminGate, GateMessage } from "@/components/admin/AdminGate";

// Guest users: external collaborators. Today Bizzux has no such record: a Projects collaborator is always a member of your own company (never an
// arbitrary email, never cross-organization), so there is nothing to list and no second identity is ever created for a guest. This screen says so
// plainly instead of showing an empty table that suggests otherwise.
export default function GuestUsersPage() {
  const { state } = useAdminGate();
  if (state !== "ok") return <div className="admin-shell"><GateMessage state={state} /></div>;
  return (
    <div className="admin-shell">
      <h1 className="dash-heading" style={{ fontSize: 22, margin: "4px 0 0" }}>Guest users</h1>
      <div className="card" style={{ marginTop: 14 }}>
        <p style={{ marginTop: 0 }}><b>No external guests today.</b></p>
        <p className="muted">In Bizzux Projects, people you add to a project are always members of your own company who have been given access to Projects. External people are not added as guests and no separate guest login is created.</p>
        <p className="muted" style={{ marginBottom: 0 }}>To give someone outside your company access, add them as a user under <b>Users, Active users</b> (they get one Bizzux identity, with only the apps you choose). People you only need to keep a record of, without a login, belong under <b>Contacts</b>.</p>
      </div>
    </div>
  );
}

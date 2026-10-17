"use client";

// Tickets for one organization, shown inside Organizations > Support.
import { useEffect, useState } from "react";
import { api } from "../orgadmin/shared";
import TicketView, { STATUS_LABEL, PRIORITY_LABEL } from "./TicketView";
import NewTicketModal from "./NewTicketModal";

export default function OrgTickets({ orgId, orgName, onOpenOrg }) {
  const [rows, setRows] = useState(null);
  const [denied, setDenied] = useState(false);
  const [open, setOpen] = useState(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    try { setRows((await api("/api/admin/support-tickets?status=all&limit=25&org=" + orgId, "GET")).tickets); } catch { setDenied(true); setRows([]); }
  }
  useEffect(() => { load(); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (denied) return <p className="muted" style={{ fontSize: 12 }}>Your role doesn't include the support ticket workspace.</p>;
  if (open) return <TicketView id={open} onBack={() => { setOpen(null); load(); }} onOpenOrg={onOpenOrg} />;
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <div className="label">Tickets for this organization</div>
        <button type="button" className="btn-small" onClick={() => setShowNew(true)}>+ New ticket</button>
      </div>
      {rows === null && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No tickets yet.</p>}
      {rows && rows.map((t) => (
        <div key={t.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
          <button type="button" className="link-btn" onClick={() => setOpen(t.id)}><strong>{t.code}</strong> · {t.subject}</button>
          <span className="muted"> · {STATUS_LABEL[t.status]} · {PRIORITY_LABEL[t.priority]}{t.assigneeEmail ? " · " + t.assigneeEmail : ""}</span>
        </div>
      ))}
      {showNew && <NewTicketModal presetOrg={{ id: orgId, name: orgName }} onClose={() => setShowNew(false)} onCreated={(t) => { setShowNew(false); setOpen(t.id); }} />}
    </div>
  );
}

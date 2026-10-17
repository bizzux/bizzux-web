"use client";

// Customer Support workspace: tickets, follow-ups and quick customer lookup,
// all keyed by the same organization id. Customer administration (plan,
// payment, users, apps) lives in Organizations; this is the operational side.
import { useEffect, useRef, useState } from "react";
import { api } from "../orgadmin/shared";
import TicketView, { STATUS_LABEL, PRIORITY_LABEL } from "./TicketView";
import NewTicketModal from "./NewTicketModal";

const PAGE = 25;
const ago = (iso) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  if (m < 1440) return Math.round(m / 60) + " h ago";
  return Math.round(m / 1440) + " d ago";
};

export default function SupportWorkspace({ onOpenOrg }) {
  const [view, setView] = useState(null); // ticket id or null
  const [showNew, setShowNew] = useState(false);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState("open");
  const [assignee, setAssignee] = useState("any");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [rows, setRows] = useState(null);
  const [cursors, setCursors] = useState([null]);
  const [page, setPage] = useState(0);
  const [next, setNext] = useState(null);
  const [err, setErr] = useState("");
  const seq = useRef(0);
  // customer lookup
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);

  async function loadSummary() { try { setSummary(await api("/api/admin/support-tickets?summary=1", "GET")); } catch { setSummary(null); } }
  async function load(cursor, pageIndex) {
    const mine = ++seq.current;
    const p = new URLSearchParams({ status, limit: String(PAGE) });
    if (assignee !== "any") p.set("assignee", assignee);
    if (priority) p.set("priority", priority);
    if (due) p.set("due", "1");
    if (awaiting) p.set("awaiting", "1");
    if (cursor) p.set("cursor", cursor);
    try {
      const d = await api("/api/admin/support-tickets?" + p.toString(), "GET");
      if (mine !== seq.current) return;
      setRows(d.tickets); setNext(d.nextCursor); setPage(pageIndex); setErr("");
    } catch (e) { if (mine === seq.current) { setErr(e.message); setRows((r) => r || []); } }
  }
  useEffect(() => { loadSummary(); }, []);
  useEffect(() => { setCursors([null]); load(null, 0); }, [status, assignee, priority, due, awaiting]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => api("/api/admin/org-directory?limit=6&q=" + encodeURIComponent(q.trim()), "GET").then((r) => setFound(r.rows || [])).catch(() => setFound([])), 300);
    return () => clearTimeout(t);
  }, [q]);

  const refresh = () => { loadSummary(); load(cursors[page], page); };
  const filterTo = (f) => { setStatus(f.status || "open"); setAssignee(f.assignee || "any"); setPriority(f.priority || ""); setDue(!!f.due); setAwaiting(!!f.awaiting); };

  if (view) return <TicketView id={view} onBack={() => { setView(null); refresh(); }} onOpenOrg={onOpenOrg} onChanged={loadSummary} />;

  const Tile = ({ label, value, onClick }) => (
    <button type="button" onClick={onClick} className="card" style={{ textAlign: "left", cursor: "pointer", minWidth: 150, padding: 12 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value ?? "—"}</div>
    </button>
  );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Tile label="Open tickets" value={summary?.open} onClick={() => filterTo({})} />
        <Tile label="Assigned to me" value={summary?.mine} onClick={() => filterTo({ assignee: "me" })} />
        <Tile label="Urgent" value={summary?.urgent} onClick={() => filterTo({ priority: "urgent" })} />
        <Tile label="Awaiting our reply" value={summary?.awaitingReply} onClick={() => filterTo({ awaiting: true })} />
        <Tile label="Follow-ups due" value={summary?.followUpsDue} onClick={() => filterTo({ due: true })} />
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 6 }}>Find a customer</div>
        <input className="input" style={{ maxWidth: 360 }} placeholder="Name, owner, email, mobile or ID" value={q} onChange={(e) => setQ(e.target.value)} />
        {found.map((r) => (
          <div key={r.id} style={{ padding: "4px 0", fontSize: 13 }}>
            <button type="button" className="link-btn" onClick={() => onOpenOrg(r.id)}>{r.name}</button>
            <span className="muted"> · {r.ownerName || r.ownerEmail || "no owner on record"} · </span>
            <button type="button" className="link-btn" onClick={() => onOpenOrg(r.id, "support")}>Support access</button>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Tickets</h3>
          <button type="button" className="btn-primary" onClick={() => setShowNew(true)}>+ New ticket</button>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <select className="input" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Open (all active)</option>
            <option value="all">All tickets</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input" style={{ width: 160 }} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="any">Anyone</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option>
          </select>
          <select className="input" style={{ width: 140 }} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Any priority</option>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
            <input type="checkbox" checked={due} onChange={(e) => setDue(e.target.checked)} style={{ marginRight: 5 }} />Follow-ups due
          </label>
          <label className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
            <input type="checkbox" checked={awaiting} onChange={(e) => setAwaiting(e.target.checked)} style={{ marginRight: 5 }} />Awaiting our reply
          </label>
        </div>
        {err && <p className="error">{err}</p>}
        {rows === null && <p className="muted">Loading…</p>}
        {rows && rows.length === 0 && !err && <p className="muted">No tickets match.</p>}
        {rows && rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                <th>#</th><th>Subject</th><th>Organization</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Follow-up</th><th>Updated</th>
              </tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid var(--line)", verticalAlign: "top", cursor: "pointer" }} onClick={() => setView(t.id)}>
                    <td style={{ padding: "8px 8px 8px 0", whiteSpace: "nowrap" }}>{t.code}</td>
                    <td><strong>{t.subject}</strong>{t.source === "app" ? <span className="status-pill" style={{ marginLeft: 6, fontSize: 10 }}>From app</span> : null}{t.awaitingStaff ? <span className="status-pill" style={{ marginLeft: 4, fontSize: 10, background: "#fef3c7" }}>Needs reply</span> : null}{t.attachments?.length ? <span className="muted"> · {t.attachments.length} 📎</span> : null}{t.noteCount ? <span className="muted"> · {t.noteCount} note{t.noteCount === 1 ? "" : "s"}</span> : null}</td>
                    <td><button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); onOpenOrg(t.organizationId); }}>{t.organizationName || t.organizationId}</button></td>
                    <td>{PRIORITY_LABEL[t.priority]}</td>
                    <td>{STATUS_LABEL[t.status]}</td>
                    <td>{t.assigneeEmail || <span className="muted">Unassigned</span>}</td>
                    <td>{t.followUpAt ? new Date(t.followUpAt).toLocaleDateString() : ""}</td>
                    <td>{ago(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row" style={{ gap: 12, marginTop: 12, alignItems: "center" }}>
          <button type="button" className="link-btn" disabled={page === 0} onClick={() => page > 0 && load(cursors[page - 1], page - 1)}>← Previous</button>
          <span className="muted" style={{ fontSize: 12 }}>Page {page + 1}</span>
          <button type="button" className="link-btn" disabled={!next} onClick={() => { if (!next) return; setCursors([...cursors.slice(0, page + 1), next]); load(next, page + 1); }}>Next →</button>
        </div>
      </div>
      {showNew && <NewTicketModal onClose={() => setShowNew(false)} onCreated={(t) => { setShowNew(false); setView(t.id); loadSummary(); }} />}
    </div>
  );
}

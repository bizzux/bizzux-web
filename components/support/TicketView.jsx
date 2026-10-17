"use client";

// One support ticket: fields, append-only timeline, add a note. Every change is
// saved immediately and recorded on the timeline (and audit log) by the server.
import { useEffect, useState } from "react";
import { api } from "../orgadmin/shared";
import { auth } from "@/lib/firebase";

export const STATUS_LABEL = { open: "Open", in_progress: "In progress", waiting_customer: "Waiting on customer", resolved: "Resolved", closed: "Closed" };
export const PRIORITY_LABEL = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const CATEGORY_LABEL = { technical: "Technical", billing: "Billing", onboarding: "Onboarding", how_to: "How-to", account_access: "Account access", other: "Other" };

let assigneeCache = null;
export async function loadMeta() {
  if (!assigneeCache) assigneeCache = await api("/api/admin/support-tickets?assignees=1", "GET");
  return assigneeCache;
}

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "");

// Screenshots are private; they're fetched through the authenticated, audited
// staff route and shown from a temporary object URL.
function Screenshot({ ticketId, a }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let off = false, made = null;
    (async () => {
      try {
        const token = await auth.currentUser.getIdToken();
        const r = await fetch(`/api/admin/support-attachment?ticket=${ticketId}&i=${a.index}`, { headers: { Authorization: "Bearer " + token } });
        if (!r.ok) throw new Error("load");
        made = URL.createObjectURL(await r.blob());
        if (!off) setUrl(made);
      } catch { if (!off) setFailed(true); }
    })();
    return () => { off = true; if (made) URL.revokeObjectURL(made); };
  }, [ticketId, a.index]);
  if (a.purged) return <span className="muted" style={{ fontSize: 12 }}>{a.name} (removed after the retention period)</span>;
  if (failed) return <span className="muted" style={{ fontSize: 12 }}>{a.name} (couldn't load)</span>;
  if (!url) return <span className="muted" style={{ fontSize: 12 }}>Loading {a.name}…</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={a.name + " · " + Math.round(a.size / 1024) + " KB"}>
      <img src={url} alt={a.name} style={{ maxWidth: 180, maxHeight: 130, borderRadius: 6, border: "1px solid var(--line)" }} />
    </a>
  );
}

export default function TicketView({ id, onBack, onOpenOrg, onChanged }) {
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [replyPublic, setReplyPublic] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setData(await api("/api/admin/support-tickets?id=" + id, "GET")); setErr(""); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); loadMeta().then(setMeta).catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(p) {
    setBusy(true); setErr("");
    try { await api("/api/admin/support-tickets", "POST", { action: "update", id, patch: p }); await load(); onChanged && onChanged(); } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function addNote(e) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true); setErr("");
    try { await api("/api/admin/support-tickets", "POST", { action: "note", id, body: note, visibility: replyPublic ? "public" : "internal" }); setNote(""); setReplyPublic(false); await load(); onChanged && onChanged(); } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  if (!data) return <div className="card"><button className="link-btn" onClick={onBack}>← Back</button><p className={err ? "error" : "muted"}>{err || "Loading…"}</p></div>;
  const t = data.ticket;
  const closed = ["resolved", "closed"].includes(t.status);

  return (
    <div className="card">
      <button type="button" className="link-btn" onClick={onBack}>← Back to tickets</button>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, margin: "6px 0" }}>
        <h3 style={{ margin: 0 }}>{t.code} · {t.subject}</h3>
        <span className="status-pill">{STATUS_LABEL[t.status]}</span>
      </div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Organization:{" "}
        <button type="button" className="link-btn" onClick={() => onOpenOrg && onOpenOrg(t.organizationId)}>{t.organizationName || t.organizationId}</button>
        {" · "}
        <button type="button" className="link-btn" onClick={() => onOpenOrg && onOpenOrg(t.organizationId, "support")}>Request support access</button>
      </p>
      {t.description && <p style={{ whiteSpace: "pre-wrap", fontSize: 13, background: "var(--line, #f1f5f9)", borderRadius: 8, padding: 10 }}>{t.description}</p>}
      <p className="muted" style={{ fontSize: 12 }}>
        {t.source === "app"
          ? `Raised by the customer from the ${t.appKey || "app"} app: ${[t.requesterName, t.requesterEmail].filter(Boolean).join(" · ")}`
          : `${[t.contactName, t.contactEmail, t.contactPhone].filter(Boolean).join(" · ") || "No contact recorded"} · logged by ${t.createdByEmail}`} · {fmt(t.createdAt)}
      </p>
      {t.context && (t.context.page || t.context.userAgent) && (
        <p className="muted" style={{ fontSize: 11, overflowWrap: "anywhere" }}>
          Page {t.context.page || "—"} · build {t.context.appVersion || "—"} · screen {t.context.screen || "—"} · {t.context.userAgent}
        </p>
      )}
      {t.attachments?.length > 0 && (
        <div style={{ margin: "8px 0" }}>
          <div className="label" style={{ marginBottom: 4 }}>Screenshots ({t.attachments.length})</div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            {t.attachments.map((a) => <Screenshot key={a.index} ticketId={t.id} a={a} />)}
          </div>
        </div>
      )}
      {err && <p className="error">{err}</p>}

      <div className="row" style={{ gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Status<br />
          <select className="input" disabled={busy} value={t.status} onChange={(e) => patch({ status: e.target.value })}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>Priority<br />
          <select className="input" disabled={busy} value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>Assigned to<br />
          <select className="input" disabled={busy} value={t.assigneeUid || ""} onChange={(e) => patch({ assigneeUid: e.target.value || null })}>
            <option value="">Unassigned</option>
            {(meta?.assignees || []).map((a) => <option key={a.uid} value={a.uid}>{a.email}{a.uid === data.me ? " (me)" : ""}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>Category<br />
          <select className="input" disabled={busy} value={t.category} onChange={(e) => patch({ category: e.target.value })}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>Follow-up on<br />
          <input className="input" type="date" disabled={busy} value={t.followUpAt ? t.followUpAt.slice(0, 10) : ""} onChange={(e) => patch({ followUpAt: e.target.value || null })} />
        </label>
      </div>
      {!closed && (
        <div className="row" style={{ gap: 10, marginBottom: 10 }}>
          <button type="button" className="btn-small" disabled={busy} onClick={() => patch({ status: "resolved" })}>Mark resolved</button>
          <button type="button" className="btn-small" disabled={busy} onClick={() => patch({ status: "waiting_customer" })}>Waiting on customer</button>
        </div>
      )}

      <div className="label" style={{ margin: "14px 0 6px" }}>Timeline</div>
      {data.notes.map((n) => (
        <div key={n.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13, ...(n.kind === "customer" ? { background: "#f0fdf4" } : {}) }}>
          {n.kind === "event"
            ? <span className="muted">{n.body} <span style={{ fontSize: 11 }}>· {n.authorEmail} · {fmt(n.createdAt)}</span></span>
            : <><div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div><div className="muted" style={{ fontSize: 11 }}>{n.kind === "customer" ? "Customer reply" : n.visibility === "public" ? "Reply to customer (visible in the app)" : "Internal note"} · {n.authorEmail} · {fmt(n.createdAt)}</div></>}
        </div>
      ))}
      <form onSubmit={addNote} style={{ marginTop: 10 }}>
        <textarea className="input" rows={3} placeholder={replyPublic ? "Reply to the customer (they will see this in the app)" : "Add a note (internal; visible to support staff only)"} value={note} onChange={(e) => setNote(e.target.value)} style={{ width: "100%" }} />
        {t.source === "app" && (
          <label style={{ fontSize: 13, display: "block", marginTop: 4 }}>
            <input type="checkbox" checked={replyPublic} onChange={(e) => setReplyPublic(e.target.checked)} style={{ marginRight: 6 }} />
            Reply to the customer (visible to them in the app)
          </label>
        )}
        <button className="btn-primary" disabled={busy || !note.trim()} style={{ marginTop: 6 }}>{replyPublic ? "Send reply" : "Add note"}</button>
        <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>Notes can't be edited or deleted, so the timeline stays a reliable record.</span>
      </form>
    </div>
  );
}

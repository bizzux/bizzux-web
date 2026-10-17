"use client";

// Log a ticket against an organization (pick one, or it's pre-filled when
// opened from an organization's Support tab).
import { useEffect, useState } from "react";
import { api, Field } from "../orgadmin/shared";
import { PRIORITY_LABEL, CATEGORY_LABEL, loadMeta } from "./TicketView";

export default function NewTicketModal({ presetOrg, onClose, onCreated }) {
  const [org, setOrg] = useState(presetOrg || null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [meta, setMeta] = useState(null);
  const [f, setF] = useState({ subject: "", description: "", category: "technical", priority: "normal", contactName: "", contactEmail: "", contactPhone: "", assigneeUid: "", followUpAt: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadMeta().then(setMeta).catch(() => {}); }, []);
  useEffect(() => {
    if (org || q.trim().length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      api("/api/admin/org-directory?limit=8&q=" + encodeURIComponent(q.trim()), "GET").then((r) => setResults(r.rows || [])).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, org]);

  async function submit(e) {
    e.preventDefault();
    if (!org) { setErr("Choose the organization this ticket is about"); return; }
    setBusy(true); setErr("");
    try {
      const d = await api("/api/admin/support-tickets", "POST", { action: "create", organizationId: org.id, ...f, assigneeUid: f.assigneeUid || undefined, followUpAt: f.followUpAt || undefined });
      onCreated(d.ticket);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  }
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, width: "100%" }}>
        <h3 style={{ marginTop: 0 }}>New ticket</h3>
        <form onSubmit={submit}>
          {org ? (
            <p style={{ fontSize: 13 }}>Organization: <strong>{org.name}</strong> {!presetOrg && <button type="button" className="link-btn" onClick={() => setOrg(null)}>change</button>}</p>
          ) : (
            <div style={{ marginBottom: 10 }}>
              <label className="label">Organization *</label>
              <input className="input" autoFocus placeholder="Search by name, owner, email or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
              {results.map((r) => (
                <button key={r.id} type="button" className="link-btn" style={{ display: "block", textAlign: "left", padding: "4px 0" }} onClick={() => setOrg({ id: r.id, name: r.name })}>
                  {r.name} <span className="muted" style={{ fontSize: 12 }}>· {r.ownerName || r.ownerEmail || "no owner on record"}</span>
                </button>
              ))}
            </div>
          )}
          <Field label="Subject *"><input className="input" value={f.subject} onChange={(e) => set("subject", e.target.value)} /></Field>
          <Field label="What happened"><textarea className="input" rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} style={{ width: "100%" }} /></Field>
          <div className="row">
            <Field label="Category">
              <select className="input" value={f.category} onChange={(e) => set("category", e.target.value)}>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className="input" value={f.priority} onChange={(e) => set("priority", e.target.value)}>
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Assign to">
              <select className="input" value={f.assigneeUid} onChange={(e) => set("assigneeUid", e.target.value)}>
                <option value="">Unassigned</option>
                {(meta?.assignees || []).map((a) => <option key={a.uid} value={a.uid}>{a.email}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="Contact name"><input className="input" value={f.contactName} onChange={(e) => set("contactName", e.target.value)} /></Field>
            <Field label="Contact email"><input className="input" type="email" value={f.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></Field>
            <Field label="Contact phone"><input className="input" value={f.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></Field>
          </div>
          <Field label="Follow up on"><input className="input" type="date" value={f.followUpAt} onChange={(e) => set("followUpAt", e.target.value)} /></Field>
          {err && <p className="error">{err}</p>}
          <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create ticket"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/adminClient";
import { useAdminGate, GateMessage } from "@/components/admin/AdminGate";
import { CommandBar, Cmd, CmdSep } from "@/components/admin/CommandBar";

// Deleted users: people removed from THIS company. Their Bizzux login and other companies are untouched; they can be restored for 60 days, after
// which they are no longer recoverable from here. Restoring brings back the membership only: app access is granted again by an administrator.
export default function DeletedUsersPage() {
  const { state } = useAdminGate();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const d = await adminApi("/api/iam/removed"); setRows(d.removed || []); setErr(""); } catch (e) { setErr(e.message); setRows([]); }
  }, []);
  useEffect(() => { if (state === "ok") load(); }, [state, load]);

  const recoverable = (rows || []).filter((r) => r.recoverable);
  const chosen = recoverable.filter((r) => sel.has(r.id));
  const allTicked = recoverable.length > 0 && chosen.length === recoverable.length;
  const toggle = (id) => setSel((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function restore(list) {
    if (!list.length) return;
    if (!window.confirm("Restore " + list.length + " " + (list.length === 1 ? "person" : "people") + " to your company? Their app access is not restored automatically.")) return;
    setBusy(true); setErr(""); setMsg("");
    let ok = 0; const failed = [];
    for (const r of list) { try { await adminApi("/api/iam/identities", "POST", { kind: "restore", id: r.id }); ok++; } catch (e) { failed.push((r.name || r.username || r.email) + ": " + e.message); } }
    setMsg(ok + " restored" + (failed.length ? ", " + failed.length + " failed (" + failed.slice(0, 3).join("; ") + ")" : ". Give them app access again from Active users."));
    setSel(new Set()); setBusy(false); await load();
  }

  if (state !== "ok") return <div className="admin-shell"><GateMessage state={state} /></div>;
  return (
    <div className="admin-shell">
      <h1 className="dash-heading" style={{ fontSize: 22, margin: "4px 0 0" }}>Deleted users</h1>
      <p className="muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>People removed from your company. They keep their Bizzux login and any other companies. You can restore them for 60 days.</p>
      <CommandBar label="Deleted users actions">
        <Cmd icon="refresh" onClick={() => { setMsg(""); load(); }}>Refresh</Cmd>
        <CmdSep />
        <Cmd icon="people" onClick={() => restore(chosen)} disabled={!chosen.length || busy} title={chosen.length ? "" : "Select one or more people"}>Restore selected</Cmd>
      </CommandBar>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="muted" role="status">{msg}</p>}
      <div className="card">
        {rows === null && <p className="muted">Loading…</p>}
        {rows && rows.length === 0 && <p className="muted">No removed users. People you remove from your company appear here and can be restored for 60 days.</p>}
        {rows && rows.length > 0 && (
          <table className="table">
            <thead><tr>
              <th style={{ width: 28 }}><input type="checkbox" aria-label="Select all recoverable" checked={allTicked} disabled={!recoverable.length} onChange={() => setSel(allTicked ? new Set() : new Set(recoverable.map((r) => r.id)))} /></th>
              <th>Name</th><th>Username / email</th><th>Removed</th><th>Recoverable for</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.recoverable ? <input type="checkbox" aria-label={"Select " + (r.name || r.username)} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /> : null}</td>
                  <td>{r.name || "N/A"}</td>
                  <td>{r.email || (r.username ? "@" + r.username : "")}</td>
                  <td className="muted">{r.removedAtMs ? new Date(r.removedAtMs).toLocaleDateString() : "—"}</td>
                  <td>{r.recoverable ? r.daysLeft + (r.daysLeft === 1 ? " day" : " days") : <span className="muted">Expired</span>}</td>
                  <td>{r.recoverable ? <button type="button" className="adm-link" disabled={busy} onClick={() => restore([r])}>Restore</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

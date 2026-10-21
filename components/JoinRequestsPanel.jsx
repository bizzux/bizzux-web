"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";

async function api(method, body) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch("/api/join-requests", { method, headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
}

// Shown on Users to the Owner and to Admins who were given "approve join requests". Everything is enforced by the server; this only displays it.
export default function JoinRequestsPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState({});
  const load = () => api("GET").then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (!data || !data.canApprove) return null;
  const act = async (body) => { setErr(""); try { await api("POST", body); await load(); } catch (e) { setErr(e.message); } };
  const p = (id) => pick[id] || { profile: data.assignable.includes("Staff/Shopkeeper") ? "Staff/Shopkeeper" : data.assignable[0], apps: [] };
  const setP = (id, patch) => setPick({ ...pick, [id]: { ...p(id), ...patch } });
  return (
    <div className="card" style={{ padding: 16, marginBottom: 18 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>Join requests {data.requests.length > 0 && <span className="badge">{data.requests.length} waiting</span>}</h2>
      {err && <p className="error">{err}</p>}
      {data.companyCode && <p className="muted" style={{ fontSize: 13, margin: "0 0 6px" }}>Your company code: <strong>{data.companyCode}</strong>. People without an invite can use it at bizzux.com/join-company; you approve each one.</p>}
      {data.requests.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No one is waiting. Share your company code so people can ask to join.</p>}
      {data.requests.map((r) => (
        <div key={r.id} style={{ borderTop: "1px solid #eef2f7", padding: "10px 0", display: "grid", gap: 6 }}>
          <div><strong>{r.name || r.email || "New person"}</strong> <span className="muted" style={{ fontSize: 12 }}>{r.email}</span></div>
          {r.message && <div className="muted" style={{ fontSize: 13 }}>&ldquo;{r.message}&rdquo;</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
            <select className="input" value={p(r.id).profile} onChange={(e) => setP(r.id, { profile: e.target.value })}>{data.assignable.map((x) => <option key={x}>{x}</option>)}</select>
            {(data.apps || []).map((a) => (
              <label key={a}><input type="checkbox" checked={p(r.id).apps.includes(a)} onChange={(e) => setP(r.id, { apps: e.target.checked ? [...p(r.id).apps, a] : p(r.id).apps.filter((x) => x !== a) })} /> {a.replace("bizzux-", "")}</label>
            ))}
            <button className="btn-primary-sm" onClick={() => act({ action: "approve", id: r.id, profile: p(r.id).profile, apps: p(r.id).apps })}>Approve</button>
            <button className="btn-outline-dark" onClick={() => act({ action: "reject", id: r.id })}>Reject</button>
          </div>
        </div>
      ))}
      {data.isOwner && data.admins.length > 0 && (
        <div style={{ borderTop: "1px solid #eef2f7", marginTop: 8, paddingTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Admins who can approve join requests</div>
          {data.admins.map((a) => (
            <label key={a.userId} style={{ display: "block", fontSize: 13 }}>
              <input type="checkbox" checked={a.canApprove} onChange={(e) => act({ action: e.target.checked ? "grant" : "revoke", userId: a.userId, permission: "members.approve" })} /> {a.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

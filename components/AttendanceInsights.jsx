"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";

// Global Admin → Attendance Insights. Read-only platform numbers (estimates, labelled as such) and the Owner-only rollout switches.
async function api(method, body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch("/api/admin/attendance-analytics", { method, headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
const money = (n) => "₹" + (Math.round(Number(n || 0) * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const Stat = ({ label, value, sub }) => (
  <div className="card" style={{ flex: "1 1 170px", minWidth: 160, margin: 0 }}>
    <div className="muted" style={{ fontSize: 12.5 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
    {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
  </div>
);

export default function AttendanceInsights() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [scope, setScope] = useState("global");
  const [orgId, setOrgId] = useState("");
  const [flag, setFlag] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() { try { setD(await api("GET")); setErr(""); } catch (e) { setErr(e.message); } }
  useEffect(() => { load(); }, []);
  if (err && !d) return <p className="error">{err}</p>;
  if (!d) return <p className="muted">Loading Attendance insights…</p>;

  async function set(value) {
    if (!flag) { setErr("Choose a capability."); return; }
    if (value === false && !window.confirm(`Switch OFF "${d.flags.definitions.find((x) => x.key === flag)?.label}" ${scope === "global" ? "for EVERY company" : "for company " + orgId}? People already using it keep working; nothing is deleted.`)) return;
    setBusy(true); setErr(""); setMsg("");
    try { await api("POST", { action: "setFlags", scope, orgId, values: { [flag]: value }, reason }); setMsg(value ? "Switched on." : "Switched off. Takes effect within about a minute."); setReason(""); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, background: "#f0fdfa", borderColor: "#99f6e4" }}>
        <p style={{ fontSize: 13, margin: 0 }}><strong>Attendance Insights.</strong> {d.note} {d.priceVersion ? `Price book version ${d.priceVersion}.` : "No price book is published yet."} {d.truncated && "Showing the first 200 organisations only."}</p>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat label="Organisations on licence pricing" value={d.orgs} sub={`${d.byStatus.active} active · ${d.byStatus.trial} trial · ${d.byStatus.past_due} past due`} />
        <Stat label="Monthly recurring (estimate)" value={money(d.mrr)} sub={`${money(d.arr)} a year · before GST`} />
        <Stat label="Discounts given" value={money(d.discountExposure.monthly)} sub={d.discountExposure.pctOfList === null ? "per month" : `${d.discountExposure.pctOfList}% of list, per month`} />
        <Stat label="Gross margin" value={d.margin.costsKnown ? (d.margin.marginPct === null ? "—" : d.margin.marginPct + "%") : "Not known yet"} sub={d.margin.flags[0] || "estimate"} />
        <Stat label="Prorated upgrades not yet invoiced" value={money(d.unpaidAdjustments)} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Licences by mode</h3>
        <table className="table" style={{ width: "100%" }}><thead><tr><th>Mode</th><th>Billed</th><th>In use</th><th>Monthly (estimate)</th></tr></thead>
          <tbody>{Object.entries(d.mix).map(([k, m]) => <tr key={k}><td>{m.label}</td><td>{m.sold}</td><td>{m.used}</td><td>{money(m.revenueMonthly)}</td></tr>)}</tbody></table>
        {d.overUse.length > 0 && <p className="error" style={{ fontSize: 13 }}>People on a mode beyond what is billed: {d.overUse.map((x) => `${x.id.slice(0, 6)}… ${x.label} +${x.gap}`).join(", ")}</p>}
        {d.idle.length > 0 && <p className="muted" style={{ fontSize: 13 }}>Billed but nobody on it: {d.idle.slice(0, 8).map((x) => `${x.id.slice(0, 6)}… ${x.label} ${x.gap}`).join(", ")}{d.idle.length > 8 ? ` +${d.idle.length - 8}` : ""}</p>}
      </div>

      {(d.expiringTrials.length > 0 || d.failedPayments.length > 0) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Needs attention</h3>
          {d.expiringTrials.map((t) => <p key={t.id} style={{ margin: "2px 0", fontSize: 13 }}>Trial ending: {t.id} — {t.daysLeft < 0 ? "ended " + -t.daysLeft + " days ago" : t.daysLeft + " days left"} ({t.trialEnds})</p>)}
          {d.failedPayments.map((f) => <p key={f.id} className="error" style={{ margin: "2px 0", fontSize: 13 }}>Payment past due: {f.id}</p>)}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Rollout switches (kill switch)</h3>
        <p className="muted" style={{ fontSize: 13 }}>Switch an Attendance capability off for everyone or for one company, without a deploy. Existing data is never deleted; people already on a mode keep working. Platform Owner only; every change is audited.</p>
        <p style={{ fontSize: 13 }}>Global now: {d.flags.definitions.map((f) => `${f.label}: ${d.flags.values[f.key] === false ? "OFF" : "on"}`).join(" · ")}{d.flags.reason && d.flags.definitions.some((f) => d.flags.values[f.key] === false) ? ` — “${d.flags.reason}”` : ""}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={scope} onChange={(e) => setScope(e.target.value)}><option value="global">Every company</option><option value="company">One company</option></select>
          {scope === "company" && <input placeholder="Company id" value={orgId} onChange={(e) => setOrgId(e.target.value)} />}
          <select value={flag} onChange={(e) => setFlag(e.target.value)}><option value="">Capability…</option>{d.flags.definitions.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
          <input placeholder="Reason (needed to switch off)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minWidth: 220 }} />
          <button className="btn" disabled={busy} onClick={() => set(false)}>Switch off</button>
          <button className="btn" disabled={busy} onClick={() => set(true)}>Switch on</button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>“Switch on” for one company only removes that company’s own override; a global OFF still wins.</p>
        {err && <p className="error">{err}</p>}{msg && <p style={{ color: "#047857" }}>{msg}</p>}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { auth } from "@/lib/firebase";

// Platform Admin → "Cost & Usage". Unit economics + Google Cloud/Firebase
// consumption per tenant. All numbers come from /api/admin/cost-usage, which
// reads only the usageDaily / costAnalyticsDaily aggregates (see
// lib/costAnalytics.js). Charts are dependency-free responsive SVG, like the
// Analytics tab.

const C = { blue: "#1F51FF", teal: "#0e9f8e", amber: "#f59e0b", red: "#dc2626", slate: "#94a3b8", violet: "#7c3aed" };

async function api(path, method = "GET", body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    method,
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const int = (v) => Math.round(Number(v) || 0).toLocaleString("en-IN");
const compact = (v) => {
  const a = Math.abs(v);
  if (a >= 1e7) return (v / 1e7).toFixed(1) + "Cr";
  if (a >= 1e5) return (v / 1e5).toFixed(1) + "L";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return String(Math.round(v * 10) / 10);
};
let CURRENCY = "INR";
function money(v) {
  const x = Number(v) || 0;
  if (CURRENCY !== "INR") return new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY, maximumFractionDigits: Math.abs(x) < 100 ? 2 : 0 }).format(x);
  if (x === 0) return "₹0";
  if (Math.abs(x) < 0.1) return "₹" + x.toFixed(4);
  if (Math.abs(x) < 100) return "₹" + x.toFixed(2);
  return "₹" + Math.round(x).toLocaleString("en-IN");
}
const pct = (v) => (v === null || v === undefined ? "—" : (Math.round(v * 10) / 10) + "%");
const shortDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function isoShift(key, days) {
  return new Date(Date.parse(key + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

// ---------- charts ----------------------------------------------------------

function LineChart({ dates, series, fmt = money, height = 220 }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const W = 640, H = height, pl = 46, pr = 12, pt = 12, pb = 24;
  const all = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
  const max = Math.max(1e-9, ...all) * 1.08;
  const x = (i) => pl + (dates.length <= 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (dates.length - 1));
  const y = (v) => pt + (1 - v / max) * (H - pt - pb);
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const labelEvery = Math.max(1, Math.ceil(dates.length / 6));

  function onMove(e) {
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pl) / (W - pl - pr)) * (dates.length - 1));
    setHover(Math.max(0, Math.min(dates.length - 1, i)));
  }
  const hx = hover === null ? 0 : (x(hover) / W) * 100;

  return (
    <div style={{ position: "relative" }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray={i ? "3 3" : undefined} />
            <text x={pl - 6} y={y(t) + 3.5} fontSize="10" textAnchor="end" fill="#64748b">{fmt === money ? "₹" + compact(t) : compact(t)}</text>
          </g>
        ))}
        {dates.map((d, i) => i % labelEvery === 0 && (
          <text key={d} x={x(i)} y={H - 6} fontSize="10" textAnchor="middle" fill="#64748b">{shortDate(d)}</text>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <path d={s.values.map((v, i) => (v === null || v === undefined ? "" : (i === 0 || s.values[i - 1] === null || s.values[i - 1] === undefined ? "M" : "L") + x(i).toFixed(1) + " " + y(v).toFixed(1))).join(" ")} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeDasharray={s.dashed ? "5 4" : undefined} />
            {dates.length <= 31 && s.values.map((v, i) => v === null || v === undefined ? null : <circle key={i} cx={x(i)} cy={y(v)} r="2.2" fill={s.color} />)}
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pt} y2={H - pb} stroke="#94a3b8" />}
        {hover !== null && series.map((s) => s.values[hover] === null || s.values[hover] === undefined ? null : <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r="4" fill="#fff" stroke={s.color} strokeWidth="2" />)}
      </svg>
      {hover !== null && (
        <div style={{ position: "absolute", top: 4, left: `clamp(0px, calc(${hx}% - 70px), calc(100% - 150px))`, background: "#0f172a", color: "#fff", fontSize: 11.5, padding: "6px 10px", borderRadius: 8, pointerEvents: "none", boxShadow: "0 6px 18px rgba(15,23,42,.25)" }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{shortDate(dates[hover])}</div>
          {series.map((s) => (
            <div key={s.name} style={{ display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: s.color }} />{s.name}: <strong>{s.values[hover] === null || s.values[hover] === undefined ? "n/a" : fmt(s.values[hover])}</strong>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6, fontSize: 12, color: "#475569" }}>
          {series.map((s) => <span key={s.name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 3, background: s.color, borderRadius: 2 }} />{s.name}</span>)}
        </div>
      )}
    </div>
  );
}

function BarsH({ items, fmt = money, color = C.blue, empty = "No data in this range." }) {
  if (!items.length) return <p className="muted" style={{ fontSize: 13 }}>{empty}</p>;
  const max = Math.max(1e-9, ...items.map((i) => i.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {items.map((i) => (
        <div key={i.key}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, marginBottom: 3 }}>
            <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.label}>
              {i.flag && <span title="Abnormal usage" style={{ color: C.red, marginRight: 4 }}>▲</span>}{i.label}
              {i.sub && <span style={{ fontWeight: 500, color: "#64748b" }}> · {i.sub}</span>}
            </span>
            <strong style={{ whiteSpace: "nowrap" }}>{fmt(i.value)}</strong>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: "#f1f5f9", overflow: "hidden" }}>
            <div style={{ height: "100%", width: Math.max(2, (i.value / max) * 100) + "%", background: i.flag ? C.red : color, borderRadius: 99 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Spark({ values, color = C.blue }) {
  const W = 80, H = 22, max = Math.max(1e-9, ...values);
  if (!values.length || max <= 1e-9) return <span className="muted">—</span>;
  const pts = values.map((v, i) => `${(i * W) / Math.max(1, values.length - 1)},${H - 2 - (v / max) * (H - 4)}`).join(" ");
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" /></svg>;
}

// ---------- layout bits -------------------------------------------------------

function Kpi({ label, value, hint }) {
  return (
    <div className="card" style={{ padding: "12px 14px" }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, marginTop: 2 }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}
const grid = (min) => ({ display: "grid", gap: 12, gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` });
function Section({ title, sub, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: 14.5, margin: "0 0 2px" }}>{title}</h3>
      {sub && <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>{sub}</p>}
      {!sub && <div style={{ height: 8 }} />}
      {children}
    </div>
  );
}
function ChartCard({ title, sub, children }) {
  return (
    <div className="card">
      <h3 style={{ fontSize: 14, margin: 0 }}>{title}</h3>
      <p className="muted" style={{ fontSize: 12, margin: "2px 0 10px" }}>{sub}</p>
      {children}
    </div>
  );
}

const PRESETS = [["7d", "7d"], ["30d", "30d"], ["90d", "90d"], ["MTD", "mtd"]];
const RATE_FIELDS = [
  ["firestoreReadPer100k", "Firestore read ₹ / 100k"], ["firestoreWritePer100k", "Firestore write ₹ / 100k"],
  ["firestoreDeletePer100k", "Firestore delete ₹ / 100k"], ["functionsPerMillionInvocations", "Functions ₹ / 1M invocations"],
  ["functionsInvocationsPerTransaction", "Function calls / transaction"], ["storagePerGBMonth", "Storage ₹ / GB-month"],
  ["networkPerGB", "Network ₹ / GB"], ["bytesPerRead", "Avg bytes / read"], ["bytesPerWrite", "Avg bytes / write"],
  ["baselineStorageGB", "Baseline storage GB"], ["hostingMonthly", "Hosting ₹ / month"],
];

export default function CostUsagePanel({ isOwner }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState({ preset: "30d", from: "", to: "" });
  const [sort, setSort] = useState({ key: "cost", dir: -1 });
  const [rateEdit, setRateEdit] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const dayKey = new Date().toISOString().slice(0, 10);
  useEffect(() => { try { setDismissed(localStorage.getItem("bzx-cost-alert-dismissed") === dayKey); } catch {} }, [dayKey]);
  function dismiss() { setDismissed(true); try { localStorage.setItem("bzx-cost-alert-dismissed", dayKey); } catch {} }
  async function syncNow() {
    setBusy(true);
    try { await api("/api/admin/cost-usage", "POST", { action: "syncBilling" }); await api("/api/admin/cost-usage", "POST", { action: "rebuild", from: data.range.from, to: data.range.to }); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const load = useCallback(async () => {
    setErr("");
    setBusy(true);
    try {
      let qs = "";
      if (range.preset === "custom") {
        if (!range.from || !range.to) { setBusy(false); return; }
        qs = `?from=${range.from}&to=${range.to}`;
      } else {
        // The server clamps `to` to its own IST "today"; derive that here the same way.
        const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
        const from = range.preset === "mtd" ? today.slice(0, 8) + "01" : isoShift(today, -(Number(range.preset.replace("d", "")) - 1));
        qs = `?from=${from}&to=${today}`;
      }
      setData(await api("/api/admin/cost-usage" + qs));
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }, [range]);
  useEffect(() => { load(); }, [load]);

  async function saveRates() {
    setBusy(true);
    try {
      await api("/api/admin/cost-usage", "POST", { action: "rates", rates: rateEdit });
      await api("/api/admin/cost-usage", "POST", { action: "rebuild", from: data.range.from, to: data.range.to });
      setRateEdit(null);
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const customers = useMemo(() => {
    if (!data) return [];
    const list = [...data.customers];
    list.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (typeof av === "string") return sort.dir * String(av).localeCompare(String(bv));
      return sort.dir * ((av ?? -Infinity) - (bv ?? -Infinity));
    });
    return list;
  }, [data, sort]);

  const flagged = useMemo(() => new Set(data?.flaggedOrgs || []), [data]);
  const flaggedMods = useMemo(() => new Set(data?.flaggedModules || []), [data]);
  const flaggedModKeys = useMemo(() => new Set((data?.flaggedModules || []).map((k) => k.split("|")[1])), [data]);

  const th = (key, label, right) => (
    <th style={{ textAlign: right ? "right" : "left", cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
      {label}{sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
    </th>
  );

  if (data === null) return err ? <p className="error">{err}</p> : <p className="muted">Loading…</p>;
  CURRENCY = data.billing?.currency || "INR";
  const k = data.kpis, f = data.finops, d = data.series.map((s) => s.date);
  const svc = [["Firestore", f.byService.firestore], ["Cloud Functions", f.byService.functions], ["Cloud Storage", f.byService.storage], ["Hosting", f.byService.hosting], ["Network", f.byService.network], ["Other GCP services", f.byService.other]].filter(([, v]) => v > 0).map(([label, value]) => ({ key: label, label, value }));
  const highAlerts = data.alerts.filter((a) => a.severity === "high");
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const topCustomers = data.customers.slice(0, 10).map((c) => ({ key: c.organizationId, label: c.name, sub: c.plan, value: c.cost, flag: flagged.has(c.organizationId) }));
  const topModules = data.modules.filter((m) => m.cost > 0 || m.transactions > 0).slice(0, 10).map((m) => ({ key: m.key, label: m.label, sub: int(m.transactions) + " tx", value: m.cost, flag: flaggedModKeys.has(m.key) }));

  return (
    <div style={{ opacity: busy ? 0.6 : 1, transition: "opacity .15s" }}>
      {/* controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <div className="admin-tabs" role="tablist" style={{ margin: 0 }}>
          {PRESETS.map(([label, id]) => (
            <button key={id} className={"admin-tab" + (range.preset === id ? " active" : "")} onClick={() => setRange({ preset: id, from: "", to: "" })}>{label}</button>
          ))}
          <button className={"admin-tab" + (range.preset === "custom" ? " active" : "")} onClick={() => setRange({ preset: "custom", from: data.range.from, to: data.range.to })}>Custom</button>
        </div>
        {range.preset === "custom" && (
          <>
            <input className="input" type="date" value={range.from} max={range.to || data.today} onChange={(e) => setRange({ ...range, from: e.target.value })} style={{ width: 150 }} />
            <span className="muted">to</span>
            <input className="input" type="date" value={range.to} min={range.from} max={data.today} onChange={(e) => setRange({ ...range, to: e.target.value })} style={{ width: 150 }} />
          </>
        )}
        <span className="muted" style={{ fontSize: 12 }}>{shortDate(data.range.from)} – {shortDate(data.range.to)} · {data.range.days} days</span>
        <button className="btn-ghost" onClick={load} style={{ marginLeft: "auto" }}>↻ Refresh</button>
        {isOwner && <button className="btn-ghost" onClick={() => setRateEdit({ ...data.rates })}>Cost rates</button>}
      </div>
      {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

      {highAlerts.length > 0 && !dismissed && (
        <div role="alert" style={{ position: "sticky", top: 8, zIndex: 20, marginBottom: 14, background: "#fef2f2", border: "1px solid #fecaca", borderLeft: "4px solid " + C.red, borderRadius: 10, padding: "10px 14px", boxShadow: "0 8px 24px rgba(220,38,38,.18)", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <strong style={{ color: "#991b1b" }}>⚠ {highAlerts.length} high-priority usage alert{highAlerts.length === 1 ? "" : "s"}</strong>
            <div style={{ fontSize: 12.5, color: "#7f1d1d", marginTop: 3 }}>{highAlerts.slice(0, 3).map((a) => a.title).join(" · ")}{highAlerts.length > 3 ? " …" : ""}</div>
          </div>
          <button className="btn-ghost" onClick={dismiss}>Dismiss</button>
        </div>
      )}

      <Section title="Google Cloud cost (FinOps)" sub="Actual = what Google Cloud Billing reported. Estimated = near-real-time calculation from Bizzux usage since the latest billing update. Estimates are not an official Google bill.">
        <div style={grid(190)}>
          <Kpi label="Actual Cost MTD" value={f.actualMTD === null ? "Not connected" : money(f.actualMTD)} hint="Google Cloud Billing" />
          <Kpi label="Estimated Current Cost" value={money(f.estimatedCurrent)} hint="actual + usage since last billing update (estimate)" />
          <Kpi label="Estimated Today" value={money(f.estimatedToday)} hint="usage-based estimate" />
          <Kpi label="Cost Today (reported)" value={f.actualToday === null ? "Not reported yet" : money(f.actualToday)} hint="Google billing" />
          <Kpi label="Yesterday" value={f.yesterday ? money(f.yesterday.value) : "—"} hint={f.yesterday ? (f.yesterday.actual ? "actual" : "estimated") : undefined} />
          <Kpi label="Last Billing Update" value={f.hasBilling ? stamp(f.lastBillingUpdate) : "—"} hint={"billing currency: " + (data.billing?.currency || "INR")} />
        </div>
        <div className="card" style={{ marginTop: 10, padding: "9px 12px", fontSize: 12.5, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ width: 9, height: 9, borderRadius: 99, background: data.billing?.error ? C.red : data.billing?.configured ? C.teal : C.amber }} />
          {data.billing?.error ? <span>Billing sync failed: {data.billing.error}</span>
            : data.billing?.configured ? <span>Google Cloud Billing export connected{data.billing.lastSyncAt ? " · last synced " + stamp(data.billing.lastSyncAt) : ""}.</span>
            : <span>Billing export not connected yet — showing estimates only. Set <code>BILLING_BQ_TABLE</code> once Cloud Billing → BigQuery export is on.</span>}
          {data.billing?.configured && <button className="btn-ghost" onClick={syncNow} disabled={busy}>Sync billing now</button>}
        </div>
      </Section>

      {!data.hasUsageData && (
        <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${C.amber}` }}>
          <strong>No usage reported for this range yet.</strong>
          <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
            Apps report usage to <code>POST /api/usage/ingest</code>, which fills <code>usageDaily</code>. Until an app reports, business KPIs that depend on usage show zero; revenue and paying customers are already live from the customer registry.
          </p>
        </div>
      )}

      {/* alerts */}
      <Section title={`Alerts${data.alerts.length ? ` (${data.alerts.length})` : ""}`} sub="Recent 3-day average vs the prior 14 days, per platform, customer and module (reads + writes).">
        {data.alerts.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No unusual usage growth detected.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.alerts.slice(0, 8).map((a, i) => (
              <div key={i} className="card" style={{ padding: "9px 12px", borderLeft: `4px solid ${a.severity === "high" ? C.red : C.amber}`, display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className="status-pill" style={{ background: a.severity === "high" ? "#fee2e2" : "#fef3c7", color: a.severity === "high" ? "#991b1b" : "#92400e", textTransform: "uppercase", fontSize: 10.5 }}>{a.level}</span>
                <strong style={{ fontSize: 13 }}>{a.title}</strong>
                <span className="muted" style={{ fontSize: 12 }}>{a.detail}</span>
              </div>
            ))}
            {data.alerts.length > 8 && <span className="muted" style={{ fontSize: 12 }}>+ {data.alerts.length - 8} more</span>}
          </div>
        )}
      </Section>

      <Section title="Business KPIs">
        <div style={grid(165)}>
          <Kpi label="Active customers" value={int(k.business.activeCustomers)} hint="with usage in range" />
          <Kpi label="Paying customers" value={int(k.business.payingCustomers)} />
          <Kpi label="Active users" value={int(k.business.activeUsers)} />
          <Kpi label="Avg users / customer" value={(k.business.avgUsersPerCustomer || 0).toFixed(1)} />
          <Kpi label="Transactions / day" value={int(k.business.transactionsPerDay)} />
          <Kpi label="Transactions this month" value={int(k.business.transactionsThisMonth)} />
          <Kpi label="Transactions / user / day" value={(k.business.transactionsPerUserPerDay || 0).toFixed(1)} />
        </div>
      </Section>

      <Section title="Cost KPIs" sub={`${k.cost.billedDays} day(s) from Google Cloud billing, ${k.cost.estimatedDays} estimated from the rate card.`}>
        <div style={grid(165)}>
          <Kpi label="Cloud cost, this month" value={money(k.cost.currentMonthCost)} />
          <Kpi label="Cloud cost, range" value={money(k.cost.rangeCost)} />
          <Kpi label="Firestore" value={money(k.cost.firestoreCost)} />
          <Kpi label="Cloud Functions" value={money(k.cost.functionsCost)} />
          <Kpi label="Storage" value={money(k.cost.storageCost)} />
          <Kpi label="Hosting" value={money(k.cost.hostingCost)} />
          <Kpi label="Network" value={money(k.cost.networkCost)} />
          <Kpi label="Cost / customer" value={money(k.cost.costPerCustomer)} />
          <Kpi label="Cost / user" value={money(k.cost.costPerUser)} />
          <Kpi label="Cost / transaction" value={money(k.cost.costPerTransaction)} />
          <Kpi label="Revenue / customer" value={money(k.cost.revenuePerCustomer)} hint="monthly" />
          <Kpi label="Revenue / user" value={money(k.cost.revenuePerUser)} hint="monthly" />
          <Kpi label="Infra cost % of revenue" value={pct(k.cost.infraPctOfRevenue)} hint={k.cost.infraPctOfRevenue > 30 ? "above 30% — review" : undefined} />
        </div>
      </Section>

      {/* charts */}
      <div style={{ ...grid(340), marginBottom: 12 }}>
        <ChartCard title="Actual vs estimated cost" sub="Google-billed cost (blue) vs usage-based estimate (dashed). Billing lags a day or more.">
          <LineChart dates={d} series={[{ name: "Actual (billing)", color: C.blue, values: data.series.map((s) => s.actual) }, { name: "Estimated", color: C.amber, dashed: true, values: data.series.map((s) => s.estimated) }]} />
        </ChartCard>
        <ChartCard title="Cost by GCP service" sub="Range total, by Google Cloud service">
          <BarsH items={svc} color={C.violet} empty="No cost recorded in this range yet." />
        </ChartCard>
        <ChartCard title="Cloud cost trend" sub="Total daily Google Cloud cost">
          <LineChart dates={d} series={[{ name: "Cloud cost", color: C.blue, values: data.series.map((s) => s.cost) }]} />
        </ChartCard>
        <ChartCard title="Cost per customer trend" sub="Daily cost ÷ customers with usage">
          <LineChart dates={d} series={[{ name: "Cost / customer", color: C.teal, values: data.series.map((s) => s.costPerCustomer) }]} />
        </ChartCard>
        <ChartCard title="Reads / writes trend" sub="Firestore operations per day">
          <LineChart dates={d} fmt={int} series={[{ name: "Reads", color: C.blue, values: data.series.map((s) => s.reads) }, { name: "Writes", color: C.amber, values: data.series.map((s) => s.writes) }]} />
        </ChartCard>
        <ChartCard title="Transactions trend" sub="Business transactions per day, all modules">
          <LineChart dates={d} fmt={int} series={[{ name: "Transactions", color: C.violet, values: data.series.map((s) => s.transactions) }]} />
        </ChartCard>
        <ChartCard title="Revenue vs infrastructure cost" sub="Daily recognised revenue (MRR ÷ 30) against cloud cost">
          <LineChart dates={d} series={[{ name: "Revenue", color: C.teal, values: data.series.map((s) => s.revenue) }, { name: "Infra cost", color: C.red, values: data.series.map((s) => s.cost) }]} />
        </ChartCard>
        <ChartCard title="Top 10 expensive customers" sub="Estimated cost in range · ▲ = abnormal usage">
          <BarsH items={topCustomers} color={C.blue} />
        </ChartCard>
        <ChartCard title="Top 10 expensive modules" sub="Firestore cost by module, all customers · ▲ = a customer's module is spiking">
          <BarsH items={topModules} color={C.teal} empty="Apps haven't reported per-module reads/writes yet." />
        </ChartCard>
      </div>

      <Section title="Customer cost analysis" sub="Click a header to sort. Cost is the customer's own Firestore operations plus their share of functions, storage, network and hosting.">
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", minWidth: 960 }}>
            <thead>
              <tr style={{ background: "#f8fafc", fontSize: 11.5, textTransform: "uppercase", color: "#64748b" }}>
                {th("name", "Customer")}{th("plan", "Plan")}{th("users", "Users", true)}{th("activeUsers", "Active", true)}
                {th("transactions", "Transactions", true)}{th("reads", "Reads", true)}{th("writes", "Writes", true)}
                {th("cost", "Cost", true)}{th("revenue", "Revenue", true)}{th("infraPct", "Infra %", true)}{th("trendPct", "Trend (14d)", true)}
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const hot = flagged.has(c.organizationId);
                const badMods = [...flaggedMods].filter((x) => x.startsWith(c.organizationId + "|")).map((x) => x.split("|")[1]);
                return (
                  <tr key={c.organizationId} style={{ borderTop: "1px solid #e2e8f0", background: hot ? "#fef2f2" : undefined }}>
                    <td style={{ padding: "8px 10px" }}>
                      <strong>{c.name}</strong>{hot && <span title="Abnormal read/write volume" style={{ color: C.red, marginLeft: 6 }}>▲</span>}
                      {badMods.length > 0 && <div style={{ fontSize: 11, color: C.red }}>{badMods.join(", ")}</div>}
                    </td>
                    <td style={{ padding: "8px 10px" }}>{c.plan}{!c.paying && <span className="muted" style={{ fontSize: 11 }}> · {c.status}</span>}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{int(c.users)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{int(c.activeUsers)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{int(c.transactions)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{int(c.reads)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{int(c.writes)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>{money(c.cost)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{c.paying ? money(c.revenue) : "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: c.infraPct > 30 ? C.red : undefined, fontWeight: c.infraPct > 30 ? 700 : undefined }}>{pct(c.infraPct)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <Spark values={c.trend} color={c.trendPct > 50 ? C.red : C.blue} />
                      <span style={{ marginLeft: 6, fontSize: 11.5, color: c.trendPct > 50 ? C.red : "#64748b" }}>{c.trendPct === null ? "" : (c.trendPct > 0 ? "+" : "") + Math.round(c.trendPct) + "%"}</span>
                    </td>
                  </tr>
                );
              })}
              {customers.length === 0 && <tr><td colSpan={11} style={{ padding: 24, textAlign: "center" }} className="muted">No customer usage in this range.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Usage by module">
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", minWidth: 520 }}>
            <thead><tr style={{ background: "#f8fafc", fontSize: 11.5, textTransform: "uppercase", color: "#64748b" }}>
              <th style={{ textAlign: "left" }}>Module</th><th style={{ textAlign: "right" }}>Transactions</th><th style={{ textAlign: "right" }}>Reads</th><th style={{ textAlign: "right" }}>Writes</th><th style={{ textAlign: "right" }}>Firestore cost</th>
            </tr></thead>
            <tbody>
              {data.modules.map((m) => (
                <tr key={m.key} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600 }}>{m.label}{flaggedModKeys.has(m.key) && <span style={{ color: C.red, marginLeft: 6 }} title="A customer's usage of this module is abnormal">▲</span>}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{int(m.transactions)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{int(m.reads)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{int(m.writes)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>{money(m.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {rateEdit && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14.5, margin: "0 0 4px" }}>Cost rate card</h3>
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Used to estimate cost until real Google Cloud Billing figures are imported. Saving rebuilds the cost for the selected range.</p>
          <div style={grid(220)}>
            {RATE_FIELDS.map(([key, label]) => (
              <label key={key} style={{ fontSize: 12 }}>{label}
                <input className="input" type="number" min="0" step="any" value={rateEdit[key] ?? ""} onChange={(e) => setRateEdit({ ...rateEdit, [key]: e.target.value })} />
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={saveRates} disabled={busy}>Save & rebuild</button>
            <button className="btn-ghost" onClick={() => setRateEdit(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { CATEGORIES, CADENCES, CAPITAL_TYPES, runScenario, monthlyAmount } from "@/lib/businessHealth";

// Super Admin -> Business Health. The platform owner's consolidated view of
// earning, spending, cash and break-even. All maths is in lib/businessHealth.js
// (shared with the API route); this file only presents it and edits records.
// It is not a ledger: bookkeeping stays in Bizzux Finance. Viewing is open to
// every Super Admin user; editing is Platform Owner only (enforced server-side).

async function api(method, body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch("/api/admin/business-health", {
    method,
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const inr = (v) => "₹" + Math.round(Number(v) || 0).toLocaleString("en-IN");
const val = (v, f = inr) => (v === null || v === undefined ? "Not set up" : f(v));
const today = () => new Date().toISOString().slice(0, 10);

const BASIS = {
  actual: { label: "Actual", bg: "#dcfce7", fg: "#166534" },
  estimate: { label: "Estimate", bg: "#fef3c7", fg: "#92400e" },
  assumption: { label: "Assumption", bg: "#e0e7ff", fg: "#3730a3" },
  forecast: { label: "Forecast", bg: "#fae8ff", fg: "#86198f" },
};
function Badge({ basis }) {
  const b = BASIS[basis];
  if (!b) return null;
  return <span style={{ background: b.bg, color: b.fg, fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 999, marginLeft: 6, verticalAlign: "middle" }}>{b.label}</span>;
}

function Stat({ label, value, basis, sub, tone }) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12.5 }}>{label}{basis && <Badge basis={basis} />}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: tone === "bad" ? "#b91c1c" : tone === "good" ? "#15803d" : undefined }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const GRID = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 16, marginBottom: 20 };
const SUBTABS = [
  { id: "overview", label: "Overview" },
  { id: "expenses", label: "Operating Expenses" },
  { id: "capital", label: "Capital & Investments" },
  { id: "revenue", label: "Revenue & Pricing" },
  { id: "forecast", label: "Forecast & Break-even" },
];

export default function BusinessHealthPanel({ isOwner }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [err, setErr] = useState("");

  async function load() {
    try { setData(await api("GET")); setErr(""); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  if (data === null) return err ? <p className="error">{err}</p> : <p className="muted">Loading…</p>;
  const shared = { data, isOwner, reload: load, go: setTab };

  return (
    <div>
      <div className="admin-tabs" role="tablist" style={{ marginBottom: 16 }}>
        {SUBTABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={"admin-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      {data.legacyPending && isOwner && <LegacyBanner {...shared} />}
      {tab === "overview" && <Overview {...shared} />}
      {tab === "expenses" && <Expenses {...shared} />}
      {tab === "capital" && <Capital {...shared} />}
      {tab === "revenue" && <Revenue {...shared} />}
      {tab === "forecast" && <Forecast {...shared} />}
      {!isOwner && <p className="muted" style={{ marginTop: 16 }}>View only. Only the Platform Owner can change these figures.</p>}
    </div>
  );
}

// Shared "run an owner action, show errors, then refresh" helper.
function useAction(reload) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function run(body, ok) {
    setBusy(true); setErr("");
    try { await api("POST", body); await reload(); if (ok) ok(); return true; }
    catch (e) { setErr(e.message); return false; }
    finally { setBusy(false); }
  }
  return { busy, err, run, setErr };
}

// ---- Overview ---------------------------------------------------------------
function Overview({ data, go }) {
  const s = data.summary;
  const noCost = s.totalMonthlyCost === null;
  const profitTone = s.monthlyProfit === null ? undefined : s.monthlyProfit >= 0 ? "good" : "bad";
  const runway = s.runwayState === "profitable" ? "Profitable, no burn" : s.runwayMonths !== null ? `${s.runwayMonths} months` : "Needs cash balance";
  const answers = [
    ["How much are we earning?", `MRR ${inr(s.mrr)} (ARR ${inr(s.arr)}) from ${s.payingCount} paying organization${s.payingCount === 1 ? "" : "s"}.`],
    ["How much are we spending?", noCost ? "Not known yet. Enter operating expenses." : `${inr(s.totalMonthlyCost)} per month including cloud.`],
    ["Are we profitable?", s.monthlyProfit === null ? "Can't say until expenses are entered." : s.monthlyProfit >= 0 ? `Yes, ${inr(s.monthlyProfit)} per month.` : `No, losing ${inr(-s.monthlyProfit)} per month.`],
    ["How much cash remains?", s.cash ? `${inr(s.cash.balance)} as of ${s.cash.date}. Runway: ${runway}.` : "No cash balance recorded yet."],
    ["How many more paying customers?", s.breakevenCustomers === null ? "Needs costs and a revenue-per-customer figure." : s.customersShort === 0 ? "None. Break-even reached." : `${s.customersShort} more (${s.breakevenCustomers} in total).`],
    ["Which products make money?", data.revenue.products.length ? data.revenue.products.slice(0, 3).map((p) => `${p.product} ${inr(p.mrr)}`).join(", ") + " (MRR)" : "No paid subscriptions yet."],
  ];
  return (
    <div>
      {data.dataQuality.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "4px solid #f59e0b" }}>
          <strong style={{ fontSize: 13 }}>Before you rely on these numbers</strong>
          <ul style={{ margin: "6px 0 0 18px", fontSize: 13 }}>{data.dataQuality.map((q) => <li key={q}>{q}</li>)}</ul>
        </div>
      )}
      <div className="proj-grid" style={GRID}>
        <Stat label="MRR" basis="actual" value={inr(s.mrr)} sub="Paid subscriptions, annual ÷ 12, ex one-time fees" />
        <Stat label="Monthly cost" basis={noCost ? undefined : s.costBasis} value={val(s.totalMonthlyCost)} sub={noCost ? "No expenses entered" : "Operating expenses + cloud"} />
        <Stat label={s.monthlyProfit !== null && s.monthlyProfit < 0 ? "Monthly loss" : "Monthly profit"} basis={noCost ? undefined : s.costBasis} value={s.monthlyProfit === null ? "Not set up" : inr(Math.abs(s.monthlyProfit))} tone={profitTone} />
        <Stat label="Cash balance" basis="actual" value={s.cash ? inr(s.cash.balance) : "Not recorded"} sub={s.cash ? `as of ${s.cash.date}` : "Add a snapshot in Capital & Investments"} />
        <Stat label="Runway" value={runway} sub={s.burn ? `Burn ${inr(s.burn)}/month` : undefined} />
        <Stat label="Paying organizations" basis="actual" value={s.payingCount} sub={`${data.revenue.licensedUsers} licensed users`} />
        <Stat label="Avg revenue / customer" basis={s.arpaBasis || undefined} value={s.arpa === null ? "—" : inr(s.arpa)} />
        <Stat label="Contribution margin" basis={s.arpaBasis || undefined} value={s.contributionMarginPct === null ? "—" : `${s.contributionMarginPct}%`} sub={s.contributionPerCustomer === null ? undefined : `${inr(s.contributionPerCustomer)} per customer per month`} />
        <Stat label="Customer acquisition cost" value={s.cac === null ? "—" : inr(s.cac)} sub={s.cac === null ? "Needs sales & marketing spend and a new paying customer in the last 90 days" : `${s.newPayingLast90} new paying in 90 days`} />
        <Stat label="Break-even customers" basis={s.arpaBasis || undefined} value={s.breakevenCustomers === null ? "—" : s.breakevenCustomers} sub={s.customersShort === null ? undefined : s.customersShort === 0 ? "Reached" : `${s.customersShort} more needed`} />
      </div>
      <div className="card">
        <p className="section-title" style={{ marginTop: 0 }}>Your questions, answered</p>
        {answers.map(([q, a]) => (
          <div key={q} style={{ padding: "8px 0", borderTop: "1px solid var(--border, #e5e7eb)" }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{q}</div>
            <div className="muted" style={{ fontSize: 13.5 }}>{a}</div>
          </div>
        ))}
        <div style={{ paddingTop: 8, borderTop: "1px solid var(--border, #e5e7eb)" }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>What happens if costs or customers increase?</div>
          <button className="link-btn" onClick={() => go("forecast")}>Open the what-if simulator →</button>
        </div>
      </div>
    </div>
  );
}

// ---- Operating expenses -----------------------------------------------------
const EMPTY_EXPENSE = { label: "", category: "employees", cadence: "monthly", amount: "", startDate: today(), endDate: "", status: "actual", provider: "" };

function Expenses({ data, isOwner, reload }) {
  const [form, setForm] = useState(null);
  const { busy, err, run, setErr } = useAction(reload);
  const live = data.expenses.filter((e) => !e.archivedAt);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    await run({ action: "saveExpense", ...form }, () => setForm(null));
  }
  return (
    <div>
      {!data.opex.configured && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong>No operating expenses entered yet.</strong>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>Cost, profit, runway and break-even stay blank until you add salaries, rent, tools and other costs. They are not shown as ₹0 because that would be misleading.</p>
        </div>
      )}
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="section-title" style={{ marginTop: 0 }}>Cloud (Vercel &amp; Firebase pay-as-you-go)<Badge basis={data.cloud.configured ? data.cloud.basis : undefined} /></p>
        {data.cloud.configured ? (
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>{inr(data.cloud.monthly)}</strong> per month (30-day run rate from FinOps).{" "}
            <span className="muted">{data.cloud.basis === "estimate" ? "Some days are estimates, not yet billed." : "All days billed."}{data.cloud.hostingExcluded ? " The flat hosting estimate is excluded because you entered an actual Vercel line below." : ""}</span>
          </p>
        ) : <p className="muted" style={{ margin: 0 }}>No FinOps cost data in the last 30 days.</p>}
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Firebase comes from the FinOps/BigQuery import. Add your Vercel invoice below as an Infrastructure line with provider “Vercel” and mark it Actual.</p>
      </div>

      {CATEGORIES.map((c) => {
        const rows = live.filter((e) => e.category === c.key);
        const tot = data.opex.byCategory[c.key];
        return (
          <div className="card" key={c.key} style={{ marginBottom: 16 }}>
            <p className="section-title" style={{ marginTop: 0 }}>{c.label} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{rows.length ? `· ${inr(tot.total)}/month` : ""}</span></p>
            {rows.length === 0 ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nothing entered.</p> : (
              <table className="table">
                <thead><tr><th>Name</th><th>Amount</th><th>Per month</th><th>Period</th><th>Status</th>{isOwner && <th />}</tr></thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td>{e.label}{e.provider ? <span className="muted"> · {e.provider}</span> : null}</td>
                      <td>{inr(e.amount)} <span className="muted">{CADENCES.find((x) => x.key === e.cadence)?.label}</span></td>
                      <td>{e.cadence === "oneoff" ? "one-off" : inr(monthlyAmount(e))}</td>
                      <td className="muted">{e.startDate}{e.endDate ? ` → ${e.endDate}` : ""}</td>
                      <td><Badge basis={e.status === "planned" ? "forecast" : "actual"} />{e.status === "planned" ? "" : ""}</td>
                      {isOwner && <td style={{ whiteSpace: "nowrap" }}>
                        <button className="link-btn" onClick={() => { setErr(""); setForm({ ...EMPTY_EXPENSE, ...e, endDate: e.endDate || "", provider: e.provider || "" }); }}>Edit</button>{" "}
                        <button className="link-btn" onClick={() => { if (confirm(`Archive "${e.label}"? It will stop counting but stays in the audit trail.`)) run({ action: "archiveExpense", id: e.id }); }}>Archive</button>
                      </td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {isOwner && !form && <button className="link-btn" onClick={() => { setErr(""); setForm({ ...EMPTY_EXPENSE, category: c.key }); }}>+ Add {c.label.toLowerCase()} expense</button>}
          </div>
        );
      })}

      {form && isOwner && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "4px solid #6366f1" }}>
          <p className="section-title" style={{ marginTop: 0 }}>{form.id ? "Edit expense" : "New expense"}</p>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <input className="input" style={{ flex: "2 1 200px" }} placeholder="Name, e.g. Sales executive salary" value={form.label} onChange={(e) => set("label", e.target.value)} />
            <select className="input" style={{ flex: "1 1 160px" }} value={form.category} onChange={(e) => set("category", e.target.value)}>{CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
            <input className="input" style={{ flex: "1 1 120px" }} type="number" min="0" placeholder="Amount ₹" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
            <select className="input" style={{ flex: "1 1 120px" }} value={form.cadence} onChange={(e) => set("cadence", e.target.value)}>{CADENCES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <label className="muted" style={{ fontSize: 12.5 }}>Starts <input className="input" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></label>
            <label className="muted" style={{ fontSize: 12.5 }}>Ends (optional) <input className="input" type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} /></label>
            <label className="muted" style={{ fontSize: 12.5 }}>Status <select className="input" value={form.status} onChange={(e) => set("status", e.target.value)}><option value="actual">Actual (counts now)</option><option value="planned">Planned (forecast only)</option></select></label>
            {form.category === "infrastructure" && <label className="muted" style={{ fontSize: 12.5 }}>Provider <select className="input" value={form.provider} onChange={(e) => set("provider", e.target.value)}><option value="">Other</option><option value="vercel">Vercel</option><option value="firebase">Firebase</option></select></label>}
          </div>
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
          {err && <p className="error" style={{ marginTop: 8 }}>{err}</p>}
        </div>
      )}
      {!form && err && <p className="error">{err}</p>}
      {data.opex.oneOffs > 0 && <p className="muted" style={{ fontSize: 13 }}>One-off expenses this month: {inr(data.opex.oneOffs)} (not part of the monthly run rate).</p>}
    </div>
  );
}

// ---- Capital & investments --------------------------------------------------
const CAP_LABEL = { investment: "One-time investment", deposit: "Refundable security deposit", funding: "Funding received" };

function Capital({ data, isOwner, reload }) {
  const c = data.capital;
  const { busy, err, run } = useAction(reload);
  const [form, setForm] = useState({ label: "", type: "investment", amount: "", date: today() });
  const [cash, setCash] = useState({ balance: "", date: today() });
  const items = data.capitalItems.filter((x) => !x.archivedAt);
  return (
    <div>
      <div className="proj-grid" style={GRID}>
        <Stat label="One-time investments" basis="actual" value={inr(c.invested)} sub="Equipment, setup. Not a monthly cost." />
        <Stat label="Security deposits held" basis="actual" value={inr(c.depositsHeld)} sub={`Refundable. ${inr(c.depositsRefunded)} already refunded. Not an expense.`} />
        <Stat label="Funding received" basis="actual" value={inr(c.funding)} />
        <Stat label="Latest cash balance" basis="actual" value={c.cash ? inr(c.cash.balance) : "Not recorded"} sub={c.cash ? `${c.cash.date}${c.cash.stale ? " · over a month old" : ""}` : undefined} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="section-title" style={{ marginTop: 0 }}>Cash balance</p>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Record your real bank balance now and then. Runway is calculated from the latest one.</p>
        {isOwner && (
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <input className="input" type="number" placeholder="Balance ₹" value={cash.balance} onChange={(e) => setCash({ ...cash, balance: e.target.value })} />
            <input className="input" type="date" value={cash.date} max={today()} onChange={(e) => setCash({ ...cash, date: e.target.value })} />
            <button className="btn-primary" disabled={busy} onClick={() => run({ action: "addCash", ...cash }, () => setCash({ balance: "", date: today() }))}>Record balance</button>
          </div>
        )}
        {data.cashSnaps.filter((x) => !x.archivedAt).slice(0, 6).map((s) => (
          <div key={s.id} className="row" style={{ justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
            <span>{s.date}</span><span>{inr(s.balance)}</span>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="section-title" style={{ marginTop: 0 }}>Investments, deposits and funding</p>
        {items.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>Nothing entered.</p> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th>Amount</th><th>Date</th>{isOwner && <th />}</tr></thead>
            <tbody>{items.map((x) => (
              <tr key={x.id}>
                <td>{x.label}</td>
                <td>{CAP_LABEL[x.type]}{x.type === "deposit" && (x.refundedOn ? ` · refunded ${x.refundedOn}` : " · held")}</td>
                <td>{inr(x.amount)}</td><td className="muted">{x.date}</td>
                {isOwner && <td style={{ whiteSpace: "nowrap" }}>
                  {x.type === "deposit" && !x.refundedOn && <button className="link-btn" onClick={() => { const d = prompt("Date refunded (YYYY-MM-DD)", today()); if (d) run({ action: "refundDeposit", id: x.id, refundedOn: d }); }}>Mark refunded</button>}{" "}
                  <button className="link-btn" onClick={() => { if (confirm(`Archive "${x.label}"?`)) run({ action: "archiveCapital", id: x.id }); }}>Archive</button>
                </td>}
              </tr>))}
            </tbody>
          </table>
        )}
        {isOwner && (
          <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <input className="input" style={{ flex: "2 1 180px" }} placeholder="Name, e.g. Office deposit" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{CAPITAL_TYPES.map((t) => <option key={t} value={t}>{CAP_LABEL[t]}</option>)}</select>
            <input className="input" type="number" min="0" placeholder="Amount ₹ (total, not per month)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <button className="btn-primary" disabled={busy} onClick={() => run({ action: "saveCapital", ...form }, () => setForm({ label: "", type: "investment", amount: "", date: today() }))}>Add</button>
          </div>
        )}
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

// ---- Revenue & pricing ------------------------------------------------------
function Revenue({ data, isOwner, reload }) {
  const r = data.revenue, s = data.summary;
  const { busy, err, run } = useAction(reload);
  const [set, setSet] = useState({ gstRate: data.settings.gstRate, gstInclusive: data.settings.gstInclusive, gatewayFeePct: data.settings.gatewayFeePct ?? "", assumedArpa: data.settings.assumedArpa ?? "" });
  const [view, setView] = useState("org");
  return (
    <div>
      <div className="proj-grid" style={GRID}>
        <Stat label="MRR" basis="actual" value={inr(r.mrr)} sub={r.gstNote} />
        <Stat label="ARR" basis="actual" value={inr(r.arr)} sub="MRR × 12" />
        <Stat label="Paying organizations" basis="actual" value={r.payingCount} />
        <Stat label="Licensed users (paid)" basis="actual" value={r.licensedUsers} />
        <Stat label="Avg revenue / customer" basis={s.arpaBasis || undefined} value={s.arpa === null ? "—" : inr(s.arpa)} />
        <Stat label="Contribution / customer" basis={s.arpaBasis || undefined} value={s.contributionPerCustomer === null ? "—" : inr(s.contributionPerCustomer)} sub={s.variablePerCustomer === null ? undefined : `after ${inr(s.variablePerCustomer)} variable cost`} />
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Not counted as revenue: {r.counts.trial} on trial, {r.counts.free} free licenses, {r.counts.other} inactive/other{r.skippedNonInr ? `, ${r.skippedNonInr} non-INR` : ""}. One-time fees are never included.</p>

      <div className="admin-tabs" style={{ marginBottom: 12 }}>
        {[["org", "By organization"], ["product", "By product"]].map(([id, l]) => <button key={id} className={"admin-tab" + (view === id ? " active" : "")} onClick={() => setView(id)}>{l}</button>)}
      </div>
      {r.payingCount === 0 ? (
        <div className="card"><strong>No paying subscriptions yet.</strong><p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>Revenue appears here once an organization has an active paid plan.</p></div>
      ) : view === "org" ? (
        <table className="table">
          <thead><tr><th>Organization</th><th>Plan</th><th>Billing</th><th>Users</th><th>Monthly (ex-GST)</th></tr></thead>
          <tbody>{r.lines.sort((a, b) => b.monthly - a.monthly).map((l) => <tr key={l.orgId}><td>{l.orgName}</td><td>{l.planName}</td><td>{l.billingCycle === "year" ? "Annual ÷ 12" : "Monthly"}</td><td>{l.users}</td><td>{inr(l.monthly)}</td></tr>)}</tbody>
        </table>
      ) : (
        <>
          <table className="table">
            <thead><tr><th>Product</th><th>Organizations</th><th>Users</th><th>MRR</th><th>Share</th></tr></thead>
            <tbody>{r.products.map((p) => <tr key={p.product}><td>{p.product}</td><td>{p.orgs}</td><td>{p.users}</td><td>{inr(p.mrr)}</td><td>{r.mrr ? Math.round((p.mrr / r.mrr) * 100) : 0}%</td></tr>)}</tbody>
          </table>
          <p className="muted" style={{ fontSize: 12.5 }}>Suite subscriptions are split equally across their apps (an allocation, not a billed figure), so product totals add up to MRR with nothing counted twice. Cost per product is not tracked yet.</p>
        </>
      )}

      <div className="card" style={{ marginTop: 20 }}>
        <p className="section-title" style={{ marginTop: 0 }}>Revenue assumptions</p>
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="muted" style={{ fontSize: 12.5 }}>GST %<br /><input className="input" style={{ width: 90 }} type="number" min="0" max="100" disabled={!isOwner} value={set.gstRate} onChange={(e) => setSet({ ...set, gstRate: e.target.value })} /></label>
          <label className="muted" style={{ fontSize: 12.5 }}>Customer prices<br /><select className="input" disabled={!isOwner} value={set.gstInclusive ? "in" : "ex"} onChange={(e) => setSet({ ...set, gstInclusive: e.target.value === "in" })}><option value="in">Include GST</option><option value="ex">Exclude GST</option></select></label>
          <label className="muted" style={{ fontSize: 12.5 }}>Gateway fee % of billing<br /><input className="input" style={{ width: 110 }} type="number" min="0" max="100" step="0.1" placeholder="e.g. 2" disabled={!isOwner} value={set.gatewayFeePct} onChange={(e) => setSet({ ...set, gatewayFeePct: e.target.value })} /></label>
          <label className="muted" style={{ fontSize: 12.5 }}>Planning revenue / customer ₹<br /><input className="input" style={{ width: 130 }} type="number" min="0" placeholder="used only if no paying customers" disabled={!isOwner} value={set.assumedArpa} onChange={(e) => setSet({ ...set, assumedArpa: e.target.value })} /></label>
          {isOwner && <button className="btn-primary" disabled={busy} onClick={() => run({ action: "saveSettings", settings: set })}>{busy ? "Saving…" : "Save"}</button>}
        </div>
        {err && <p className="error" style={{ marginTop: 8 }}>{err}</p>}
      </div>
    </div>
  );
}

// ---- Forecast & break-even --------------------------------------------------
const SLIDERS = [
  ["customerGrowthPct", "Customer growth per month (%)", -50, 100],
  ["newCustomersPerMonth", "New customers per month", 0, 50],
  ["priceChangePct", "Price change (%)", -50, 100],
  ["salaryChangePct", "Salary change (%)", -50, 100],
  ["infraUsageChangePct", "Infrastructure usage change (%)", -50, 300],
  ["marketingChangePct", "Marketing spend change (%)", -100, 300],
];
const ZERO = Object.fromEntries(SLIDERS.map(([k]) => [k, 0]));

function Forecast({ data, isOwner, reload }) {
  const [inputs, setInputs] = useState(ZERO);
  const [name, setName] = useState("");
  const { busy, err, run } = useAction(reload);
  const s = data.summary;
  const base = data.scenarioBase;
  const current = useMemo(() => runScenario(base, ZERO), [base]);
  const scn = useMemo(() => runScenario(base, inputs), [base, inputs]);
  const costKnown = s.totalMonthlyCost !== null;
  const changed = SLIDERS.some(([k]) => Number(inputs[k]) !== 0);

  if (!costKnown) return (
    <div className="card"><strong>Add operating expenses first.</strong><p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>Forecasts and what-ifs need your real cost base. Without it the result would be a guess presented as a number.</p></div>
  );
  return (
    <div>
      <div className="proj-grid" style={GRID}>
        <Stat label="Break-even customers" basis={s.arpaBasis || undefined} value={s.breakevenCustomers ?? "—"} sub={s.customersShort ? `${s.customersShort} more than today` : s.breakevenCustomers ? "Reached" : "Needs revenue per customer"} />
        <Stat label="Runway today" value={s.runwayState === "profitable" ? "Profitable" : s.runwayMonths !== null ? `${s.runwayMonths} months` : "Needs cash balance"} />
        <Stat label="Contribution / customer" basis={s.arpaBasis || undefined} value={s.contributionPerCustomer === null ? "—" : inr(s.contributionPerCustomer)} />
        <Stat label="Break-even month (no change)" basis="forecast" value={current.breakevenMonth ? `Month ${current.breakevenMonth}` : "Not within 12 months"} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="section-title" style={{ marginTop: 0 }}>What-if simulator<Badge basis="forecast" /></p>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Starts from your actual numbers today and projects 12 months. Nothing here changes your real data.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {SLIDERS.map(([k, l, min, max]) => (
            <label key={k} style={{ fontSize: 13 }}>{l}: <strong>{inputs[k]}</strong>
              <input type="range" min={min} max={max} value={inputs[k]} style={{ width: "100%" }} onChange={(e) => setInputs({ ...inputs, [k]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <button className="link-btn" onClick={() => setInputs(ZERO)}>Reset</button>
          {isOwner && <>
            <input className="input" style={{ maxWidth: 220 }} placeholder="Scenario name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-ghost" disabled={busy || !changed} onClick={() => run({ action: "saveScenario", name, inputs }, () => setName(""))}>Save scenario</button>
          </>}
        </div>
        {err && <p className="error" style={{ marginTop: 8 }}>{err}</p>}
        {data.scenarios.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 13 }}>Saved: {data.scenarios.map((sc) => (
            <span key={sc.id} style={{ marginRight: 12 }}>
              <button className="link-btn" onClick={() => setInputs({ ...ZERO, ...sc.inputs })}>{sc.name}</button>
              {isOwner && <button className="link-btn" title="Delete scenario" onClick={() => { if (confirm(`Delete scenario "${sc.name}"?`)) run({ action: "deleteScenario", id: sc.id }); }}> ✕</button>}
            </span>))}
          </div>
        )}
      </div>

      <div className="proj-grid" style={GRID}>
        <Stat label="Break-even customers" basis="forecast" value={scn.breakevenCustomers ?? "—"} sub={changed && current.breakevenCustomers != null && scn.breakevenCustomers != null ? `${scn.breakevenCustomers - current.breakevenCustomers >= 0 ? "+" : ""}${scn.breakevenCustomers - current.breakevenCustomers} vs today` : undefined} />
        <Stat label="Break-even month" basis="forecast" value={scn.breakevenMonth ? `Month ${scn.breakevenMonth}` : "Not within 12 months"} />
        <Stat label="Month-12 profit" basis="forecast" value={inr(scn.endProfit)} tone={scn.endProfit >= 0 ? "good" : "bad"} sub={changed ? `${inr(current.endProfit)} with no change` : undefined} />
        <Stat label="Cash after 12 months" basis="forecast" value={scn.endCash === null ? "Needs cash balance" : inr(scn.endCash)} tone={scn.endCash !== null && scn.endCash < 0 ? "bad" : undefined} sub={scn.runOutMonth ? `Runs out in month ${scn.runOutMonth}` : undefined} />
      </div>

      <table className="table">
        <thead><tr><th>Month</th><th>Customers</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Cash</th></tr></thead>
        <tbody>{scn.rows.map((r) => <tr key={r.month}><td>{r.month}</td><td>{r.customers}</td><td>{inr(r.revenue)}</td><td>{inr(r.cost)}</td><td style={{ color: r.profit < 0 ? "#b91c1c" : undefined }}>{inr(r.profit)}</td><td>{r.cash === null ? "—" : inr(r.cash)}</td></tr>)}</tbody>
      </table>
      <p className="muted" style={{ fontSize: 12.5 }}>Cloud cost scales with customer count. Salaries, marketing and pricing apply the percentage you pick. Payment gateway fees follow billing.</p>
    </div>
  );
}

// ---- Legacy migration -------------------------------------------------------
function LegacyBanner({ data, reload }) {
  const lp = data.legacyPending;
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState({});
  const { busy, err, run } = useAction(reload);
  const missing = lp.recurring.some((r) => !cats[r.index]);
  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: "4px solid #f59e0b" }}>
      <strong>{lp.recurring.length + lp.oneTime.length} cost line(s) from the old Business Health page need to be moved.</strong>
      <p className="muted" style={{ fontSize: 13, margin: "4px 0" }}>Recurring lines become categorised monthly expenses. Old “one-time” lines become one-time investments (they were never monthly). The old record is kept untouched.</p>
      {!open ? <button className="btn-primary" onClick={() => setOpen(true)}>Review and import</button> : (
        <>
          {lp.recurring.map((r) => (
            <div key={"r" + r.index} className="row" style={{ gap: 10, margin: "6px 0", alignItems: "center" }}>
              <span style={{ flex: 2 }}>{r.label} · {inr(r.amount)}/month</span>
              <select className="input" style={{ flex: 1 }} value={cats[r.index] || ""} onChange={(e) => setCats({ ...cats, [r.index]: e.target.value })}>
                <option value="">Choose category…</option>{CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          ))}
          {lp.oneTime.map((r) => <div key={"o" + r.index} style={{ margin: "6px 0", fontSize: 13 }}>{r.label} · {inr(r.amount)} → one-time investment</div>)}
          {lp.assumedAvgRevenue > 0 && <p className="muted" style={{ fontSize: 13 }}>Your assumed revenue per customer ({inr(lp.assumedAvgRevenue)}) will be kept as a planning assumption.</p>}
          <button className="btn-primary" disabled={busy || missing} onClick={() => run({ action: "importLegacy", rows: [
            ...lp.recurring.map((r) => ({ source: "recurring", index: r.index, category: cats[r.index] })),
            ...lp.oneTime.map((r) => ({ source: "oneTime", index: r.index })),
          ] })}>{busy ? "Importing…" : "Import"}</button>
          {err && <p className="error" style={{ marginTop: 8 }}>{err}</p>}
        </>
      )}
    </div>
  );
}

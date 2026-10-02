// Pure (no Firebase, no I/O) maths for the Platform Admin "Cost & Usage"
// dashboard, so the same code runs in the API routes, the daily cron, and
// can be unit-tested in plain node.
//
// DATA FLOW (nothing here ever scans a transactional collection):
//   apps  --POST /api/usage/ingest-->  usageDaily/{date}_{organizationId}
//   usageDaily (+ customers registry) --buildDayAnalytics()--> costAnalyticsDaily/{date}
//   dashboard reads ONLY usageDaily + costAnalyticsDaily (date-ranged).
//
// FUTURE GOOGLE CLOUD BILLING (BigQuery) INTEGRATION: a scheduled export job
// only has to write real invoiced figures to
//   costAnalyticsDaily/{date}.billingActual = { firestoreCost, functionsCost,
//   storageCost, networkCost, hostingCost }
// buildDayAnalytics() preserves that block and prefers it over the rate-card
// estimate for every field it provides, flagging the day costSource:"billing".
// No dashboard change is needed.
//
// Currency is INR throughout, like the rest of the admin portal.

export const MODULES = [
  { key: "pos", label: "POS", field: "posTransactions" },
  { key: "attendance", label: "Attendance", field: "attendanceTransactions" },
  { key: "crm", label: "CRM", field: "crmTransactions" },
  { key: "inventory", label: "Inventory", field: "inventoryTransactions" },
  { key: "expenses", label: "Expenses", field: "expensesTransactions" },
  { key: "purchases", label: "Purchases", field: "purchasesTransactions" },
  { key: "invoices", label: "Invoices", field: "invoiceTransactions" },
  { key: "payments", label: "Payments", field: "paymentTransactions" },
];
export const MODULE_KEYS = MODULES.map((m) => m.key);

// Rate card used to ESTIMATE cost until real billing data is imported.
// Overridable by the Platform Owner (platformFinance/costRates). Defaults are
// Google's published Firestore/Functions/Storage list prices converted at
// ~₹85/USD, rounded; free-tier allowances are deliberately ignored so the
// estimate errs on the high side.
export const DEFAULT_RATES = {
  firestoreReadPer100k: 5.1, // $0.06
  firestoreWritePer100k: 15.3, // $0.18
  firestoreDeletePer100k: 1.7, // $0.02
  functionsPerMillionInvocations: 34, // $0.40
  functionsInvocationsPerTransaction: 1,
  storagePerGBMonth: 15.3, // $0.18
  networkPerGB: 10.2, // $0.12
  bytesPerRead: 1500, // average document size sent to clients
  bytesPerWrite: 600,
  baselineStorageGB: 0, // used when apps report no storage
  hostingMonthly: 0, // fixed monthly Vercel/Firebase Hosting spend (INR)
};

export function mergeRates(stored) {
  const out = { ...DEFAULT_RATES };
  if (stored && typeof stored === "object") {
    for (const k of Object.keys(DEFAULT_RATES)) {
      const v = Number(stored[k]);
      if (stored[k] !== undefined && stored[k] !== null && stored[k] !== "" && Number.isFinite(v) && v >= 0) out[k] = v;
    }
  }
  return out;
}

// ---- dates (IST day boundaries, "YYYY-MM-DD") ------------------------------
const DAY_MS = 86400000;
export function dateKey(d = new Date()) {
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
}
export function isDateKey(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}
export function addDays(key, n) {
  return new Date(Date.parse(key + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}
export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export function daysInMonthOf(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export const monthStart = (key) => key.slice(0, 8) + "01";

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r4 = (v) => Math.round(v * 10000) / 10000;
const div = (a, b) => (b > 0 ? a / b : 0);

// ---- one usageDaily doc -> normalised numbers --------------------------------
export function normUsage(doc) {
  const modTx = {};
  let modTxSum = 0;
  for (const m of MODULES) {
    modTx[m.key] = n(doc[m.field]);
    modTxSum += modTx[m.key];
  }
  return {
    date: doc.date,
    orgId: doc.organizationId,
    activeUsers: Math.max(n(doc.activeUsers), Array.isArray(doc.activeUserIds) ? doc.activeUserIds.length : 0),
    userIds: Array.isArray(doc.activeUserIds) ? doc.activeUserIds : [],
    transactions: n(doc.transactions) || modTxSum,
    modTx,
    reads: n(doc.firestoreReads),
    writes: n(doc.firestoreWrites),
    deletes: n(doc.firestoreDeletes),
    modReads: doc.moduleReads || {},
    modWrites: doc.moduleWrites || {},
    storageGB: n(doc.storageGB),
  };
}

export function firestoreCostOf(reads, writes, deletes, rates) {
  return (
    (reads / 1e5) * rates.firestoreReadPer100k +
    (writes / 1e5) * rates.firestoreWritePer100k +
    (deletes / 1e5) * rates.firestoreDeletePer100k
  );
}

// Platform-wide costAnalyticsDaily/{date} document for one day.
//   usage    - normUsage() rows for that day (one per organization)
//   revenue  - the day's recognised revenue (monthly recurring / 30)
//   existing - the current costAnalyticsDaily doc, if any (keeps billingActual)
export function buildDayAnalytics(date, usage, rates, revenue = 0, existing = null) {
  let reads = 0, writes = 0, deletes = 0, tx = 0, users = 0, storage = 0, customers = 0;
  for (const u of usage) {
    reads += u.reads; writes += u.writes; deletes += u.deletes; tx += u.transactions;
    users += u.activeUsers; storage += u.storageGB;
    if (u.transactions > 0 || u.reads > 0 || u.writes > 0 || u.activeUsers > 0) customers++;
  }
  const storageGB = storage > 0 ? storage : rates.baselineStorageGB;
  const networkGB = (reads * rates.bytesPerRead + writes * rates.bytesPerWrite) / 1e9;

  const est = {
    firestoreCost: firestoreCostOf(reads, writes, deletes, rates),
    functionsCost: (tx * rates.functionsInvocationsPerTransaction / 1e6) * rates.functionsPerMillionInvocations,
    storageCost: (storageGB * rates.storagePerGBMonth) / 30,
    networkCost: networkGB * rates.networkPerGB,
    hostingCost: rates.hostingMonthly / daysInMonthOf(date),
  };
  const billing = existing?.billingActual && typeof existing.billingActual === "object" ? existing.billingActual : null;
  const cost = {};
  let usedBilling = false;
  for (const k of Object.keys(est)) {
    const b = billing ? billing[k] : undefined;
    if (b !== undefined && b !== null && Number.isFinite(Number(b))) { cost[k] = Number(b); usedBilling = true; }
    else cost[k] = est[k];
  }
  const totalCloudCost = Object.values(cost).reduce((s, v) => s + v, 0);

  const doc = {
    date,
    customers,
    activeUsers: users,
    transactions: tx,
    firestoreReads: reads,
    firestoreWrites: writes,
    firestoreDeletes: deletes,
    storageGB: r4(storageGB),
    networkGB: r4(networkGB),
    firestoreCost: r4(cost.firestoreCost),
    functionsCost: r4(cost.functionsCost),
    storageCost: r4(cost.storageCost),
    networkCost: r4(cost.networkCost),
    hostingCost: r4(cost.hostingCost),
    totalCloudCost: r4(totalCloudCost),
    costPerCustomer: r4(div(totalCloudCost, customers)),
    costPerUser: r4(div(totalCloudCost, users)),
    costPerTransaction: r4(div(totalCloudCost, tx)),
    revenue: r4(revenue),
    costSource: usedBilling ? "billing" : "estimate",
  };
  if (billing) doc.billingActual = billing;
  return doc;
}

// ---- anomaly detection ---------------------------------------------------------
// Compares each org's (and module's) recent daily average against its own
// baseline. Needs `usageByDate` = Map(date -> normUsage[]) covering the range.
const RECENT_DAYS = 3;
const BASELINE_DAYS = 14;
const GROWTH_RATIO = 2; // recent avg >= 2x baseline avg
const MIN_DAILY_OPS = 2000; // ignore tiny absolute volumes (noise)

export function detectAnomalies(usageByDate, endDate, orgNames = {}) {
  const alerts = [];
  const recentDates = dateRange(addDays(endDate, -(RECENT_DAYS - 1)), endDate);
  const baseDates = dateRange(addDays(endDate, -(RECENT_DAYS + BASELINE_DAYS - 1)), addDays(endDate, -RECENT_DAYS));

  const sumBy = (dates, pick) => {
    const m = new Map();
    for (const d of dates) for (const u of usageByDate.get(d) || []) {
      for (const [k, v] of pick(u)) m.set(k, (m.get(k) || 0) + v);
    }
    return m;
  };
  const orgOps = (u) => [[u.orgId, u.reads + u.writes]];
  const modOps = (u) => {
    const out = [];
    for (const k of MODULE_KEYS) out.push([u.orgId + "|" + k, n(u.modReads[k]) + n(u.modWrites[k])]);
    return out;
  };
  const platformOps = (u) => [["_", u.reads + u.writes]];

  const check = (pick, label) => {
    const recent = sumBy(recentDates, pick);
    const base = sumBy(baseDates, pick);
    for (const [key, rSum] of recent) {
      const rAvg = rSum / recentDates.length;
      if (rAvg < MIN_DAILY_OPS) continue;
      const bAvg = (base.get(key) || 0) / baseDates.length;
      // A brand-new org/module (no baseline) counts as growth only when it is already large.
      const ratio = bAvg > 0 ? rAvg / bAvg : rAvg >= MIN_DAILY_OPS * 5 ? Infinity : 0;
      if (ratio >= GROWTH_RATIO) label(key, rAvg, bAvg, ratio);
    }
  };

  check(platformOps, (_k, rAvg, bAvg, ratio) =>
    alerts.push({ level: "platform", severity: ratio >= 4 ? "high" : "medium", title: "Platform Firestore volume up " + fmtRatio(ratio), detail: `${Math.round(rAvg).toLocaleString("en-IN")} reads+writes/day vs ${Math.round(bAvg).toLocaleString("en-IN")} baseline` }));
  check(orgOps, (key, rAvg, bAvg, ratio) =>
    alerts.push({ level: "customer", orgId: key, name: orgNames[key] || key, severity: ratio >= 4 ? "high" : "medium", ratio: Number.isFinite(ratio) ? r4(ratio) : null, title: `${orgNames[key] || key}: reads+writes up ${fmtRatio(ratio)}`, detail: `${Math.round(rAvg).toLocaleString("en-IN")}/day vs ${Math.round(bAvg).toLocaleString("en-IN")} baseline` }));
  check(modOps, (key, rAvg, bAvg, ratio) => {
    const [orgId, mod] = key.split("|");
    const label = MODULES.find((m) => m.key === mod)?.label || mod;
    alerts.push({ level: "module", orgId, module: mod, name: orgNames[orgId] || orgId, severity: ratio >= 4 ? "high" : "medium", ratio: Number.isFinite(ratio) ? r4(ratio) : null, title: `${orgNames[orgId] || orgId} · ${label}: reads+writes up ${fmtRatio(ratio)}`, detail: `${Math.round(rAvg).toLocaleString("en-IN")}/day vs ${Math.round(bAvg).toLocaleString("en-IN")} baseline` });
  });

  // Inefficient access pattern: many reads per transaction compared with the platform norm.
  const perOrg = sumBy(recentDates, (u) => [[u.orgId, u.reads]]);
  const perOrgTx = sumBy(recentDates, (u) => [[u.orgId, u.transactions]]);
  const ratios = [];
  for (const [k, r] of perOrg) { const t = perOrgTx.get(k) || 0; if (t >= 20) ratios.push([k, r / t, r]); }
  if (ratios.length >= 3) {
    const sorted = ratios.map((x) => x[1]).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const [k, rpt, r] of ratios) {
      if (median > 0 && rpt >= median * 5 && r / recentDates.length >= MIN_DAILY_OPS) {
        alerts.push({ level: "customer", orgId: k, name: orgNames[k] || k, severity: "medium", ratio: r4(rpt / median), title: `${orgNames[k] || k}: ${Math.round(rpt)} reads per transaction`, detail: `${Math.round(rpt / median)}× the platform median (${Math.round(median)}) — likely an inefficient query or listener` });
      }
    }
  }
  const order = { high: 0, medium: 1 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
function fmtRatio(r) { return Number.isFinite(r) ? r.toFixed(1) + "×" : "sharply (new)"; }

// ---- the dashboard payload ------------------------------------------------------
// usageByDate: Map(date -> normUsage[]), days: costAnalyticsDaily docs by date,
// tenants: Map(orgId -> { name, plan, users, status, paying, monthlyRevenue })
export function buildDashboard({ from, to, usageByDate, days, tenants, rates }) {
  const dates = dateRange(from, to);
  const nDays = dates.length;
  const dayDocs = dates.map((d) => days.get(d) || buildDayAnalytics(d, usageByDate.get(d) || [], rates, 0));

  // Per-org + per-module accumulation with Firestore cost attributed directly,
  // and each day's non-Firestore cost shared out by that day's ops share.
  const orgs = new Map();
  const modules = new Map(MODULE_KEYS.map((k) => [k, { key: k, label: MODULES.find((m) => m.key === k).label, transactions: 0, reads: 0, writes: 0, cost: 0 }]));
  const uniqueUsers = new Set();
  const sparkDates = dates.slice(-14);

  dates.forEach((d, i) => {
    const rows = usageByDate.get(d) || [];
    const day = dayDocs[i];
    const totalOps = rows.reduce((s, u) => s + u.reads + u.writes + u.deletes, 0);
    const shared = day.totalCloudCost - day.firestoreCost; // functions + storage + network + hosting
    for (const u of rows) {
      const direct = firestoreCostOf(u.reads, u.writes, u.deletes, rates);
      // when real billing replaced the Firestore estimate, scale direct costs to match it
      const scale = day.costSource === "billing" && day.firestoreCost > 0 ? day.firestoreCost / Math.max(1e-9, rows.reduce((s, x) => s + firestoreCostOf(x.reads, x.writes, x.deletes, rates), 0)) : 1;
      const cost = direct * scale + (totalOps > 0 ? shared * ((u.reads + u.writes + u.deletes) / totalOps) : 0);
      const o = orgs.get(u.orgId) || { orgId: u.orgId, transactions: 0, reads: 0, writes: 0, cost: 0, users: new Set(), peakUsers: 0, trend: {} };
      o.transactions += u.transactions; o.reads += u.reads; o.writes += u.writes; o.cost += cost;
      u.userIds.forEach((id) => { o.users.add(id); uniqueUsers.add(u.orgId + ":" + id); });
      o.peakUsers = Math.max(o.peakUsers, u.activeUsers);
      o.trend[d] = cost;
      orgs.set(u.orgId, o);
      for (const k of MODULE_KEYS) {
        const m = modules.get(k);
        const mr = n(u.modReads[k]), mw = n(u.modWrites[k]);
        m.transactions += u.modTx[k]; m.reads += mr; m.writes += mw;
        m.cost += firestoreCostOf(mr, mw, 0, rates);
      }
    }
  });

  const sumF = (f) => dayDocs.reduce((s, x) => s + n(x[f]), 0);
  const totalCost = sumF("totalCloudCost");
  const totalTx = sumF("transactions");
  const totalReads = sumF("firestoreReads");
  const totalWrites = sumF("firestoreWrites");

  // Tenants
  let payingCustomers = 0, mrr = 0, paidUsers = 0;
  for (const t of tenants.values()) if (t.paying) { payingCustomers++; mrr += t.monthlyRevenue; paidUsers += t.users; }
  const revenue = (mrr / 30) * nDays;
  const activeCustomers = orgs.size;
  const activeUsers = Math.max(uniqueUsers.size, ...dayDocs.map((x) => n(x.activeUsers)), 0);
  const avgDailyUsers = div(sumF("activeUsers"), nDays);

  const curMonth = monthStart(to);
  const monthDocs = dayDocs.filter((x) => x.date >= curMonth);
  const sumM = (f) => monthDocs.reduce((s, x) => s + n(x[f]), 0);
  const monthTx = sumM("transactions");

  const kpis = {
    business: {
      activeCustomers,
      payingCustomers,
      activeUsers,
      avgUsersPerCustomer: div(activeUsers, activeCustomers),
      transactionsPerDay: div(totalTx, nDays),
      transactionsThisMonth: monthTx,
      transactionsPerUserPerDay: div(sumF("transactions"), sumF("activeUsers")),
    },
    cost: {
      currentMonthCost: sumM("totalCloudCost"),
      firestoreCost: sumF("firestoreCost"),
      functionsCost: sumF("functionsCost"),
      storageCost: sumF("storageCost"),
      hostingCost: sumF("hostingCost"),
      networkCost: sumF("networkCost"),
      rangeCost: totalCost,
      costPerCustomer: div(totalCost, activeCustomers),
      costPerUser: div(totalCost, activeUsers),
      costPerTransaction: div(totalCost, totalTx),
      revenuePerCustomer: div(mrr, payingCustomers), // monthly
      revenuePerUser: div(mrr, paidUsers), // monthly
      rangeRevenue: revenue,
      infraPctOfRevenue: revenue > 0 ? (totalCost / revenue) * 100 : null,
      estimatedDays: dayDocs.filter((x) => x.costSource !== "billing").length,
      billedDays: dayDocs.filter((x) => x.costSource === "billing").length,
    },
  };

  const customers = [...orgs.values()].map((o) => {
    const t = tenants.get(o.orgId) || {};
    const trend = sparkDates.map((d) => r4(o.trend[d] || 0));
    const half = Math.floor(trend.length / 2);
    const a = trend.slice(0, half).reduce((s, v) => s + v, 0), b = trend.slice(half).reduce((s, v) => s + v, 0);
    const monthlyRev = t.paying ? t.monthlyRevenue : 0;
    const rev = (monthlyRev / 30) * nDays;
    return {
      organizationId: o.orgId,
      name: t.name || o.orgId,
      plan: t.plan || "—",
      status: t.status || "unknown",
      paying: !!t.paying,
      users: t.users || 0,
      activeUsers: o.users.size || o.peakUsers,
      transactions: o.transactions,
      reads: o.reads,
      writes: o.writes,
      cost: r4(o.cost),
      revenue: r4(rev),
      infraPct: rev > 0 ? r4((o.cost / rev) * 100) : null,
      trend,
      trendPct: a > 0 ? r4(((b - a) / a) * 100) : null,
    };
  }).sort((x, y) => y.cost - x.cost);

  const series = dayDocs.map((d) => ({
    date: d.date,
    cost: n(d.totalCloudCost),
    costPerCustomer: n(d.costPerCustomer),
    reads: n(d.firestoreReads),
    writes: n(d.firestoreWrites),
    transactions: n(d.transactions),
    revenue: (mrr / 30),
  }));

  const orgNames = Object.fromEntries([...tenants].map(([id, t]) => [id, t.name || id]));
  const alerts = detectAnomalies(usageByDate, to, orgNames);

  // Which customers/modules are abnormal -> highlight keys for the UI.
  const flaggedOrgs = [...new Set(alerts.filter((a) => a.orgId).map((a) => a.orgId))];
  const flaggedModules = alerts.filter((a) => a.level === "module").map((a) => a.orgId + "|" + a.module);

  return {
    range: { from, to, days: nDays },
    kpis,
    series,
    customers,
    modules: [...modules.values()].map((m) => ({ ...m, cost: r4(m.cost) })).sort((a, b) => b.cost - a.cost),
    alerts,
    flaggedOrgs,
    flaggedModules,
    hasUsageData: customers.length > 0,
  };
}

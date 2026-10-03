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
  // Other Bizzux apps (report straight into usageDaily from their servers).
  { key: "projects", label: "Projects", field: "projectsTransactions" },
  { key: "notes", label: "Notes", field: "notesTransactions" },
  { key: "files", label: "Files", field: "filesTransactions" },
  { key: "chat", label: "Chat", field: "chatTransactions" },
  { key: "mail", label: "Mail", field: "mailTransactions" },
  { key: "assistant", label: "Assistant (personal)", field: "assistantTransactions" },
];
export const MODULE_KEYS = MODULES.map((m) => m.key);

// Bizzux applications that can report usage (the optional `app` on an event).
export const APPS = [
  { key: "shop", label: "Shop / POS" },
  { key: "crm", label: "CRM" },
  { key: "notes", label: "Notes" },
  { key: "files", label: "Files" },
  { key: "projects", label: "Projects" },
  { key: "assistant", label: "Assistant" },
  { key: "attendance", label: "Attendance" },
  { key: "capture", label: "Capture" },
  { key: "chat", label: "Chat" },
  { key: "mail", label: "Mail" },
  { key: "finance", label: "Finance" },
  { key: "portal", label: "Portal / Web" },
];
export const APP_KEYS = APPS.map((a) => a.key);

// Metered third-party / non-Firestore consumption. Apps report `units` for a
// `service`; cost = units / divisor * rates[rate]. Always estimates: no
// billing export covers them (Google Cloud itself is priced below and is
// replaced by real billing when imported).
export const SERVICES = [
  { key: "aiTokens", label: "AI tokens", provider: "AI provider", unit: "tokens", divisor: 1e6, rate: "aiPer1MTokens" },
  { key: "ocrPages", label: "OCR pages", provider: "OCR provider", unit: "pages", divisor: 1e3, rate: "ocrPer1kPages" },
  { key: "smsCount", label: "SMS", provider: "SMS provider", unit: "messages", divisor: 1, rate: "smsPerMessage" },
  { key: "whatsappCount", label: "WhatsApp", provider: "WhatsApp provider", unit: "messages", divisor: 1, rate: "whatsappPerMessage" },
  { key: "emailCount", label: "Email", provider: "Email provider", unit: "emails", divisor: 1e3, rate: "emailPer1k" },
  { key: "authOps", label: "Authentication operations", provider: "Firebase / Google Cloud", unit: "operations", divisor: 1e3, rate: "authPer1k" },
  { key: "fileUploads", label: "File uploads", provider: "Firebase / Google Cloud", unit: "uploads", divisor: 1e3, rate: "uploadPer1k" },
  { key: "fileDownloads", label: "File downloads", provider: "Firebase / Google Cloud", unit: "downloads", divisor: 1e3, rate: "downloadPer1k" },
  { key: "apiCalls", label: "Other third-party API calls", provider: "Other APIs", unit: "calls", divisor: 1e3, rate: "otherApiPer1k" },
];
export const SERVICE_KEYS = SERVICES.map((x) => x.key);
// Reported in GB and folded into the network estimate rather than priced as a service.
export const EGRESS_KEY = "egressGB";
export const SERVICE_UNIT_KEYS = [...SERVICE_KEYS, EGRESS_KEY];

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
  // Third-party services (INR). Placeholder list prices - edit under FinOps > Cost Rates.
  aiPer1MTokens: 25,
  ocrPer1kPages: 130,
  smsPerMessage: 0.25,
  whatsappPerMessage: 0.8,
  emailPer1k: 85,
  authPer1k: 0,
  uploadPer1k: 0,
  downloadPer1k: 0,
  otherApiPer1k: 0,
  // Alert thresholds (INR, or % for alertInfraPct). 0 disables the check.
  alertDailyCost: 0,
  alertMonthlyBudget: 0,
  alertInfraPct: 30,
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
    svc: doc.serviceUnits && typeof doc.serviceUnits === "object" ? doc.serviceUnits : {},
    appOps: doc.appOps && typeof doc.appOps === "object" ? doc.appOps : {},
    appSvc: doc.appServiceUnits && typeof doc.appServiceUnits === "object" ? doc.appServiceUnits : {},
  };
}

// Cost of a { serviceKey: units } map -> { byService, total }.
export function serviceCostOf(units, rates) {
  const byService = {};
  let total = 0;
  for (const sv of SERVICES) {
    const c = (n(units?.[sv.key]) / sv.divisor) * n(rates[sv.rate]);
    if (c > 0) { byService[sv.key] = c; total += c; }
  }
  return { byService, total };
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
  const svcUnits = {};
  for (const u of usage) for (const k of SERVICE_UNIT_KEYS) if (n(u.svc[k])) svcUnits[k] = (svcUnits[k] || 0) + n(u.svc[k]);
  const third = serviceCostOf(svcUnits, rates);
  const networkGB = (reads * rates.bytesPerRead + writes * rates.bytesPerWrite) / 1e9 + n(svcUnits[EGRESS_KEY]);

  const est = {
    firestoreCost: firestoreCostOf(reads, writes, deletes, rates),
    functionsCost: (tx * rates.functionsInvocationsPerTransaction / 1e6) * rates.functionsPerMillionInvocations,
    storageCost: (storageGB * rates.storagePerGBMonth) / 30,
    networkCost: networkGB * rates.networkPerGB,
    hostingCost: rates.hostingMonthly / daysInMonthOf(date),
    otherCost: 0, // other GCP services only ever show up in real billing
  };
  // Third-party services are never in Google billing, so they stay estimated
  // (and are added on top) even for a billed day.
  const estimatedCloudCost = Object.values(est).reduce((s, v) => s + v, 0) + third.total;
  // A day with a billingActual block is a BILLED day: every figure comes from
  // Google (a service absent from the export genuinely cost 0 that day).
  const billing = existing?.billingActual && typeof existing.billingActual === "object" ? existing.billingActual : null;
  const cost = {};
  for (const k of Object.keys(est)) cost[k] = billing ? n(billing[k]) : est[k];
  const usedBilling = !!billing;
  cost.thirdPartyCost = third.total;
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
    otherCost: r4(cost.otherCost),
    thirdPartyCost: r4(third.total),
    serviceUnits: svcUnits,
    serviceCosts: Object.fromEntries(Object.entries(third.byService).map(([k, v]) => [k, r4(v)])),
    estimatedCloudCost: r4(estimatedCloudCost),
    actualCloudCost: usedBilling ? r4(totalCloudCost) : null,
    totalCloudCost: r4(totalCloudCost),
    costPerCustomer: r4(div(totalCloudCost, customers)),
    costPerUser: r4(div(totalCloudCost, users)),
    costPerTransaction: r4(div(totalCloudCost, tx)),
    revenue: r4(revenue),
    costSource: usedBilling ? "billing" : "estimate",
  };
  if (billing) {
    doc.billingActual = billing;
    if (existing.lastBillingUpdate) doc.lastBillingUpdate = existing.lastBillingUpdate;
  }
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
export function buildDashboard({ from, to, usageByDate, days, tenants, rates, today = to }) {
  const dates = dateRange(from, to);
  const nDays = dates.length;
  const dayDocs = dates.map((d) => days.get(d) || buildDayAnalytics(d, usageByDate.get(d) || [], rates, 0));

  // Per-org + per-module accumulation with Firestore cost attributed directly,
  // and each day's non-Firestore cost shared out by that day's ops share.
  const orgs = new Map();
  const modules = new Map(MODULE_KEYS.map((k) => [k, { key: k, label: MODULES.find((m) => m.key === k).label, transactions: 0, reads: 0, writes: 0, cost: 0 }]));
  const apps = new Map();
  const uniqueUsers = new Set();
  const sparkDates = dates.slice(-14);

  dates.forEach((d, i) => {
    const rows = usageByDate.get(d) || [];
    const day = dayDocs[i];
    const totalOps = rows.reduce((s, u) => s + u.reads + u.writes + u.deletes, 0);
    // functions + storage + network + hosting (third-party services are attributed directly, below)
    const shared = day.totalCloudCost - day.firestoreCost - n(day.thirdPartyCost);
    for (const u of rows) {
      const direct = firestoreCostOf(u.reads, u.writes, u.deletes, rates) + serviceCostOf(u.svc, rates).total;
      // apps: Firestore ops + their own service units, attributed to the reporting app
      for (const [app, ops] of Object.entries(u.appOps)) {
        const a = apps.get(app) || { key: app, label: APPS.find((x) => x.key === app)?.label || app, transactions: 0, reads: 0, writes: 0, cost: 0 };
        a.transactions += n(ops.tx); a.reads += n(ops.reads); a.writes += n(ops.writes);
        a.cost += firestoreCostOf(n(ops.reads), n(ops.writes), 0, rates);
        apps.set(app, a);
      }
      for (const [app, units] of Object.entries(u.appSvc)) {
        const a = apps.get(app) || { key: app, label: APPS.find((x) => x.key === app)?.label || app, transactions: 0, reads: 0, writes: 0, cost: 0 };
        a.cost += serviceCostOf(units, rates).total;
        apps.set(app, a);
      }
      // when real billing replaced the Firestore estimate, scale direct costs to match it
      const scale = day.costSource === "billing" && day.firestoreCost > 0 ? day.firestoreCost / Math.max(1e-9, rows.reduce((s, x) => s + firestoreCostOf(x.reads, x.writes, x.deletes, rates), 0)) : 1;
      const svcDirect = serviceCostOf(u.svc, rates).total;
      const cost = (direct - svcDirect) * scale + svcDirect + (totalOps > 0 ? shared * ((u.reads + u.writes + u.deletes) / totalOps) : 0);
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

  // ---- FinOps: actual (Google billing) vs near-real-time estimate -------------
  // Estimated Current Cost = actual billed cost to date + estimated cost of
  // usage that billing has not caught up with yet (unbilled days, plus any
  // shortfall of today's partial billing vs today's usage-based estimate).
  const billed = (x) => x.costSource === "billing";
  const dayToday = dayDocs.find((x) => x.date === today);
  const dayYest = dayDocs.find((x) => x.date === addDays(today, -1));
  const actualMTD = monthDocs.filter(billed).reduce((s, x) => s + n(x.actualCloudCost ?? x.totalCloudCost), 0);
  let estimatedCurrent = actualMTD + monthDocs.filter((x) => !billed(x)).reduce((s, x) => s + n(x.estimatedCloudCost ?? x.totalCloudCost), 0);
  if (dayToday && billed(dayToday)) estimatedCurrent += Math.max(0, n(dayToday.estimatedCloudCost) - n(dayToday.actualCloudCost));
  const estimatedToday = dayToday ? (billed(dayToday) ? Math.max(n(dayToday.actualCloudCost), n(dayToday.estimatedCloudCost)) : n(dayToday.estimatedCloudCost ?? dayToday.totalCloudCost)) : 0;
  const lastBilledDate = [...dayDocs].reverse().find(billed)?.date || null;
  const lastBillingUpdate = dayDocs.map((x) => x.lastBillingUpdate).filter(Boolean).sort().pop() || null;
  const finops = {
    hasBilling: dayDocs.some(billed),
    lastBilledDate,
    lastBillingUpdate,
    actualMTD: dayDocs.some(billed) ? actualMTD : null,
    estimatedCurrent,
    estimatedToday,
    actualToday: dayToday && billed(dayToday) ? n(dayToday.actualCloudCost) : null,
    yesterday: dayYest ? { value: n(dayYest.totalCloudCost), actual: billed(dayYest) } : null,
    byService: {
      firestore: sumF("firestoreCost"), functions: sumF("functionsCost"), storage: sumF("storageCost"),
      hosting: sumF("hostingCost"), network: sumF("networkCost"), other: sumF("otherCost"),
      thirdParty: sumF("thirdPartyCost"),
    },
  };

  // ---- providers & services (range totals) ---------------------------------------
  const svcTotals = new Map(SERVICES.map((sv) => [sv.key, { key: sv.key, label: sv.label, provider: sv.provider, unit: sv.unit, units: 0, cost: 0 }]));
  for (const d of dayDocs) {
    for (const sv of SERVICES) {
      const t = svcTotals.get(sv.key);
      t.units += n(d.serviceUnits?.[sv.key]);
      t.cost += n(d.serviceCosts?.[sv.key]);
    }
  }
  const egressGB = dayDocs.reduce((s, d) => s + n(d.serviceUnits?.[EGRESS_KEY]), 0);
  const providerMap = new Map();
  const addProvider = (name, cost) => { if (cost > 0) providerMap.set(name, (providerMap.get(name) || 0) + cost); };
  addProvider("Firebase / Google Cloud", n(finops.byService.firestore) + n(finops.byService.functions) + n(finops.byService.storage) + n(finops.byService.network) + n(finops.byService.other));
  addProvider("Hosting", finops.byService.hosting);
  for (const t of svcTotals.values()) addProvider(t.provider, t.cost);
  const providers = [...providerMap].map(([name, cost]) => ({ name, cost: r4(cost), pct: totalCost > 0 ? r4((cost / totalCost) * 100) : 0 })).sort((a, b) => b.cost - a.cost);
  const services = [...svcTotals.values()].map((t) => ({ ...t, cost: r4(t.cost) }));

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
      contribution: r4(rev - o.cost),
      costPerTransaction: r4(div(o.cost, o.transactions)),
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
    actual: d.costSource === "billing" ? n(d.actualCloudCost ?? d.totalCloudCost) : null,
    estimated: n(d.estimatedCloudCost ?? d.totalCloudCost),
  }));

  const orgNames = Object.fromEntries([...tenants].map(([id, t]) => [id, t.name || id]));
  const alerts = detectAnomalies(usageByDate, to, orgNames);

  // Cost-threshold alerts (rates.alert*; 0 disables each).
  const inr = (v) => "₹" + Math.round(v).toLocaleString("en-IN");
  const monthCost = sumM("totalCloudCost");
  const dayOfMonth = Number(to.slice(8));
  const projectedMonth = div(monthCost, dayOfMonth) * daysInMonthOf(to);
  const lastDay = dayDocs.find((x) => x.date === to);
  if (n(rates.alertDailyCost) > 0 && lastDay && n(lastDay.totalCloudCost) > rates.alertDailyCost) {
    alerts.unshift({ level: "cost", severity: "high", title: "Daily platform cost over threshold", detail: `${inr(lastDay.totalCloudCost)} on ${to} vs ${inr(rates.alertDailyCost)} limit` });
  }
  if (n(rates.alertMonthlyBudget) > 0) {
    if (monthCost > rates.alertMonthlyBudget) alerts.unshift({ level: "cost", severity: "high", title: "Monthly platform cost budget exceeded", detail: `${inr(monthCost)} so far this month vs ${inr(rates.alertMonthlyBudget)} budget` });
    else if (projectedMonth > rates.alertMonthlyBudget) alerts.push({ level: "cost", severity: "medium", title: "Projected to exceed monthly cost budget", detail: `On pace for ${inr(projectedMonth)} vs ${inr(rates.alertMonthlyBudget)} budget` });
  }
  if (n(rates.alertInfraPct) > 0 && revenue > 0 && (totalCost / revenue) * 100 > rates.alertInfraPct) {
    alerts.push({ level: "cost", severity: "medium", title: "Infrastructure cost share above threshold", detail: `${Math.round((totalCost / revenue) * 1000) / 10}% of revenue vs ${rates.alertInfraPct}% limit` });
  }
  const sev = { high: 0, medium: 1 };
  alerts.sort((a, b) => sev[a.severity] - sev[b.severity]);

  const unitEconomics = {
    revenue: r4(revenue),
    cost: r4(totalCost),
    grossContribution: r4(revenue - totalCost),
    contributionPct: revenue > 0 ? r4(((revenue - totalCost) / revenue) * 100) : null,
    infraPct: revenue > 0 ? r4((totalCost / revenue) * 100) : null,
    costPerTransaction: r4(div(totalCost, totalTx)),
    costPerCustomer: r4(div(totalCost, activeCustomers)),
    costPerUser: r4(div(totalCost, activeUsers)),
    thirdPartyCost: r4(sumF("thirdPartyCost")),
    projectedMonthCost: r4(projectedMonth),
    monthCost: r4(monthCost),
    unprofitableCustomers: customers.filter((c) => c.paying && c.contribution < 0).length,
  };
  const applications = [...apps.values()].map((a) => ({ ...a, cost: r4(a.cost) })).sort((a, b) => b.cost - a.cost);

  // Which customers/modules are abnormal -> highlight keys for the UI.
  const flaggedOrgs = [...new Set(alerts.filter((a) => a.orgId).map((a) => a.orgId))];
  const flaggedModules = alerts.filter((a) => a.level === "module").map((a) => a.orgId + "|" + a.module);

  return {
    range: { from, to, days: nDays },
    kpis,
    finops,
    series,
    customers,
    modules: [...modules.values()].map((m) => ({ ...m, cost: r4(m.cost) })).sort((a, b) => b.cost - a.cost),
    alerts,
    providers,
    services,
    egressGB: r4(egressGB),
    applications,
    unitEconomics,
    flaggedOrgs,
    flaggedModules,
    hasUsageData: customers.length > 0,
  };
}

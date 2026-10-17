// Pure maths for Super Admin -> Business Health (no Firebase, no I/O), so the
// API route, the page's what-if simulator and the tests all run the SAME
// calculations. Currency is INR. Revenue reuses snapshotMonthlyValue (what
// the customer actually agreed to pay, annual divided by 12) and
// isPayingCustomer (excludes trials, free licenses and suspended accounts);
// nothing here re-derives either.
//
// Data honesty rules:
//   - A figure that depends on data nobody has entered yet is null, never 0.
//   - Every figure carries a basis: "actual" | "estimate" | "assumption".
//   - Refundable deposits and funding are not expenses and never reach profit.

import { snapshotMonthlyValue } from "./pricingMath.js";
import { isPayingCustomer } from "./trial.js";

export const CATEGORIES = [
  { key: "employees", label: "Employees" },
  { key: "office", label: "Office" },
  { key: "infrastructure", label: "Infrastructure" },
  { key: "sales_marketing", label: "Sales & marketing" },
  { key: "other", label: "Other business expenses" },
];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export const CADENCES = [
  { key: "monthly", label: "Monthly", perMonth: 1 },
  { key: "quarterly", label: "Quarterly", perMonth: 1 / 3 },
  { key: "annual", label: "Annual", perMonth: 1 / 12 },
  { key: "oneoff", label: "One-off", perMonth: 0 },
];
export const CAPITAL_TYPES = ["investment", "deposit", "funding"];
export const PROVIDERS = ["vercel", "firebase", "other"];

export const DEFAULT_SETTINGS = {
  gstRate: 18, // percent
  gstInclusive: true, // customer prices include GST; MRR is reported ex-GST
  gatewayFeePct: null, // payment gateway fee as % of gross billing; null = not configured
  assumedArpa: null, // planning-only revenue per customer, used before any real paying customer
};

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r0 = (v) => Math.round(v);
const r2 = (v) => Math.round(v * 100) / 100;
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(s));
export const monthKey = (d) => String(d).slice(0, 7);
const monthStartOf = (m) => m + "-01";
const monthEndOf = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);

export function mergeSettings(stored) {
  const s = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  s.gstRate = Math.min(100, Math.max(0, n(s.gstRate)));
  s.gstInclusive = s.gstInclusive !== false;
  s.gatewayFeePct = s.gatewayFeePct === null || s.gatewayFeePct === "" || s.gatewayFeePct === undefined ? null : Math.max(0, n(s.gatewayFeePct));
  s.assumedArpa = s.assumedArpa === null || s.assumedArpa === "" || s.assumedArpa === undefined ? null : Math.max(0, n(s.assumedArpa));
  return s;
}

// ---- Validation -------------------------------------------------------------
// Each returns { ok, error } or { ok, value } with a cleaned record.
const label = (v) => String(v || "").trim().slice(0, 120);

export function validateExpense(b) {
  const lbl = label(b.label);
  if (!lbl) return { ok: false, error: "Give the expense a name." };
  if (!CATEGORY_KEYS.includes(b.category)) return { ok: false, error: "Choose a category." };
  if (!CADENCES.some((c) => c.key === b.cadence)) return { ok: false, error: "Choose how often it is paid." };
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Amount must be greater than zero." };
  if (amount > 1e9) return { ok: false, error: "Amount is unrealistically large." };
  if (!isDay(b.startDate)) return { ok: false, error: "Enter a valid start date." };
  if (b.endDate && (!isDay(b.endDate) || b.endDate < b.startDate)) return { ok: false, error: "End date must be on or after the start date." };
  const status = b.status === "planned" ? "planned" : "actual";
  const provider = b.category === "infrastructure" && PROVIDERS.includes(b.provider) ? b.provider : null;
  return { ok: true, value: { label: lbl, category: b.category, cadence: b.cadence, amount: r2(amount), startDate: b.startDate, endDate: b.endDate || null, status, provider, notes: String(b.notes || "").trim().slice(0, 500) } };
}

export function validateCapital(b) {
  const lbl = label(b.label);
  if (!lbl) return { ok: false, error: "Give the entry a name." };
  if (!CAPITAL_TYPES.includes(b.type)) return { ok: false, error: "Choose investment, deposit or funding." };
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Amount must be greater than zero." };
  if (!isDay(b.date)) return { ok: false, error: "Enter a valid date." };
  return { ok: true, value: { label: lbl, type: b.type, amount: r2(amount), date: b.date, notes: String(b.notes || "").trim().slice(0, 500) } };
}

export function validateCash(b) {
  const balance = Number(b.balance);
  if (b.balance === "" || b.balance === null || b.balance === undefined || !Number.isFinite(balance)) return { ok: false, error: "Enter the cash balance." };
  if (!isDay(b.date)) return { ok: false, error: "Enter a valid date." };
  if (b.date > new Date().toISOString().slice(0, 10)) return { ok: false, error: "A cash balance can't be dated in the future." };
  return { ok: true, value: { date: b.date, balance: r2(balance), notes: String(b.notes || "").trim().slice(0, 300) } };
}

export function validateSettings(b) {
  const out = {};
  const pct = (k, max) => {
    if (b[k] === null || b[k] === "" || b[k] === undefined) return { ok: true, v: null };
    const x = Number(b[k]);
    if (!Number.isFinite(x) || x < 0 || x > max) return { ok: false, error: `${k} must be between 0 and ${max}.` };
    return { ok: true, v: x };
  };
  for (const [k, max] of [["gstRate", 100], ["gatewayFeePct", 100], ["assumedArpa", 1e7]]) {
    const r = pct(k, max);
    if (!r.ok) return r;
    out[k] = r.v;
  }
  out.gstRate = out.gstRate ?? DEFAULT_SETTINGS.gstRate;
  out.gstInclusive = b.gstInclusive !== false;
  return { ok: true, value: out };
}

const SCENARIO_FIELDS = ["customerGrowthPct", "newCustomersPerMonth", "priceChangePct", "salaryChangePct", "infraUsageChangePct", "marketingChangePct"];
export function validateScenario(b) {
  const lbl = label(b.name);
  if (!lbl) return { ok: false, error: "Name the scenario." };
  const inputs = {};
  for (const k of SCENARIO_FIELDS) {
    const x = b.inputs?.[k] === "" || b.inputs?.[k] === undefined ? 0 : Number(b.inputs[k]);
    if (!Number.isFinite(x) || x < -100 || x > 10000) return { ok: false, error: `${k} is out of range (-100 to 10000).` };
    inputs[k] = x;
  }
  return { ok: true, value: { name: lbl, inputs } };
}

// ---- Revenue ----------------------------------------------------------------
// customers: [{ id, ...customer doc }]. One customers/{id} doc carries at most
// one subscription snapshot, so an organization is counted once. Annual is
// divided by 12 inside snapshotMonthlyValue; one-time fees are not part of
// the snapshot at all. Non-INR subscriptions are listed but not summed (there
// is no FX rate here) so they can never silently distort INR MRR.
export function computeRevenue(customers, settingsIn) {
  const settings = mergeSettings(settingsIn);
  const divisor = settings.gstInclusive ? 1 + settings.gstRate / 100 : 1;
  const lines = [];
  let skippedNonInr = 0;
  const counts = { trial: 0, free: 0, other: 0 };
  for (const c of customers) {
    if (!isPayingCustomer(c)) {
      if (c.billing === "complimentary") counts.free += 1;
      else if ((c.status || "trial") === "trial" || c.status === "trial_pending") counts.trial += 1;
      else counts.other += 1;
      continue;
    }
    const sub = c.subscription;
    if (!sub) { counts.other += 1; continue; }
    if ((sub.currency || "INR") !== "INR") { skippedNonInr += 1; continue; }
    const gross = snapshotMonthlyValue(sub);
    if (gross <= 0) continue;
    const appKeys = sub.planType === "APP" || sub.appKey ? [sub.appKey].filter(Boolean) : Array.isArray(sub.appKeys) ? sub.appKeys.filter(Boolean) : [];
    lines.push({
      orgId: c.id,
      orgName: c.organizationName || c.email || c.id,
      planCode: sub.planCode || c.planId || "",
      planName: sub.displayName || c.planName || sub.planCode || "",
      appKeys,
      billingCycle: sub.billingCycle === "year" ? "year" : "month",
      users: Math.max(1, n(sub.quantity) || 1),
      grossMonthly: gross,
      monthly: gross / divisor,
      since: sub.agreedAt || null,
    });
  }
  const mrr = lines.reduce((s, l) => s + l.monthly, 0);
  const grossBilling = lines.reduce((s, l) => s + l.grossMonthly, 0);
  const users = lines.reduce((s, l) => s + l.users, 0);

  // Product view: a single-app subscription belongs wholly to that app. A suite
  // is split equally across its apps (the last app takes the rounding
  // remainder), so product totals always reconcile to MRR exactly.
  const byProduct = new Map();
  const addTo = (key, amt, orgs, usersN) => {
    const p = byProduct.get(key) || { product: key, mrr: 0, orgs: 0, users: 0 };
    p.mrr += amt; p.orgs += orgs; p.users += usersN;
    byProduct.set(key, p);
  };
  for (const l of lines) {
    if (!l.appKeys.length) { addTo("unallocated", l.monthly, 1, l.users); continue; }
    const share = r2(l.monthly / l.appKeys.length);
    let left = l.monthly;
    l.appKeys.forEach((k, i) => {
      const amt = i === l.appKeys.length - 1 ? left : share;
      left -= amt;
      addTo(k, amt, 1, l.users);
    });
  }
  const products = [...byProduct.values()].map((p) => ({ ...p, mrr: r2(p.mrr) })).sort((a, b) => b.mrr - a.mrr);
  const reconciles = Math.abs(products.reduce((s, p) => s + p.mrr, 0) - mrr) < 0.05;

  return {
    mrr: r2(mrr), arr: r2(mrr * 12), grossBilling: r2(grossBilling), payingCount: lines.length, licensedUsers: users,
    arpa: lines.length ? r2(mrr / lines.length) : null,
    lines: lines.map((l) => ({ ...l, monthly: r2(l.monthly), grossMonthly: r2(l.grossMonthly) })),
    products, reconciles, counts, skippedNonInr,
    gstNote: settings.gstInclusive ? `Reported ex-GST (prices treated as including ${settings.gstRate}% GST).` : "Prices treated as GST-exclusive.",
  };
}

// ---- Expenses ---------------------------------------------------------------
// Does this expense apply in month `m` ("YYYY-MM")? Archived rows never do.
export function expenseInMonth(e, m, includePlanned) {
  if (e.archivedAt || e.archived) return false;
  if (e.status === "planned" && !includePlanned) return false;
  const start = monthKey(e.startDate), end = e.endDate ? monthKey(e.endDate) : null;
  if (m < start || (end && m > end)) return false;
  if (e.cadence === "oneoff") return m === start;
  if (e.cadence === "quarterly" || e.cadence === "annual") return true; // spread evenly, see monthlyAmount
  return true;
}
// Monthly cost of a recurring expense (annual/12, quarterly/3). One-offs are
// charged in full in their own month only.
export function monthlyAmount(e) {
  const c = CADENCES.find((x) => x.key === e.cadence);
  if (!c) return 0;
  return e.cadence === "oneoff" ? n(e.amount) : n(e.amount) * c.perMonth;
}

// The "run rate": recurring expenses only (one-offs excluded) for month m.
export function computeOpex(expenses, m, includePlanned = false) {
  const live = expenses.filter((e) => expenseInMonth(e, m, includePlanned));
  const byCategory = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, { total: 0, count: 0 }]));
  let oneOffs = 0;
  for (const e of live) {
    if (!byCategory[e.category]) continue;
    if (e.cadence === "oneoff") { oneOffs += n(e.amount); continue; }
    byCategory[e.category].total += monthlyAmount(e);
    byCategory[e.category].count += 1;
  }
  for (const k of CATEGORY_KEYS) byCategory[k].total = r2(byCategory[k].total);
  const configured = live.length > 0;
  return { configured, byCategory, recurring: r2(CATEGORY_KEYS.reduce((s, k) => s + byCategory[k].total, 0)), oneOffs: r2(oneOffs), lineCount: live.length };
}

// ---- Cloud ------------------------------------------------------------------
// days: costAnalyticsDaily docs for the month. The flat "hosting" estimate is
// dropped whenever the owner has entered an actual Vercel line, so the same
// spend is never counted twice (once estimated, once from the invoice).
export function computeCloud(days, expenses, m) {
  if (!days.length) return { configured: false, total: null, monthly: null, days: 0, basis: null, hostingExcluded: false };
  const vercelActual = expenses.some((e) => e.provider === "vercel" && e.status !== "planned" && expenseInMonth(e, m, false));
  let total = 0, estimatedDays = 0;
  for (const d of days) {
    total += n(d.totalCloudCost) - (vercelActual ? n(d.hostingCost) : 0);
    if (d.costSource !== "billing") estimatedDays += 1;
  }
  // `monthly` is the 30-day run rate (the window may be shorter than a month).
  return { configured: true, total: r2(total), monthly: r2((total / days.length) * 30), days: days.length, estimatedDays, basis: estimatedDays ? "estimate" : "actual", hostingExcluded: vercelActual };
}

// ---- Capital ----------------------------------------------------------------
export function computeCapital(items, cashSnapshots) {
  const live = items.filter((c) => !c.archivedAt);
  const sum = (f) => r2(live.filter(f).reduce((s, c) => s + n(c.amount), 0));
  const snaps = [...cashSnapshots].filter((c) => !c.archivedAt).sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = snaps[0] || null;
  const ageDays = latest ? Math.floor((Date.now() - Date.parse(latest.date)) / 864e5) : null;
  return {
    invested: sum((c) => c.type === "investment"),
    depositsHeld: sum((c) => c.type === "deposit" && !c.refundedOn),
    depositsRefunded: sum((c) => c.type === "deposit" && c.refundedOn),
    funding: sum((c) => c.type === "funding"),
    cash: latest ? { balance: n(latest.balance), date: latest.date, ageDays, stale: ageDays > 35 } : null,
  };
}

// ---- Headline summary -------------------------------------------------------
// revenue = computeRevenue(); opex = computeOpex(); cloud = computeCloud().
// Variable cost per customer = gateway fee + the cloud spend divided by paying
// customers. Break-even uses ONLY real ARPA when there is a paying customer,
// otherwise the owner's assumption, and says which.
export function computeSummary({ revenue, opex, cloud, capital, settings: sIn, newPayingLast90, snapshotMonthSalesMarketing }) {
  const settings = mergeSettings(sIn);
  // Cloud alone is not the full cost base: until operating expenses exist, total cost and profit stay unknown.
  const costKnown = opex.configured;
  const cloudCost = cloud.configured ? cloud.monthly : 0;
  const totalCost = costKnown ? r2(opex.recurring + cloudCost) : null;
  const profit = totalCost === null ? null : r2(revenue.mrr - totalCost);
  const payers = revenue.payingCount;
  const gatewayPerCust = settings.gatewayFeePct !== null && revenue.arpa !== null ? r2((revenue.grossBilling / Math.max(1, payers)) * (settings.gatewayFeePct / 100)) : null;
  const cloudPerCust = cloud.configured && payers ? r2(cloudCost / payers) : null;
  const arpa = revenue.arpa !== null ? revenue.arpa : settings.assumedArpa;
  const arpaBasis = revenue.arpa !== null ? "actual" : settings.assumedArpa !== null ? "assumption" : null;
  const variablePerCust = (cloudPerCust || 0) + (gatewayPerCust || 0);
  const contributionPerCust = arpa === null ? null : r2(arpa - variablePerCust);
  const contributionMargin = contributionPerCust !== null && arpa > 0 ? r2((contributionPerCust / arpa) * 100) : null;

  // Fixed cost to cover = recurring opex (cloud usage is treated as variable per customer once customers exist).
  const fixed = opex.configured ? opex.recurring : null;
  const fixedWithCloud = costKnown ? (payers ? opex.recurring : opex.recurring + cloudCost) : null;
  let breakevenCustomers = null;
  if (fixedWithCloud !== null && contributionPerCust !== null && contributionPerCust > 0) breakevenCustomers = Math.ceil(fixedWithCloud / contributionPerCust);

  const burn = profit === null ? null : r2(Math.max(0, -profit));
  const cash = capital.cash;
  let runwayMonths = null, runwayState = "unknown";
  if (cash && profit !== null) {
    if (profit >= 0) runwayState = "profitable";
    else if (cash.balance <= 0) { runwayMonths = 0; runwayState = "finite"; }
    else { runwayMonths = r2(cash.balance / burn); runwayState = "finite"; }
  }

  const cac = n(snapshotMonthSalesMarketing) > 0 && newPayingLast90 > 0 ? r0((snapshotMonthSalesMarketing * 3) / newPayingLast90) : null;

  return {
    mrr: revenue.mrr, arr: revenue.arr, payingCount: payers, arpa, arpaBasis,
    totalMonthlyCost: totalCost, costBasis: cloud.configured && cloud.basis === "estimate" ? "estimate" : "actual",
    monthlyProfit: profit, burn,
    contributionPerCustomer: contributionPerCust, contributionMarginPct: contributionMargin,
    variablePerCustomer: payers || arpaBasis ? r2(variablePerCust) : null, gatewayConfigured: settings.gatewayFeePct !== null,
    breakevenCustomers, customersShort: breakevenCustomers === null ? null : Math.max(0, breakevenCustomers - payers),
    cash, runwayMonths, runwayState, cac, newPayingLast90, fixed,
    cloudPerCustomer: cloudPerCust,
  };
}

// ---- What-if simulation -----------------------------------------------------
// Projects 12 months from a base that comes from computeSummary/computeOpex.
// Everything here is a FORECAST built on stated assumptions. Cloud cost scales
// with customers and with the infra-usage change; salaries, marketing and
// pricing apply their % change; gateway fees follow gross billing.
export function runScenario(base, inputs = {}, months = 12) {
  const g = n(inputs.customerGrowthPct) / 100;
  const add = n(inputs.newCustomersPerMonth);
  const price = 1 + n(inputs.priceChangePct) / 100;
  const sal = 1 + n(inputs.salaryChangePct) / 100;
  const infra = 1 + n(inputs.infraUsageChangePct) / 100;
  const mkt = 1 + n(inputs.marketingChangePct) / 100;
  const arpa = n(base.arpa) * price;
  const c0 = n(base.payingCount);
  const gwPct = n(base.gatewayFeePct) / 100;
  const cloud0 = n(base.cloud);
  const cloudPerCust = c0 > 0 ? cloud0 / c0 : 0;
  const fixedOther = n(base.office) + n(base.other) + (c0 > 0 ? n(base.infrastructure) : n(base.infrastructure));
  const rows = [];
  let customers = c0, cash = base.cash == null ? null : n(base.cash);
  let breakevenMonth = null, runOutMonth = null;
  for (let t = 1; t <= months; t++) {
    customers = customers * (1 + g) + add;
    const revenue = customers * arpa;
    const cloud = c0 > 0 ? cloudPerCust * customers * infra : cloud0 * infra;
    const cost = n(base.employees) * sal + fixedOther + n(base.salesMarketing) * mkt + cloud + revenue * gwPct;
    const profit = revenue - cost;
    if (cash !== null) cash += profit;
    if (breakevenMonth === null && profit >= 0) breakevenMonth = t;
    if (cash !== null && runOutMonth === null && cash < 0) runOutMonth = t;
    rows.push({ month: t, customers: r2(customers), revenue: r0(revenue), cost: r0(cost), profit: r0(profit), cash: cash === null ? null : r0(cash) });
  }
  // Break-even customer count under the scenario's own unit economics.
  const varPer = cloudPerCust * infra + arpa * gwPct;
  const contrib = arpa - varPer;
  const fixedScn = n(base.employees) * sal + fixedOther + n(base.salesMarketing) * mkt + (c0 > 0 ? 0 : cloud0 * infra);
  const breakevenCustomers = contrib > 0 ? Math.ceil(fixedScn / contrib) : null;
  return { rows, breakevenMonth, runOutMonth, breakevenCustomers, contributionPerCustomer: r2(contrib), endCash: rows.length ? rows[rows.length - 1].cash : null, endProfit: rows.length ? rows[rows.length - 1].profit : null };
}

// Builds runScenario's `base` from the computed pieces (one place, so the
// server's saved scenarios and the page's live sliders start identically).
export function scenarioBase({ summary, opex, cloud, settings: sIn }) {
  const settings = mergeSettings(sIn);
  return {
    arpa: summary.arpa || 0, payingCount: summary.payingCount,
    gatewayFeePct: settings.gatewayFeePct || 0,
    employees: opex.byCategory.employees.total, office: opex.byCategory.office.total,
    infrastructure: opex.byCategory.infrastructure.total, salesMarketing: opex.byCategory.sales_marketing.total, other: opex.byCategory.other.total,
    cloud: cloud.configured ? cloud.monthly : 0, cash: summary.cash ? summary.cash.balance : null,
  };
}

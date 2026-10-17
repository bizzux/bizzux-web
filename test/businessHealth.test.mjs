// Pure-logic tests for lib/businessHealth.js. No emulator needed:
//   npx tsx --test test/businessHealth.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRevenue, computeOpex, computeCloud, computeCapital, computeSummary, runScenario, scenarioBase,
  validateExpense, validateCapital, validateCash, validateScenario, validateSettings, monthlyAmount,
} from "../lib/businessHealth.js";

const paying = (id, sub, extra = {}) => ({ id, status: "active", planId: sub.planCode, organizationName: "Org " + id, subscription: { currency: "INR", ...sub }, ...extra });
const NOGST = { gstInclusive: false };

test("MRR: monthly + annual/12, free/trial/suspended excluded, GST stripped", () => {
  const customers = [
    paying("a", { planCode: "APP", planType: "APP", appKey: "crm", billingCycle: "month", quantity: 2, unitPrice: 500, totalPrice: 1000 }),
    paying("b", { planCode: "SUITE", planType: "SUITE", appKeys: ["crm", "shop"], billingCycle: "year", quantity: 1, unitPrice: 12000, totalPrice: 12000 }),
    paying("c", { planCode: "APP", billingCycle: "month", quantity: 1, totalPrice: 999 }, { billing: "complimentary" }),
    { id: "d", status: "trial", subscription: { totalPrice: 5000, billingCycle: "month" } },
    paying("e", { planCode: "APP", billingCycle: "month", quantity: 1, totalPrice: 700 }, { status: "suspended" }),
  ];
  const r = computeRevenue(customers, NOGST);
  assert.equal(r.mrr, 2000); // 1000 + 12000/12
  assert.equal(r.payingCount, 2);
  assert.equal(r.licensedUsers, 3);
  assert.equal(r.counts.free, 1);
  assert.equal(r.counts.trial, 1);
  const gst = computeRevenue(customers, { gstInclusive: true, gstRate: 18 });
  assert.equal(gst.mrr, Math.round((2000 / 1.18) * 100) / 100);
});

test("product revenue reconciles to MRR (suite split equally, no double count)", () => {
  const customers = [
    paying("a", { planCode: "S", appKeys: ["crm", "shop", "notes"], billingCycle: "month", quantity: 1, totalPrice: 100 }),
    paying("b", { planCode: "A", planType: "APP", appKey: "crm", billingCycle: "month", quantity: 1, totalPrice: 50 }),
  ];
  const r = computeRevenue(customers, NOGST);
  assert.equal(r.mrr, 150);
  assert.ok(r.reconciles);
  assert.equal(r.products.reduce((s, p) => s + p.mrr, 0), 150);
  assert.equal(r.products.find((p) => p.product === "crm").mrr, 33.33 + 50);
});

test("non-INR subscriptions are skipped, not mixed into INR MRR", () => {
  const r = computeRevenue([paying("a", { planCode: "A", currency: "USD", billingCycle: "month", quantity: 1, totalPrice: 10 })], NOGST);
  assert.equal(r.mrr, 0);
  assert.equal(r.skippedNonInr, 1);
});

test("no expenses configured -> cost and profit are null, never 0", () => {
  const revenue = computeRevenue([], NOGST);
  const opex = computeOpex([], "2026-10");
  const cloud = computeCloud([], [], "2026-10");
  const s = computeSummary({ revenue, opex, cloud, capital: computeCapital([], []), settings: {} });
  assert.equal(opex.configured, false);
  assert.equal(s.totalMonthlyCost, null);
  assert.equal(s.monthlyProfit, null);
  assert.equal(s.breakevenCustomers, null);
  assert.equal(s.runwayState, "unknown");
});

test("cloud data alone does not produce a cost total or profit", () => {
  const cloud = computeCloud(Array.from({ length: 30 }, () => ({ totalCloudCost: 40, hostingCost: 0, costSource: "billing" })), [], "2026-10");
  const s = computeSummary({ revenue: computeRevenue([], NOGST), opex: computeOpex([], "2026-10"), cloud, capital: computeCapital([], []), settings: {} });
  assert.equal(s.totalMonthlyCost, null);
  assert.equal(s.monthlyProfit, null);
  assert.equal(s.breakevenCustomers, null);
});

test("expense cadences normalise to monthly; one-offs only hit their month; planned excluded from actuals", () => {
  const ex = [
    { category: "employees", cadence: "monthly", amount: 50000, startDate: "2026-01-01", status: "actual" },
    { category: "infrastructure", cadence: "annual", amount: 12000, startDate: "2026-01-01", status: "actual" },
    { category: "office", cadence: "oneoff", amount: 9000, startDate: "2026-10-05", status: "actual" },
    { category: "sales_marketing", cadence: "monthly", amount: 20000, startDate: "2026-11-01", status: "planned" },
    { category: "other", cadence: "monthly", amount: 100, startDate: "2026-01-01", endDate: "2026-06-30", status: "actual" },
  ];
  const o = computeOpex(ex, "2026-10");
  assert.equal(o.recurring, 51000);
  assert.equal(o.oneOffs, 9000);
  assert.equal(o.byCategory.sales_marketing.total, 0);
  assert.equal(computeOpex(ex, "2026-11", true).byCategory.sales_marketing.total, 20000);
  assert.equal(monthlyAmount(ex[1]), 1000);
});

test("deposits and funding never reach expenses or profit; refunds tracked", () => {
  const cap = computeCapital([
    { type: "investment", amount: 80000 },
    { type: "deposit", amount: 50000 },
    { type: "deposit", amount: 20000, refundedOn: "2026-09-01" },
    { type: "funding", amount: 1000000 },
  ], [{ date: "2026-10-01", balance: 900000 }, { date: "2026-08-01", balance: 1 }]);
  assert.equal(cap.invested, 80000);
  assert.equal(cap.depositsHeld, 50000);
  assert.equal(cap.depositsRefunded, 20000);
  assert.equal(cap.funding, 1000000);
  assert.equal(cap.cash.balance, 900000);
});

test("cloud: estimate vs billed, and hosting estimate dropped once an actual Vercel line exists", () => {
  const days = [{ totalCloudCost: 100, hostingCost: 30, costSource: "estimate" }, { totalCloudCost: 100, hostingCost: 30, costSource: "billing" }];
  assert.equal(computeCloud(days, [], "2026-10").total, 200);
  assert.equal(computeCloud(days, [], "2026-10").basis, "estimate");
  const vercel = [{ category: "infrastructure", provider: "vercel", cadence: "monthly", amount: 1700, startDate: "2026-01-01", status: "actual" }];
  const c = computeCloud(days, vercel, "2026-10");
  assert.equal(c.total, 140);
  assert.ok(c.hostingExcluded);
});

test("summary: profit, break-even, runway, contribution margin", () => {
  const revenue = computeRevenue([
    paying("a", { planCode: "A", appKey: "crm", billingCycle: "month", quantity: 1, totalPrice: 1000 }),
    paying("b", { planCode: "A", appKey: "crm", billingCycle: "month", quantity: 1, totalPrice: 1000 }),
  ], NOGST);
  const opex = computeOpex([{ category: "employees", cadence: "monthly", amount: 10000, startDate: "2026-01-01", status: "actual" }], "2026-10");
  const cloud = computeCloud(Array.from({ length: 30 }, () => ({ totalCloudCost: 10, hostingCost: 0, costSource: "billing" })), [], "2026-10"); // 300/month
  const capital = computeCapital([], [{ date: new Date().toISOString().slice(0, 10), balance: 80000 }]);
  const s = computeSummary({ revenue, opex, cloud, capital, settings: { gatewayFeePct: 2 }, newPayingLast90: 2, snapshotMonthSalesMarketing: 0 });
  assert.equal(s.totalMonthlyCost, 10300);
  assert.equal(s.monthlyProfit, 2000 - 10300);
  assert.equal(s.contributionPerCustomer, 1000 - 150 - 20); // cloud 150/cust, gateway 2%
  assert.equal(s.breakevenCustomers, Math.ceil(10000 / 830));
  assert.equal(s.customersShort, s.breakevenCustomers - 2);
  assert.equal(s.runwayMonths, Math.round((80000 / 8300) * 100) / 100);
  assert.equal(s.cac, null); // no sales & marketing spend entered: CAC is unknown, not 0
  const withSpend = computeSummary({ revenue, opex, cloud, capital, settings: {}, newPayingLast90: 3, snapshotMonthSalesMarketing: 3000 });
  assert.equal(withSpend.cac, 3000); // (3000 x 3 months) / 3 new customers
});

test("assumed ARPA is labelled when there are no paying customers", () => {
  const opex = computeOpex([{ category: "employees", cadence: "monthly", amount: 9000, startDate: "2026-01-01", status: "actual" }], "2026-10");
  const s = computeSummary({ revenue: computeRevenue([], NOGST), opex, cloud: computeCloud([], [], "2026-10"), capital: computeCapital([], []), settings: { assumedArpa: 1000 } });
  assert.equal(s.arpaBasis, "assumption");
  assert.equal(s.breakevenCustomers, 9);
});

test("what-if: price up and salaries down improve profit; growth reaches break-even", () => {
  const base = { arpa: 1000, payingCount: 5, gatewayFeePct: 0, employees: 20000, office: 0, infrastructure: 0, salesMarketing: 0, other: 0, cloud: 0, cash: 100000 };
  const flat = runScenario(base, {});
  const better = runScenario(base, { priceChangePct: 20, salaryChangePct: -10 });
  assert.ok(better.endProfit > flat.endProfit);
  const grow = runScenario(base, { newCustomersPerMonth: 5 });
  assert.ok(grow.breakevenMonth !== null && grow.breakevenMonth <= 3);
  assert.equal(flat.breakevenMonth, null);
  assert.equal(flat.breakevenCustomers, 20);
});

test("scenarioBase wires summary/opex/cloud into the simulator", () => {
  const opex = computeOpex([{ category: "employees", cadence: "monthly", amount: 100, startDate: "2026-01-01", status: "actual" }], "2026-10");
  const summary = { arpa: 50, payingCount: 2, cash: { balance: 10 } };
  const b = scenarioBase({ summary, opex, cloud: { configured: false }, settings: {} });
  assert.equal(b.employees, 100);
  assert.equal(b.cash, 10);
});

test("validation rejects bad input with a clear message", () => {
  assert.match(validateExpense({ label: "", category: "other", cadence: "monthly", amount: 1, startDate: "2026-01-01" }).error, /name/);
  assert.match(validateExpense({ label: "x", category: "bogus", cadence: "monthly", amount: 1, startDate: "2026-01-01" }).error, /category/);
  assert.match(validateExpense({ label: "x", category: "other", cadence: "monthly", amount: -5, startDate: "2026-01-01" }).error, /greater than zero/);
  assert.match(validateExpense({ label: "x", category: "other", cadence: "monthly", amount: 5, startDate: "2026-02-01", endDate: "2026-01-01" }).error, /End date/);
  assert.ok(validateExpense({ label: "x", category: "infrastructure", provider: "vercel", cadence: "monthly", amount: 5, startDate: "2026-02-01" }).ok);
  assert.match(validateCapital({ label: "x", type: "loan", amount: 1, date: "2026-01-01" }).error, /investment/);
  assert.match(validateCash({ balance: "", date: "2026-01-01" }).error, /balance/);
  assert.match(validateCash({ balance: 5, date: "2999-01-01" }).error, /future/);
  assert.match(validateScenario({ name: "s", inputs: { priceChangePct: -500 } }).error, /range/);
  assert.match(validateSettings({ gstRate: 500 }).error, /gstRate/);
});

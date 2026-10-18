// Pure tests for lib/attendanceAnalytics.js — node --test test/attendanceAnalytics.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROPOSED_BOOK } from "../lib/attendancePricing.js";
import { analyse } from "../lib/attendanceAnalytics.js";

const TODAY = "2026-10-18";
const base = { book: PROPOSED_BOOK, today: TODAY };
const subs = [
  { organizationId: "a", status: "active", cycle: "month", billedCounts: { manager: 40, self: 10 } },
  { organizationId: "b", status: "trial", cycle: "month", billedCounts: { self: 5 }, trialEnds: "2026-10-21" },
  { organizationId: "c", status: "past_due", cycle: "month", billedCounts: { verified: 20 }, adjustments: [{ amount: 120, invoiced: false }, { amount: 50, invoiced: true }] },
  { organizationId: "d", status: "cancelled", cycle: "month", billedCounts: { self: 99 } },
];

test("counts by status and only paying organisations earn", () => {
  const r = analyse({ ...base, subs });
  assert.deepEqual([r.byStatus.active, r.byStatus.trial, r.byStatus.past_due, r.byStatus.cancelled], [1, 1, 1, 1]);
  const paying = r.top.filter((o) => o.monthly > 0).map((o) => o.id).sort();
  assert.deepEqual(paying, ["a", "c"]);
  assert.equal(r.top.find((o) => o.id === "b").monthly, 0);
  assert.equal(r.top.find((o) => o.id === "d").monthly, 0);
  assert.equal(r.arr, Math.round(r.mrr * 12 * 100) / 100);
});

test("licences sold versus used, over-use and idle seats", () => {
  const r = analyse({ ...base, subs, usage: { a: { counts: { manager: 40, self: 14 } }, c: { counts: { verified: 12 } } } });
  assert.equal(r.mix.manager.sold, 40);
  assert.equal(r.mix.self.used, 14);
  assert.deepEqual(r.overUse.map((x) => [x.id, x.mode, x.gap]), [["a", "self", 4]]); // 14 on Self but only 10 billed
  assert.deepEqual(r.idle.map((x) => [x.id, x.mode, x.gap]), [["c", "verified", 8]]); // 20 billed, 12 in use; cancelled and unmetered orgs are skipped
});

test("unpaid adjustments, failed payments, expiring trials", () => {
  const r = analyse({ ...base, subs });
  assert.equal(r.unpaidAdjustments, 120);
  assert.deepEqual(r.failedPayments.map((f) => f.id), ["c"]);
  assert.deepEqual(r.expiringTrials, [{ id: "b", trialEnds: "2026-10-21", daysLeft: 3 }]);
});

test("a trial far from ending is not flagged", () => {
  const r = analyse({ ...base, subs: [{ organizationId: "z", status: "trial", billedCounts: {}, trialEnds: "2026-12-01" }] });
  assert.deepEqual(r.expiringTrials, []);
});

test("discount exposure comes from contracts", () => {
  const plain = analyse({ ...base, subs: [subs[0]] });
  const deal = analyse({ ...base, subs: [subs[0]], contracts: { a: { fixedDiscountPct: 30 } } });
  assert.ok(deal.discountExposure.monthly > plain.discountExposure.monthly);
  assert.ok(deal.mrr < plain.mrr);
});

test("margin is unknown until unit costs are entered, known after", () => {
  const unknown = analyse({ ...base, subs });
  assert.equal(unknown.margin.costsKnown, false);
  assert.equal(unknown.margin.marginPct, null);
  const known = analyse({ ...base, subs, costModel: { supportPerOrg: 500, infraPerOrg: 100 } });
  assert.equal(known.margin.costsKnown, true);
  assert.ok(known.margin.cost > 0);
});

test("no published book: nothing is invented", () => {
  const r = analyse({ subs, today: TODAY, book: null });
  assert.equal(r.mrr, 0);
  assert.equal(r.activeWithoutBook, 2);
});

test("empty platform", () => {
  const r = analyse({ ...base, subs: [] });
  assert.equal(r.orgs, 0);
  assert.equal(r.mrr, 0);
  assert.equal(r.discountExposure.pctOfList, null);
});

// Pure tests for lib/attendancePricing.js — no emulator needed:  node --test test/attendancePricing.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROPOSED_BOOK, normalizeBook, validateBook, adviceFor, canEdit, approvalProblem, submitProblem, bookInForce, billableCounts, tierFor, thresholdImpact,
  lockTier, quote, previewChange, impactOf, marginFor, normalizeCostModel, cliffReport, graduatedPct,
} from "../lib/attendancePricing.js";

const BOOK = { ...PROPOSED_BOOK, faceGps: { enabled: true, price: 25, allowancePerEmployee: 20, overagePerCheck: 1 } };
const q = (counts, extra = {}, book = BOOK, contract = null) => quote(book, { counts, ...extra }, contract);

test("the brief's numbers are stored as a valid DRAFT, with Face + GPS switched off", () => {
  assert.deepEqual(validateBook(PROPOSED_BOOK), []);
  const b = normalizeBook(PROPOSED_BOOK);
  assert.deepEqual([b.baseFee, b.modePrices.manager, b.modePrices.self, b.modePrices.verified, b.modePrices.smart_geofence, b.faceGps.price], [199, 5, 15, 30, 60, 25]);
  assert.equal(b.faceGps.enabled, false);
  assert.deepEqual(b.volumeTiers.map((t) => [t.min, t.pct]), [[1, 0], [50, 5], [100, 10], [250, 15], [500, 20]]);
  assert.equal(b.volumeTiers[4].requiresApproval, true);
  assert.equal(b.stackDiscounts, false);
});

test("quote: itemised, base fee plus per-mode lines, discount on employee fees only", () => {
  const r = q({ manager: 40, self: 10 }); // 50 people → 5%
  assert.deepEqual(r.lines.map((l) => [l.key, l.qty, l.amount]), [["base", 1, 199], ["manager", 40, 200], ["self", 10, 150]]);
  assert.equal(r.subtotal, 549);
  assert.deepEqual([r.discount.type, r.discount.pct, r.discount.amount], ["volume", 5, 17.5]); // 5% of 350, not of the base fee
  assert.equal(r.monthly, 531.5);
  assert.equal(r.total, 531.5);
});

test("annual billing: the greater of volume and annual discount applies, never both", () => {
  const r = q({ manager: 40, self: 10 }, { cycle: "year" });
  assert.deepEqual([r.discount.type, r.discount.pct, r.discount.volumePct, r.discount.annualPct], ["annual", 10, 5, 10]);
  assert.equal(r.monthly, 514); // 199 + 350 × 0.9
  assert.equal(r.total, 6168);  // twelve months
  const big = q({ manager: 40, self: 30, verified: 20, smart_geofence: 10 }, { cycle: "year" }); // 100 people: volume 10 = annual 10
  assert.deepEqual([big.discount.pct, big.discount.type], [10, "volume"]);
  assert.equal(big.subtotal, 2049); assert.equal(big.discount.amount, 185); assert.equal(big.monthly, 1864); // 10% off, not 19%
  const bigger = q({ manager: 120 }, { cycle: "year" }); // 120 people: volume 10 = annual 10
  assert.equal(bigger.discount.pct, 10);
  const huge = q({ manager: 260 }, { cycle: "year" }); // 260 people: volume 15 beats annual 10
  assert.deepEqual([huge.discount.pct, huge.discount.type], [15, "volume"]);
});

test("a contract may stack or fix a discount explicitly — that is the only way discounts combine", () => {
  const stacked = q({ manager: 120 }, { cycle: "year" }, BOOK, { stackDiscounts: true });
  assert.deepEqual([stacked.discount.pct, stacked.discount.type], [19, "volume+annual"]);
  const fixed = q({ manager: 40, self: 10 }, {}, BOOK, { fixedDiscountPct: 12 });
  assert.deepEqual([fixed.discount.type, fixed.discount.pct, fixed.discount.amount], ["contract", 12, 42]);
});

test("the 500+ tier needs approval; until then the next tier applies and the quote says so", () => {
  const r = q({ manager: 500 });
  assert.equal(r.needsApproval.pct, 20);
  assert.equal(r.discount.pct, 15);
  assert.match(r.needsApproval.reason, /needs approval/);
  const ok = q({ manager: 500 }, {}, BOOK, { approvedTiers: [500] });
  assert.deepEqual([ok.discount.pct, ok.needsApproval], [20, null]);
});

test("minimum monthly fee is a floor after discounts", () => {
  const book = { ...BOOK, minimumMonthlyFee: 500 };
  const r = q({ manager: 3 }, {}, book); // 199 + 15 = 214
  assert.deepEqual([r.monthly, r.minimum.applied], [500, true]);
  const rich = q({ manager: 300 }, {}, book);
  assert.equal(rich.minimum.applied, false);
  assert.equal(q({ manager: 3 }, { cycle: "year" }, book).total, 6000); // 12 × 500
});

test("Face + GPS: only on Verified / Smart Geofence people, never alone, off until the book enables it", () => {
  const r = q({ self: 10, verified: 20, smart_geofence: 10 }, { faceGpsCount: 25 });
  const f = r.lines.find((l) => l.key === "face_gps");
  assert.deepEqual([f.qty, f.unit, f.amount], [25, 25, 625]);
  const capped = q({ self: 10, verified: 3 }, { faceGpsCount: 9 });
  assert.equal(capped.faceGpsCount, 3);
  assert.match(capped.notes[0], /only 3 eligible/);
  const off = q({ verified: 5 }, { faceGpsCount: 5 }, PROPOSED_BOOK);
  assert.deepEqual([off.faceGpsCount, off.lines.some((l) => l.key === "face_gps"), off.notes[0]], [0, false, "Face + GPS isn't available yet."]);
  assert.equal(q({ self: 10 }, { faceGpsCount: 5 }).faceGpsCount, 0); // Self has no location check to pair with
});

test("customer-specific rates and price-lock of the volume tier", () => {
  const rate = q({ manager: 10 }, {}, BOOK, { baseFee: 99, modePrices: { manager: 4 } });
  assert.deepEqual([rate.lines[0].amount, rate.lines[1].unit, rate.monthly], [99, 4, 139]);
  const lock = lockTier(BOOK, 60, "2026-10-01");
  assert.deepEqual([lock.pct, lock.until], [5, "2027-10-01"]);
  // headcount drops to 40 mid-term: the locked 5% still applies; after the term it does not
  assert.equal(q({ manager: 40 }, { date: "2027-03-01" }, BOOK, { tierLock: { pct: 5, until: "2027-10-01" } }).discount.pct, 5);
  assert.equal(q({ manager: 40 }, { date: "2027-03-01" }, BOOK, { tierLock: { pct: 5, until: "2027-10-01" } }).discount.locked, true);
  assert.equal(q({ manager: 40 }, { date: "2027-11-01" }, BOOK, { tierLock: { pct: 5, until: "2027-10-01" } }).discount.pct, 0);
});

test("a blank contract field means \"use the book's value\", never zero", () => {
  const blank = { baseFee: null, minimumMonthlyFee: null, faceGpsPrice: "", modePrices: { manager: null, self: undefined } };
  const r = q({ manager: 40, self: 8 }, {}, BOOK, blank);
  assert.equal(r.monthly, 519); // 199 + 40×5 + 8×15, exactly the published book
  assert.equal(q({ manager: 3 }, {}, { ...BOOK, minimumMonthlyFee: 500 }, blank).monthly, 500);
  assert.equal(q({ verified: 4 }, { faceGpsCount: 4 }, BOOK, blank).lines.find((l) => l.key === "face_gps").unit, 25);
  assert.equal(q({ manager: 10 }, {}, BOOK, { baseFee: 0 }).lines.some((l) => l.key === "base"), false); // an explicit 0 IS honoured
});

test("tiers and threshold preview", () => {
  assert.deepEqual([1, 49, 50, 99, 100, 249, 250, 499, 500, 5000].map((n) => tierFor(BOOK, n).pct), [0, 0, 5, 5, 10, 10, 15, 15, 20, 20]);
  const t = thresholdImpact(BOOK, 48);
  assert.deepEqual([t.current.pct, t.next.min, t.next.employeesToGo, t.previous], [0, 50, 2, null]);
  assert.equal(thresholdImpact(BOOK, 60).previous.min, 1);
  const p = previewChange(BOOK, { counts: { manager: 49 } }, { counts: { manager: 50 } });
  assert.equal(p.tierChanged, true);
  // whole-bill tiers (the brief's wording): the 50th person makes the bill go DOWN — the preview must say so
  assert.deepEqual([p.deltaMonthly, p.cliff], [-7.5, true]);
  const g = previewChange({ ...BOOK, tierMode: "graduated" }, { counts: { manager: 49 } }, { counts: { manager: 50 } });
  assert.deepEqual([g.cliff, g.deltaMonthly > 0], [false, true]);
});

test("cliffs are listed per threshold; graduated tiers remove them and never let the bill fall as people are added", () => {
  const cliffs = cliffReport(BOOK);
  assert.deepEqual(cliffs.map((c) => c.min), [50, 100, 250, 500]);
  assert.ok(cliffs.every((c) => c.drop > 0)); // every threshold makes the bill fall with whole-bill tiers
  assert.ok(adviceFor(BOOK).some((m) => /pays LESS after crossing/.test(m)));
  const G = { ...BOOK, tierMode: "graduated" };
  assert.ok(cliffReport(G).every((c) => c.drop <= 0));
  assert.ok(!adviceFor(G).some((m) => /pays LESS/.test(m)));
  let last = 0;
  for (let n = 1; n <= 700; n++) { const t = quote(G, { counts: { self: n } }, { approvedTiers: [500] }).monthly; assert.ok(t >= last, `bill fell at ${n} people`); last = t; }
  // weighted example: 60 people = 49 at 0% + 11 at 5%
  assert.equal(graduatedPct(G, 60), 0.92);
  const r = quote(G, { counts: { manager: 60 } });
  assert.equal(r.discount.pct, 0.92);
  assert.equal(quote(G, { counts: { manager: 40 } }).discount.pct, 0);
});

test("billing basis: assigned vs purchased, never mixed", () => {
  const assigned = { manager: 40, self: 35, verified: 20 };
  assert.deepEqual(billableCounts("assigned", assigned, { self: 30 }).counts, { manager: 40, self: 35, verified: 20, smart_geofence: 0 });
  const p = billableCounts("purchased", assigned, { manager: 40, self: 30, verified: 25 });
  assert.deepEqual(p.counts, { manager: 40, self: 30, verified: 25, smart_geofence: 0 });
  assert.deepEqual(p.shortfall, { self: 5 }); // 5 more people on Self than licences bought
});

test("validation: bad books are refused with plain messages", () => {
  const bad = (o) => validateBook({ ...PROPOSED_BOOK, ...o });
  assert.match(bad({ volumeTiers: [] })[0], /at least one volume tier/);
  assert.match(bad({ volumeTiers: [{ min: 10, pct: 0 }] })[0], /start at 1/);
  assert.match(bad({ volumeTiers: [{ min: 1, pct: 5 }] })[0], /no discount/);
  assert.ok(bad({ volumeTiers: [{ min: 1, pct: 0 }, { min: 50, pct: 10 }, { min: 100, pct: 5 }] }).some((m) => /smaller discount/.test(m)));
  assert.ok(bad({ volumeTiers: [{ min: 1, pct: 0 }, { min: 50, pct: 5 }, { min: 50, pct: 6 }] }).some((m) => /Two volume tiers/.test(m)));
  assert.ok(bad({ modePrices: { manager: -1, self: 15, verified: 30, smart_geofence: 60 } }).some((m) => /Manager Attendance/.test(m)));
  assert.ok(bad({ annualDiscountPct: 150 }).some((m) => /between 0% and 100%/.test(m)));
  assert.ok(adviceFor({ ...PROPOSED_BOOK, modePrices: { manager: 50, self: 15, verified: 30, smart_geofence: 60 } })[0].match(/rise with the capability/));
  assert.ok(adviceFor({ ...PROPOSED_BOOK, faceGps: { enabled: true, price: 25 } }).some((m) => /uncapped/.test(m)));
});

test("lifecycle: only drafts edit; a different person must approve; the version in force follows effective dates and pins", () => {
  assert.equal(canEdit({ status: "draft" }), true);
  assert.equal(canEdit({ status: "published" }), false);
  const pending = { status: "pending_approval", createdBy: "alice", lastEditedBy: "bob", submittedBy: "bob", editors: ["alice", "bob"] };
  for (const who of ["alice", "bob"]) assert.match(approvalProblem(pending, who), /different person/);
  assert.equal(approvalProblem(pending, "carol"), "");
  assert.match(approvalProblem({ ...pending, status: "draft" }, "carol"), /waiting for approval/);
  assert.equal(submitProblem({ status: "draft" }, [], "2026-11-01", "2026-10-20"), "");
  assert.match(submitProblem({ status: "draft" }, [], "2026-10-01", "2026-10-20"), /past/);
  assert.match(submitProblem({ status: "draft" }, ["Add at least one volume tier"], "2026-11-01", "2026-10-20"), /volume tier/);
  assert.match(submitProblem({ status: "published" }, [], "2026-11-01", "2026-10-20"), /Only a draft/);
  const books = [
    { id: "v1", version: 1, status: "retired", effectiveFrom: "2026-01-01", approvedAt: "x" },
    { id: "v2", version: 2, status: "published", effectiveFrom: "2026-06-01", approvedAt: "x" },
    { id: "v3", version: 3, status: "scheduled", effectiveFrom: "2027-01-01", approvedAt: "x" },
    { id: "d4", version: 4, status: "draft", effectiveFrom: "2026-01-01" },
  ];
  assert.equal(bookInForce(books, "2026-12-31").id, "v2");
  assert.equal(bookInForce(books, "2027-01-01").id, "v3");
  assert.equal(bookInForce(books, "2025-12-31"), null);
  assert.equal(bookInForce(books, "2027-06-01", "v1").id, "v1"); // a contract pinned to v1 keeps it
});

test("impact of publishing: protected customers don't move; totals and movers are reported", () => {
  const oldB = BOOK, newB = { ...BOOK, modePrices: { ...BOOK.modePrices, self: 20 } };
  const orgs = [
    { id: "a", name: "A", counts: { self: 10 }, cycle: "month" },
    { id: "b", name: "B", counts: { self: 100 }, cycle: "month" },
    { id: "c", name: "C", counts: { self: 10 }, cycle: "month", pinned: true },
    { id: "d", name: "D", counts: { manager: 5 }, cycle: "month" },
  ];
  const r = impactOf(oldB, newB, orgs);
  assert.deepEqual([r.organisations, r.affected, r.protected, r.increases, r.decreases], [4, 2, 1, 2, 0]);
  assert.equal(r.deltaMonthly, 50 + 450); // A: 10×5; B: 100×5 less 10% volume
  assert.equal(r.top[0].id, "b");
  assert.equal(r.top.find((x) => x.id === "c"), undefined);
});

test("margin: unknown costs are never reported as a margin; known costs and alerts work", () => {
  const unknown = marginFor({ revenueMonthly: 1000, usage: { gpsEvents: 1000 }, orgs: 1 });
  assert.deepEqual([unknown.costsKnown, unknown.marginPct], [false, null]);
  assert.match(unknown.flags[0], /not reliable/);
  const cm = { perGpsEvent: 0.01, perFaceCheck: 1, paymentPct: 2.5, supportPerOrg: 100, infraPerOrg: 50 };
  const m = marginFor({ revenueMonthly: 1000, usage: { gpsEvents: 10000, faceChecks: 100 }, orgs: 1, costModel: cm });
  assert.deepEqual([m.cost, m.margin, m.marginPct], [375, 625, 62.5]); // 100 + 100 + 25 + 100 + 50
  assert.deepEqual(m.flags, []);
  const loss = marginFor({ revenueMonthly: 100, usage: { faceChecks: 1000 }, orgs: 1, costModel: cm });
  assert.ok(loss.marginPct < 0 && /loss/.test(loss.flags[0]));
  const thin = marginFor({ revenueMonthly: 400, usage: {}, orgs: 1, costModel: { supportPerOrg: 300 } });
  assert.match(thin.flags[0], /below the 30% alert/);
  assert.deepEqual(normalizeCostModel({ perGpsEvent: -5, junk: 1 }).perGpsEvent, 0);
});

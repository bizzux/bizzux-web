// Pure tests for lib/attendanceBilling.js — no emulator needed:  node --test test/attendanceBilling.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROPOSED_BOOK } from "../lib/attendancePricing.js";
import {
  addDays, diffDays, addMonths, cycleOf, currentCycle, remainingFraction, classifyMoves, applyMoves, planChange, changeKey, alreadyRecorded, canUndo,
  trialState, convertTrial, renew, accessFor, contractState, totalPeople, GRACE, UNDO_HOURS,
} from "../lib/attendanceBilling.js";

const BOOK = { ...PROPOSED_BOOK, faceGps: { enabled: true, price: 25, allowancePerEmployee: 20, overagePerCheck: 1 } };
const sub = (o = {}) => ({ status: "active", cycle: "month", cycleStart: "2026-10-01", basis: "assigned", billedCounts: { manager: 40, self: 10 }, ...o });
const TODAY = "2026-10-16"; // 16 days left of 31 (16..31 inclusive)

test("dates and cycles", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(diffDays("2026-10-16", "2026-11-01"), 16);
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28"); // month ends are clamped
  assert.equal(addMonths("2026-10-01", 12), "2027-10-01");
  assert.deepEqual(cycleOf("month", "2026-10-01"), { cycle: "month", start: "2026-10-01", next: "2026-11-01" });
  assert.equal(currentCycle(sub({ cycleStart: "2026-07-01" }), TODAY).start, "2026-10-01"); // rolled forward
  const r = remainingFraction(TODAY, cycleOf("month", "2026-10-01"));
  assert.deepEqual([r.days, r.total], [16, 31]);
  assert.equal(remainingFraction("2026-10-01", cycleOf("month", "2026-10-01")).fraction, 1); // first day: whole cycle left
  assert.equal(remainingFraction("2026-10-31", cycleOf("month", "2026-10-01")).days, 1);
});

test("moves: upgrades vs downgrades by tier; same-mode reassignment is not a move", () => {
  const m = classifyMoves([
    { from: "self", to: "verified", count: 3 }, { from: "manager", to: null, count: 1 }, { from: null, to: "self", count: 2 },
    { from: "smart_geofence", to: "self", count: 1 }, { from: "self", to: "self", count: 5 }, { from: "self", to: "verified", count: 0 }, { from: null, to: null, count: 4 },
  ]);
  assert.equal(m.up.length, 2);   // self→verified, new person→self
  assert.equal(m.down.length, 2); // manager leaves, smart→self
  assert.equal(m.same.length, 1);
  assert.deepEqual(applyMoves({ manager: 40, self: 10 }, [{ from: "self", to: "verified", count: 3 }]), { manager: 40, self: 7, verified: 3, smart_geofence: 0 });
  assert.deepEqual(applyMoves({ self: 1 }, [{ from: "self", to: null, count: 5 }]).self, 0); // never below zero
});

test("an upgrade is effective now and PRORATED onto the next invoice — nothing is charged immediately", () => {
  const p = planChange({ book: BOOK, sub: sub(), today: TODAY, moves: [{ from: "self", to: "verified", count: 3 }] });
  // 50 people, 5%. Before: 199 + 200 + 150 = 549 − 5% of 350 = 531.50. After: 199 + 200 + 105 + 90 = 594 − 5% of 395 = 574.25
  assert.deepEqual([p.current.total, p.next.total], [531.5, 574.25]);
  assert.equal(p.recurringDelta, 42.75);
  assert.deepEqual([p.proration.remainingDays, p.proration.cycleDays, p.proration.amount], [16, 31, 22.06]); // 42.75 × 16/31 = 22.0645
  assert.equal(p.proration.addedTo, "next invoice");
  assert.equal(p.charge.immediate, 0);
  assert.deepEqual(p.effective, { upgrades: TODAY, downgrades: null });
  assert.equal(p.undoUntil, null);
  assert.deepEqual(p.counts.today, { manager: 40, self: 7, verified: 3, smart_geofence: 0 });
  assert.equal(p.people.afterToday, 50);
  assert.equal(p.noChange, false);
  assert.match(p.taxes.note, /before GST/);
});

test("a downgrade waits for the next cycle start: no refund, an undo window, and the new price shows as the recurring change", () => {
  const p = planChange({ book: BOOK, sub: sub({ billedCounts: { manager: 40, self: 10, verified: 5 } }), today: TODAY, moves: [{ from: "verified", to: "self", count: 5 }] });
  assert.equal(p.proration.amount, 0); // nothing extra now
  assert.deepEqual(p.counts.today, p.counts.before); // they keep Verified until the next cycle
  assert.deepEqual(p.counts.nextCycle, { manager: 40, self: 15, verified: 0, smart_geofence: 0 });
  assert.equal(p.effective.downgrades, "2026-11-01");
  assert.ok(p.recurringDelta < 0 && p.recurringDeltaMonthly < 0);
  assert.ok(p.undoUntil && Date.parse(p.undoUntil) > Date.now() && Date.parse(p.undoUntil) <= Date.now() + UNDO_HOURS * 3600e3 + 5000);
  assert.equal(p.charge.immediate, 0);
});

test("a mixed batch splits cleanly: upgrades now, downgrades next cycle", () => {
  const p = planChange({ book: BOOK, sub: sub({ billedCounts: { manager: 40, self: 10, verified: 5 } }), today: TODAY, moves: [{ from: "self", to: "verified", count: 2 }, { from: "verified", to: "self", count: 5 }] });
  assert.deepEqual(p.counts.today, { manager: 40, self: 8, verified: 7, smart_geofence: 0 }); // only the upgrade applied today (+ the verified people still there)
  assert.deepEqual(p.counts.nextCycle, { manager: 40, self: 13, verified: 2, smart_geofence: 0 });
  assert.ok(p.proration.amount > 0);
  assert.equal(p.effective.downgrades, "2026-11-01");
});

test("a licence moved between people on the SAME mode changes nothing", () => {
  const p = planChange({ book: BOOK, sub: sub(), today: TODAY, moves: [{ from: "self", to: "self", count: 4 }] });
  assert.deepEqual([p.noChange, p.proration.amount, p.recurringDelta, p.unchanged.length], [true, 0, 0, 1]);
});

test("adding people and departures", () => {
  const add = planChange({ book: BOOK, sub: sub(), today: "2026-10-01", moves: [{ from: null, to: "manager", count: 10 }] });
  assert.equal(add.proration.amount, add.recurringDelta); // first day of the cycle: the whole cycle left → full amount
  assert.equal(add.people.afterToday, 60);
  const leave = planChange({ book: BOOK, sub: sub(), today: TODAY, moves: [{ from: "self", to: null, count: 2 }] });
  assert.deepEqual([leave.proration.amount, leave.effective.downgrades, leave.people.afterToday, leave.people.afterNextCycle], [0, "2026-11-01", 50, 48]); // still billed to cycle end
});

test("annual cycles prorate over the year", () => {
  const p = planChange({ book: BOOK, sub: sub({ cycle: "year", cycleStart: "2026-04-01" }), today: "2026-10-01", moves: [{ from: "self", to: "verified", count: 10 }] });
  assert.deepEqual([p.cycle.start, p.cycle.next, p.cycle.cycleDays, p.cycle.remainingDays], ["2026-04-01", "2027-04-01", 365, 182]);
  assert.ok(Math.abs(p.proration.amount - p.recurringDelta * 182 / 365) < 0.02);
});

test("volume tier effects are shown when a change crosses a threshold", () => {
  const p = planChange({ book: BOOK, sub: sub({ billedCounts: { manager: 48 } }), today: TODAY, moves: [{ from: null, to: "manager", count: 3 }] });
  assert.match(p.thresholdNote, /0% to 5%/);
});

test("entitlement blocks an upgrade into a mode the plan does not include; a purchased basis reports the shortfall", () => {
  const blocked = planChange({ book: BOOK, sub: sub(), today: TODAY, moves: [{ from: "self", to: "smart_geofence", count: 1 }], entitlement: { modes: { smart_geofence: false } } });
  assert.deepEqual([blocked.blocked, blocked.ok, blocked.problems[0].code], [true, false, "not_entitled"]);
  const contract = { billingBasis: "purchased", purchased: { manager: 40, self: 10 } };
  const short = planChange({ book: BOOK, contract, sub: sub({ basis: "purchased" }), today: TODAY, moves: [{ from: "self", to: "verified", count: 2 }] });
  assert.deepEqual(short.shortfall, { verified: 2 });
  assert.equal(short.problems[0].code, "needs_licences");
  assert.equal(short.blocked, false); // a shortfall asks for more licences; it does not forbid
});

test("idempotency: the same confirmed change is recorded once", () => {
  const moves = [{ from: "self", to: "verified", count: 3 }, { from: "manager", to: null, count: 1 }];
  const a = changeKey("org1", { moves, requestId: "r1" }), b = changeKey("org1", { moves: [...moves].reverse(), requestId: "r1" });
  assert.equal(a, b); // order does not matter
  assert.notEqual(a, changeKey("org1", { moves, requestId: "r2" }));
  assert.notEqual(a, changeKey("org2", { moves, requestId: "r1" }));
  assert.equal(alreadyRecorded({ changes: [{ key: a }] }, a), true);
  assert.equal(alreadyRecorded({ changes: [] }, a), false);
  const ch = { status: "scheduled", undoUntil: new Date(Date.now() + 3600e3).toISOString() };
  assert.equal(canUndo(ch, Date.now()), true);
  assert.equal(canUndo({ ...ch, undoUntil: new Date(Date.now() - 1000).toISOString() }, Date.now()), false);
  assert.equal(canUndo({ ...ch, status: "applied" }, Date.now()), false);
});

test("trial → paid starts a fresh cycle with nothing prorated or credited", () => {
  assert.deepEqual(trialState({ status: "trial", trialEnds: "2026-10-20" }, "2026-10-16"), { active: true, daysLeft: 4, expired: false });
  assert.equal(trialState({ status: "trial", trialEnds: "2026-10-20" }, "2026-10-21").expired, true);
  assert.equal(trialState({ status: "active" }, "2026-10-21").expired, false);
  const c = convertTrial({ book: BOOK, counts: { manager: 40, self: 10 }, cycle: "month", today: "2026-10-18" });
  assert.deepEqual([c.cycle.start, c.cycle.next, c.firstInvoice.total, c.proration, c.credit], ["2026-10-18", "2026-11-18", 531.5, 0, 0]);
});

test("renewal applies due downgrades and resets the billed counts", () => {
  const s = sub({ billedCounts: { manager: 40, self: 10, verified: 5 }, changes: [{ id: "c1", status: "scheduled", effectiveOn: "2026-11-01", moves: [{ from: "verified", to: "self", count: 5 }] }] });
  assert.equal(renew(s, "2026-10-31").renewed, false);
  const r = renew(s, "2026-11-01");
  assert.deepEqual([r.renewed, r.applied, r.billedCounts.verified, r.billedCounts.self, r.cycle.start], [true, ["c1"], 0, 15, "2026-11-01"]);
  assert.equal(renew(s, "2026-11-01", { assignedCounts: { manager: 38, self: 20 } }).billedCounts.manager, 38); // assigned basis: the people actually assigned then
});

test("failed payment: a grace period of full access, then read-only, then blocked — never abrupt", () => {
  const s = (d) => accessFor({ status: "past_due", paymentFailedOn: "2026-10-01" }, d);
  assert.equal(s("2026-10-05").access, "full");
  assert.equal(s("2026-10-08").access, "full");   // day 7
  assert.equal(s("2026-10-09").access, "read_only");
  assert.equal(s("2026-10-15").access, "read_only");
  assert.equal(s("2026-10-16").access, "blocked");
  assert.equal(GRACE.fullAccessDays + GRACE.readOnlyDays, 14);
  assert.equal(accessFor({ status: "active" }, "2026-10-05").access, "full");
  assert.equal(accessFor({ status: "trial", trialEnds: "2026-10-04" }, "2026-10-05").access, "blocked");
  assert.equal(accessFor({ status: "trial", trialEnds: "2026-10-09" }, "2026-10-05").access, "full");
  assert.equal(accessFor({ status: "cancelled" }, "2026-10-05").access, "blocked");
  assert.equal(accessFor(null, "2026-10-05").access, "full"); // not on licence pricing: unaffected
});

test("contract expiry: notice period, then the published book from the next cycle", () => {
  assert.equal(contractState({}, "2026-10-05").state, "open");
  assert.equal(contractState({ until: "2027-10-05" }, "2026-10-05").state, "open");
  assert.deepEqual([contractState({ until: "2026-10-25" }, "2026-10-05").state, contractState({ until: "2026-10-25" }, "2026-10-05").daysLeft], ["ending", 20]);
  assert.equal(contractState({ until: "2026-10-01" }, "2026-10-05").state, "expired");
  assert.equal(totalPeople({ manager: 2, self: 3 }), 5);
});

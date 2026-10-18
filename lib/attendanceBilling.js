// Bizzux Attendance billing POLICY — pure functions (no database, no gateway). It decides WHAT would happen to a licence-priced customer's
// bill when something changes, and when; it never charges anyone. Gateway work (creating / updating a subscription, collecting money) is a
// separate step that needs explicit approval and is not in this file.
//
// Decisions (owner-approved 2026-10-18):
//   • Nothing is charged because someone opened or edited an allocation screen. A change only counts once an admin CONFIRMS it.
//   • UPGRADES (a person moves to a higher-tier mode, or a new person is added) take effect on confirm. The difference for the rest of the
//     current billing cycle is PRORATED and added to the NEXT invoice — never charged immediately.
//   • DOWNGRADES (a person moves to a lower-tier mode, or leaves) take effect at the NEXT CYCLE START. No refunds or credits. The person keeps
//     the higher mode until then. A 24-hour undo window applies after confirming.
//   • Moving a licence between people on the SAME mode changes nothing on the bill.
//   • Billing basis is chosen per contract ("assigned" = people on each mode, recommended; "purchased" = quantities bought) and never mixed.
//   • Trial: no charge; the first invoice starts on the day the trial converts, with nothing prorated or credited.
//   • Failed payment: a grace period of full access, then read-only, then blocked — never an abrupt lock-out.
import { quote, MODES, MODE_LABEL } from "./attendancePricing.js";

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const int = (v) => Math.max(0, Math.floor(Number(v) || 0));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const addDays = (d, n) => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
export const diffDays = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); // b − a
export const addMonths = (d, n) => { const [y, m, dd] = d.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(dd, last)); return t.toISOString().slice(0, 10); };

export const MODE_TIER = { manager: 1, self: 2, verified: 3, smart_geofence: 4 };
export const UNDO_HOURS = 24;
export const GRACE = { fullAccessDays: 7, readOnlyDays: 7 }; // after a failed payment: 7 days normal, 7 days read-only, then blocked
export const TRIAL_MODES = { manager: true, self: true, verified: true, smart_geofence: true }; // a trial includes every mode (Face + GPS comes later)
export const SUB_STATUSES = ["trial", "active", "past_due", "cancelled", "expired"];

export const cleanCounts = (c) => Object.fromEntries(MODES.map((m) => [m, int(c?.[m])]));
export const totalPeople = (c) => MODES.reduce((s, m) => s + int(c?.[m]), 0);

// ---- cycles ---------------------------------------------------------------------------------------------------------------------------
export function cycleOf(cycle, start) { return { cycle: cycle === "year" ? "year" : "month", start, next: addMonths(start, cycle === "year" ? 12 : 1) }; }
// Roll forward to the cycle containing `today`.
export function currentCycle(sub, today) {
  let c = cycleOf(sub.cycle, sub.cycleStart);
  let guard = 0;
  while (c.next <= today && guard++ < 600) c = cycleOf(sub.cycle, c.next);
  return c;
}
// Calendar days left in the cycle INCLUDING today, over the days in the cycle.
export function remainingFraction(today, c) {
  const total = Math.max(1, diffDays(c.start, c.next));
  const left = Math.max(0, Math.min(total, diffDays(today, c.next)));
  return { days: left, total, fraction: left / total };
}

// ---- movements ------------------------------------------------------------------------------------------------------------------------
// moves: [{ from: mode|null, to: mode|null, count }] — null from = a new person (activation); null to = a person leaving / deactivated.
// A move between the same mode (or a licence reassigned between people on one mode) is not a move.
export function classifyMoves(moves) {
  const up = [], down = [], same = [];
  for (const m of moves || []) {
    const count = int(m.count); if (!count) continue;
    const from = m.from || null, to = m.to || null;
    if (!from && !to) continue;
    if (from === to) { same.push({ from, to, count }); continue; }
    const a = from ? MODE_TIER[from] : 0, b = to ? MODE_TIER[to] : 0;
    (b > a ? up : down).push({ from, to, count });
  }
  return { up, down, same };
}
// Apply moves to counts (never below zero).
export function applyMoves(counts, moves) {
  const out = cleanCounts(counts);
  for (const m of moves) { if (m.from) out[m.from] = Math.max(0, out[m.from] - m.count); if (m.to) out[m.to] += m.count; }
  return out;
}

// ---- the change plan (what a confirm would do) ----------------------------------------------------------------------------------------
// input: { book, contract, sub: { cycle, cycleStart, basis?, billedCounts }, moves, faceFrom?, faceTo?, today, orgPurchased? }
// Returns a full, itemised preview. It is the same maths whether shown to a customer admin or a Platform Admin.
export function planChange({ book, contract = null, sub, moves, today, faceFrom = 0, faceTo = 0, entitlement = null }) {
  const cyc = currentCycle(sub, today);
  const { up, down, same } = classifyMoves(moves);
  const before = cleanCounts(sub.billedCounts);
  const afterUp = applyMoves(before, up);                     // what the customer has from today
  const afterAll = applyMoves(afterUp, down);                 // what the customer has from the next cycle start
  const q = (counts, face) => quote(book, { counts, faceGpsCount: face, cycle: cyc.cycle, date: today }, contract);
  const qBefore = q(before, faceFrom), qNow = q(afterUp, Math.max(faceFrom, faceTo)), qNext = q(afterAll, faceTo);
  const rem = remainingFraction(today, cyc);

  // Today's change: only the UPGRADES, priced for the rest of the cycle and added to the next invoice.
  const upgradeDelta = r2(qNow.total - qBefore.total);                    // per full cycle
  const prorated = r2(Math.max(0, upgradeDelta) * rem.fraction);
  const perMove = (list) => list.map((m) => ({ ...m, label: `${m.from ? MODE_LABEL[m.from] : "New person"} → ${m.to ? MODE_LABEL[m.to] : "Leaves"}` }));
  // Blocked or flagged: modes the company is not entitled to, shortfalls on a purchased basis.
  const problems = [];
  for (const m of up) if (entitlement?.modes && entitlement.modes[m.to] === false) problems.push({ code: "not_entitled", mode: m.to, message: `${MODE_LABEL[m.to]} isn't included in your plan.` });
  let shortfall = {};
  if (sub.basis === "purchased" || contract?.billingBasis === "purchased") {
    const bought = cleanCounts(contract?.purchased);
    for (const mode of MODES) if (afterUp[mode] > bought[mode]) shortfall[mode] = afterUp[mode] - bought[mode];
    for (const [mode, n] of Object.entries(shortfall)) problems.push({ code: "needs_licences", mode, message: `${n} more ${MODE_LABEL[mode]} licence${n === 1 ? "" : "s"} needed.` });
  }
  const confirmAt = new Date().toISOString();
  return {
    blocked: problems.some((p) => p.code === "not_entitled"),
    ok: !problems.some((p) => p.code === "not_entitled"),
    problems, shortfall,
    cycle: { ...cyc, remainingDays: rem.days, cycleDays: rem.total },
    upgrades: perMove(up), downgrades: perMove(down), unchanged: same,
    people: { before: totalPeople(before), afterToday: totalPeople(afterUp), afterNextCycle: totalPeople(afterAll) },
    counts: { before, today: afterUp, nextCycle: afterAll },
    // money
    current: { total: qBefore.total, monthly: qBefore.monthly },
    next: { total: qNext.total, monthly: qNext.monthly, discount: qNext.discount, lines: qNext.lines, needsApproval: qNext.needsApproval },
    recurringDelta: r2(qNext.total - qBefore.total),
    recurringDeltaMonthly: r2(qNext.monthly - qBefore.monthly),
    proration: { amount: prorated, remainingDays: rem.days, cycleDays: rem.total, addedTo: "next invoice", note: prorated > 0 ? `${rem.days} of ${rem.total} days left in this ${cyc.cycle === "year" ? "year" : "month"}.` : "" },
    // when
    effective: { upgrades: today, downgrades: down.length ? cyc.next : null },
    undoUntil: down.length ? new Date(Date.parse(confirmAt) + UNDO_HOURS * 3600e3).toISOString() : null,
    charge: { immediate: 0, note: "Nothing is charged when you confirm. Prorated upgrade amounts appear on your next invoice." },
    taxes: { applied: false, note: "Amounts are before GST. Tax is applied on the invoice." },
    thresholdNote: qNext.discount.tierMin !== qBefore.discount.tierMin ? `Your volume discount moves from ${qBefore.discount.pct}% to ${qNext.discount.pct}%.` : "",
    noChange: !up.length && !down.length,
  };
}


// ---- confirm: idempotency ------------------------------------------------------------------------------------------------------------
// A stable key for one confirmed change, so pressing Confirm twice (or a retried request) records it once and adds ONE prorated adjustment.
export function changeKey(orgId, { moves, faceFrom = 0, faceTo = 0, requestId = "" }) {
  const norm = (moves || []).filter((m) => int(m.count)).map((m) => `${m.from || "-"}>${m.to || "-"}x${int(m.count)}`).sort().join(",");
  return `${orgId}|${norm}|f${int(faceFrom)}>${int(faceTo)}|${String(requestId).slice(0, 40)}`;
}
export function alreadyRecorded(sub, key) { return (sub?.changes || []).some((c) => c.key === key); }
// May a confirmed downgrade still be undone?
export const canUndo = (change, nowMs) => !!change?.undoUntil && change.status === "scheduled" && nowMs <= Date.parse(change.undoUntil);

// ---- trial → paid, renewal ------------------------------------------------------------------------------------------------------------
export function trialState(sub, today) {
  if (sub?.status !== "trial" || !DATE.test(sub.trialEnds || "")) return { active: false, daysLeft: 0, expired: sub?.status === "trial" };
  const left = diffDays(today, sub.trialEnds);
  return { active: left >= 0, daysLeft: Math.max(0, left), expired: left < 0 };
}
// Converting a trial starts the first paid cycle on `today`: nothing prorated, nothing credited for unused trial days.
export function convertTrial({ book, contract = null, counts, cycle, today }) {
  const c = cycleOf(cycle, today);
  const q = quote(book, { counts: cleanCounts(counts), cycle: c.cycle, date: today }, contract);
  return { cycle: c, firstInvoice: { total: q.total, monthly: q.monthly, lines: q.lines, discount: q.discount }, proration: 0, credit: 0 };
}
// At a cycle start: apply scheduled downgrades, reset the billed counts. For "assigned" the caller passes the people actually assigned then.
export function renew(sub, today, { assignedCounts = null } = {}) {
  const c = currentCycle(sub, today);
  if (c.start === sub.cycleStart) return { renewed: false, cycle: c, applied: [], billedCounts: cleanCounts(sub.billedCounts) };
  const due = (sub.changes || []).filter((x) => x.status === "scheduled" && x.effectiveOn <= today);
  let counts = cleanCounts(sub.billedCounts);
  for (const x of due) counts = applyMoves(counts, x.moves);
  if (assignedCounts) counts = cleanCounts(assignedCounts);
  return { renewed: true, cycle: c, applied: due.map((x) => x.id), billedCounts: counts };
}

// ---- failed payment, contract expiry --------------------------------------------------------------------------------------------------
// access: "full" | "read_only" | "blocked". Never abrupt: days of grace first.
export function accessFor(sub, today) {
  if (!sub) return { access: "full", reason: "no licence subscription" };
  if (sub.status === "trial") { const t = trialState(sub, today); return t.active ? { access: "full", reason: "trial", daysLeft: t.daysLeft } : { access: "blocked", reason: "trial ended" }; }
  if (sub.status === "cancelled" || sub.status === "expired") return { access: "blocked", reason: sub.status };
  if (sub.status === "past_due" && sub.paymentFailedOn) {
    const d = diffDays(sub.paymentFailedOn, today);
    if (d <= GRACE.fullAccessDays) return { access: "full", reason: "payment failed — grace period", daysLeft: GRACE.fullAccessDays - d };
    if (d <= GRACE.fullAccessDays + GRACE.readOnlyDays) return { access: "read_only", reason: "payment failed — read-only", daysLeft: GRACE.fullAccessDays + GRACE.readOnlyDays - d };
    return { access: "blocked", reason: "payment failed — grace ended" };
  }
  return { access: "full", reason: "active" };
}
// A contract with an end date: 30 days' notice, then the published book applies from the next cycle (never mid-cycle).
export function contractState(contract, today) {
  if (!contract?.until || !DATE.test(contract.until)) return { state: "open", fallsBackOn: null };
  const left = diffDays(today, contract.until);
  if (left < 0) return { state: "expired", fallsBackOn: contract.until };
  return { state: left <= 30 ? "ending" : "open", daysLeft: left, fallsBackOn: contract.until };
}

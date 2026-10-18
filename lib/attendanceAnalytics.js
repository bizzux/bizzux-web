// Platform-admin analytics for Bizzux Attendance — PURE (no database). The route loads the documents; this file only does the sums.
// Money here is an ESTIMATE from the price book and contracts ("what the licence model says we should bill"). It is not invoiced revenue:
// nothing is charged through the portal for Attendance yet. Margin follows the existing "unknown until unit costs are entered" rule.
import { MODES, MODE_LABEL, quote, marginFor } from "./attendancePricing.js";
import { cleanCounts, totalPeople, diffDays, addDays } from "./attendanceBilling.js";

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const STATUSES = ["trial", "active", "past_due", "cancelled", "expired"];

// subs: attendanceSubscriptions docs [{id|organizationId, status, cycle, billedCounts, basis, trialEnds, ...}]
// contracts: { [orgId]: contract }; usage: { [orgId]: { counts, people, faceGps, ... } }; book: the book in force (or null)
export function analyse({ subs = [], contracts = {}, usage = {}, book = null, costModel = {}, today, usageEvents = {} }) {
  const idOf = (s) => s.organizationId || s.id;
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const sold = Object.fromEntries(MODES.map((m) => [m, 0]));
  const used = Object.fromEntries(MODES.map((m) => [m, 0]));
  const revenueByMode = Object.fromEntries(MODES.map((m) => [m, 0]));
  const orgs = [];
  let mrr = 0, discount = 0, listTotal = 0, unpaidAdjustments = 0, noBook = 0;

  for (const s of subs) {
    const id = idOf(s);
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    const billed = cleanCounts(s.billedCounts);
    const live = cleanCounts(usage[id]?.counts);
    for (const m of MODES) { sold[m] += billed[m]; used[m] += live[m]; }
    unpaidAdjustments += (s.adjustments || []).filter((a) => !a.invoiced).reduce((x, a) => x + (Number(a.amount) || 0), 0);
    const paying = s.status === "active" || s.status === "past_due"; // a trial earns nothing; cancelled/expired earn nothing
    let monthly = 0, disc = 0, list = 0;
    if (book && paying) {
      const q = quote(book, { counts: billed, cycle: s.cycle, date: today }, contracts[id] || null);
      monthly = q.monthly; disc = q.discount?.amount || 0; list = q.subtotal;
      for (const l of q.lines) if (MODES.includes(l.key)) revenueByMode[l.key] += l.amount * (1 - (l.discountable ? (q.discount?.pct || 0) / 100 : 0));
    } else if (paying) noBook++;
    mrr += monthly; discount += disc; listTotal += list;
    orgs.push({ id, status: s.status, cycle: s.cycle || "month", sold: totalPeople(billed), used: totalPeople(live), monthly: r2(monthly), trialEnds: s.trialEnds || null });
  }

  // Per organisation (an aggregate would let one company's idle seats hide another's over-use).
  // Over-use = people on a mode beyond what is billed (under-billing risk). Idle = billed seats nobody is on (churn risk). Live organisations only.
  const overUse = [], idle = [];
  for (const s of subs) {
    if (s.status === "cancelled" || s.status === "expired" || !usage[idOf(s)]) continue;
    const billed = cleanCounts(s.billedCounts), live = cleanCounts(usage[idOf(s)].counts);
    for (const m of MODES) {
      if (live[m] > billed[m]) overUse.push({ id: idOf(s), mode: m, label: MODE_LABEL[m], billed: billed[m], used: live[m], gap: live[m] - billed[m] });
      else if (billed[m] > live[m]) idle.push({ id: idOf(s), mode: m, label: MODE_LABEL[m], billed: billed[m], used: live[m], gap: billed[m] - live[m] });
    }
  }

  const expiringTrials = subs
    .filter((s) => s.status === "trial" && s.trialEnds)
    .map((s) => ({ id: idOf(s), trialEnds: s.trialEnds, daysLeft: diffDays(today, s.trialEnds) }))
    .filter((t) => t.daysLeft <= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const failed = subs.filter((s) => s.status === "past_due").map((s) => ({ id: idOf(s), since: s.pastDueSince || null }));

  // Cost: usage events summed across organisations; payment cost uses the monthly estimate.
  const cost = marginFor({ revenueMonthly: mrr, usage: usageEvents, orgs: Math.max(1, byStatus.active + byStatus.past_due), costModel });

  const mix = Object.fromEntries(MODES.map((m) => [m, { label: MODE_LABEL[m], sold: sold[m], used: used[m], revenueMonthly: r2(revenueByMode[m]) }]));
  return {
    today, orgs: subs.length, byStatus, mix, mrr: r2(mrr), arr: r2(mrr * 12),
    discountExposure: { monthly: r2(discount), pctOfList: listTotal > 0 ? r2(discount / listTotal * 100) : null },
    unpaidAdjustments: r2(unpaidAdjustments), failedPayments: failed, expiringTrials,
    overUse, idle, margin: cost, estimate: true, activeWithoutBook: noBook,
    note: "Estimate from the price book and contracts. Attendance is not invoiced through the portal yet, so this is not collected revenue.",
    top: orgs.sort((a, b) => b.monthly - a.monthly).slice(0, 10),
  };
}

export { addDays };

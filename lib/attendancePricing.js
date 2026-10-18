// Bizzux Attendance pricing — PURE functions (no database, no network). One calculation behind the admin preview, the customer quote and
// the margin report. Prices are never written in code paths that charge anyone: this file only computes and validates.
//
// Model (all money is INR per month unless a line says otherwise):
//   total = base fee (per organisation)
//         + Σ per-employee price of each of the four modes × number of people on that mode
//         + Face + GPS add-on × eligible people (Verified / Smart Geofence only) that have it
//         − ONE discount (the greater of the volume discount and the annual discount; never stacked unless a contract says so)
//   then at least the minimum monthly fee.
// The discount applies to the per-employee lines only (never the base fee) unless the book says otherwise.
//
// Billing basis is chosen PER CONTRACT and never mixed: "assigned" bills the people actually assigned to each mode (recommended);
// "purchased" bills the quantities bought and flags a shortfall when more people are assigned than were bought.

export const MODES = ["manager", "self", "verified", "smart_geofence"];
export const MODE_LABEL = { manager: "Manager Attendance", self: "Self Attendance", verified: "Verified Attendance", smart_geofence: "Smart Geofence" };
export const FACE_ELIGIBLE = ["verified", "smart_geofence"]; // Face is never offered on its own: it rides on a location-verified mode
export const BOOK_STATUSES = ["draft", "pending_approval", "scheduled", "published", "retired"];
export const CYCLES = ["month", "year"];

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
// A contract field that is blank (null / undefined / "") means "use the book's value" — never zero.
const pick = (v, d) => (v === null || v === undefined || v === "" ? d : num(v, d));
const int = (v, d = 0) => Math.max(0, Math.floor(num(v, d)));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The numbers from the product brief. They are PROPOSALS: stored only as an unpublished draft, never live until an authorised person
// publishes them, and not claimed to be profitable until measured costs are in (see marginFor).
export const PROPOSED_BOOK = {
  currency: "INR",
  baseFee: 199,
  modePrices: { manager: 5, self: 15, verified: 30, smart_geofence: 60 },
  faceGps: { enabled: false, price: 25, allowancePerEmployee: 0, overagePerCheck: 0 }, // stays off until provider cost is researched (Phase 6)
  trialDays: 14,
  annualDiscountPct: 10,
  volumeTiers: [
    { min: 1, pct: 0 }, { min: 50, pct: 5 }, { min: 100, pct: 10 }, { min: 250, pct: 15 },
    { min: 500, pct: 20, requiresApproval: true }, // "up to 20%, with admin approval"
  ],
  minimumMonthlyFee: 0,
  discountedLines: ["modes", "faceGps"], // what a discount applies to; the base fee is never discounted
  stackDiscounts: false,
  tierMode: "whole",
};

// ---- price book --------------------------------------------------------------------------------------------------------------------
export function normalizeBook(b = {}) {
  const p = b.modePrices || {};
  const tiers = (Array.isArray(b.volumeTiers) ? b.volumeTiers : []).map((t) => ({ min: int(t.min, 1), pct: r2(num(t.pct)), ...(t.requiresApproval ? { requiresApproval: true } : {}) }))
    .sort((a, c) => a.min - c.min);
  const f = b.faceGps || {};
  return {
    currency: "INR",
    baseFee: r2(num(b.baseFee)),
    modePrices: Object.fromEntries(MODES.map((m) => [m, r2(num(p[m]))])),
    faceGps: { enabled: f.enabled === true, price: r2(num(f.price)), allowancePerEmployee: int(f.allowancePerEmployee), overagePerCheck: r2(num(f.overagePerCheck)) },
    trialDays: int(b.trialDays),
    annualDiscountPct: r2(num(b.annualDiscountPct)),
    volumeTiers: tiers,
    minimumMonthlyFee: r2(num(b.minimumMonthlyFee)),
    discountedLines: ["modes", "faceGps"].filter((x) => (Array.isArray(b.discountedLines) ? b.discountedLines : ["modes", "faceGps"]).includes(x)),
    stackDiscounts: b.stackDiscounts === true,
    // "whole": the tier's % comes off the whole per-employee bill (as in the brief). "graduated": each tier's % applies only to the people
    // inside that band, so the bill can never go DOWN when a company adds people.
    tierMode: b.tierMode === "graduated" ? "graduated" : "whole",
  };
}

// → list of problems (empty = valid). Errors block saving; the rest are advice returned by adviceFor().
export function validateBook(input) {
  const b = normalizeBook(input);
  const out = [];
  const raw = input || {};
  if (raw.baseFee !== undefined && !(num(raw.baseFee, -1) >= 0)) out.push("The organisation fee must be 0 or more.");
  for (const m of MODES) { const v = raw.modePrices?.[m]; if (!(num(v, -1) >= 0)) out.push(`${MODE_LABEL[m]} needs a price of 0 or more.`); }
  if (!(b.annualDiscountPct >= 0 && b.annualDiscountPct <= 100)) out.push("The annual discount must be between 0% and 100%.");
  if (b.faceGps.enabled && !(b.faceGps.price >= 0)) out.push("Face + GPS needs a price.");
  if (b.minimumMonthlyFee < 0) out.push("The minimum monthly fee can't be negative.");
  if (!b.volumeTiers.length) out.push("Add at least one volume tier (starting at 1 employee).");
  else {
    if (b.volumeTiers[0].min !== 1) out.push("The first volume tier must start at 1 employee.");
    if (b.volumeTiers[0].pct !== 0) out.push("The first volume tier (1 employee up) must have no discount.");
    const seen = new Set();
    let last = -1;
    for (const t of b.volumeTiers) {
      if (seen.has(t.min)) out.push(`Two volume tiers start at ${t.min} employees.`); seen.add(t.min);
      if (t.pct < 0 || t.pct > 100) out.push(`A ${t.pct}% volume discount is out of range.`);
      if (t.pct < last) out.push("A bigger company can't get a smaller discount than a smaller one.");
      last = Math.max(last, t.pct);
    }
  }
  return out;
}
// Soft warnings — worth a second look, never blocking.
export function adviceFor(input) {
  const b = normalizeBook(input), out = [];
  const [m, s, v, g] = MODES.map((k) => b.modePrices[k]);
  if (!(m <= s && s <= v && v <= g)) out.push("Mode prices usually rise with the capability (Manager ≤ Self ≤ Verified ≤ Smart Geofence). Check this is intended.");
  if (b.faceGps.enabled && b.faceGps.allowancePerEmployee === 0 && b.faceGps.overagePerCheck === 0) out.push("Face + GPS is on with no usage allowance or overage price, so biometric costs are uncapped.");
  if (b.volumeTiers.some((t) => t.pct > 25)) out.push("A volume discount above 25% needs a margin check (see the margin report).");
  const drops = cliffReport(b).filter((c) => c.drop > 0);
  if (b.tierMode === "whole" && drops.length) out.push(`With whole-bill tiers a company pays LESS after crossing ${drops.map((c) => c.min).join(", ")} employees than just below it (for example ${drops[0].min - 1} → ${drops[0].min} people saves ${drops[0].drop}). Consider graduated tiers, or lock the tier per term.`);
  return out;
}

// ---- lifecycle ---------------------------------------------------------------------------------------------------------------------
// draft → pending_approval → (published | scheduled) → retired. Only drafts can be edited; everything else is immutable history.
export const canEdit = (book) => book?.status === "draft";
// Two-person rule: whoever drafted or edited a version can't be the one to publish it.
export function approvalProblem(book, actorUid) {
  if (!book) return "Price book not found.";
  if (book.status !== "pending_approval") return "Only a version waiting for approval can be published.";
  const involved = new Set([book.createdBy, book.lastEditedBy, book.submittedBy, ...(book.editors || [])].filter(Boolean));
  if (involved.has(actorUid)) return "A different person must approve this version — whoever drafted or edited it can't publish it.";
  return "";
}
export function submitProblem(book, errors, effectiveFrom, today) {
  if (!canEdit(book)) return "Only a draft can be submitted for approval.";
  if (errors.length) return errors[0];
  if (!DATE.test(effectiveFrom || "")) return "Choose the date this version takes effect.";
  if (effectiveFrom < today) return "The effective date can't be in the past.";
  return "";
}
// The version in force on `date`: the published/scheduled one with the latest effective date on or before it. A contract may pin an
// older version (price protection) — then that version is used whatever has been published since.
export function bookInForce(books, date, pinnedId = "") {
  if (pinnedId) return (books || []).find((b) => b.id === pinnedId) || null;
  const live = (books || []).filter((b) => (b.status === "published" || b.status === "scheduled" || b.status === "retired") && b.effectiveFrom && b.effectiveFrom <= date && b.approvedAt);
  live.sort((a, c) => (a.effectiveFrom < c.effectiveFrom ? 1 : a.effectiveFrom > c.effectiveFrom ? -1 : (c.version || 0) - (a.version || 0)));
  return live[0] || null;
}

// ---- billable quantities -----------------------------------------------------------------------------------------------------------
// basis "assigned": the people actually on each mode. basis "purchased": the quantities bought; `shortfall` says where more people are
// assigned than were bought (they need more licences — never silently billed at a different basis).
export function billableCounts(basis, assigned = {}, purchased = {}) {
  const a = Object.fromEntries(MODES.map((m) => [m, int(assigned[m])]));
  if (basis !== "purchased") return { counts: a, shortfall: {} };
  const p = Object.fromEntries(MODES.map((m) => [m, int(purchased[m])]));
  const shortfall = {};
  for (const m of MODES) if (a[m] > p[m]) shortfall[m] = a[m] - p[m];
  return { counts: p, shortfall };
}

// ---- discount tiers ----------------------------------------------------------------------------------------------------------------
export function tierFor(book, employees) {
  const tiers = normalizeBook(book).volumeTiers;
  let hit = tiers[0] || { min: 1, pct: 0 };
  for (const t of tiers) if (employees >= t.min) hit = t;
  return hit;
}
// What crossing a threshold would do: the next tier and how many people away it is, and the tier you would fall back to.
export function thresholdImpact(book, employees) {
  const b = normalizeBook(book);
  const cur = tierFor(b, employees);
  const next = b.volumeTiers.find((t) => t.min > employees) || null;
  const prev = [...b.volumeTiers].reverse().find((t) => t.min < cur.min) || null;
  return { current: cur, next: next && { ...next, employeesToGo: next.min - employees }, previous: prev, employees };
}
// Lock the volume discount for a billing term so a small headcount change can't move a customer's tier mid-term.
export function lockTier(book, employees, from, months = 12) {
  const t = tierFor(book, employees);
  const d = new Date(from + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + months);
  return { pct: t.pct, min: t.min, requiresApproval: !!t.requiresApproval, from, until: d.toISOString().slice(0, 10) };
}

// Graduated tiers: the weighted discount over the people in each band (band = from a tier's start to the next tier's start).
export function graduatedPct(bookInput, employees, approved = []) {
  const tiers = normalizeBook(bookInput).volumeTiers;
  if (!employees || !tiers.length) return 0;
  let weighted = 0, lastFree = 0;
  tiers.forEach((t, i) => {
    const to = i + 1 < tiers.length ? tiers[i + 1].min - 1 : Infinity;
    const inBand = Math.max(0, Math.min(employees, to) - t.min + 1);
    const usable = t.requiresApproval && !approved.includes(t.min);
    const pct = usable ? lastFree : t.pct;
    if (!usable) lastFree = pct;
    weighted += pct * inBand;
  });
  return r2(weighted / employees);
}

// Where a bill goes DOWN as a company grows: for each threshold, the cost just below it versus at it (all people on Self).
export function cliffReport(bookInput) {
  const b = normalizeBook(bookInput);
  const out = [];
  for (const t of b.volumeTiers) {
    if (t.min <= 1) continue;
    const lo = quote(b, { counts: { self: t.min - 1 } }, { approvedTiers: b.volumeTiers.map((x) => x.min) }).monthly;
    const hi = quote(b, { counts: { self: t.min } }, { approvedTiers: b.volumeTiers.map((x) => x.min) }).monthly;
    out.push({ min: t.min, below: lo, at: hi, drop: r2(lo - hi) });
  }
  return out;
}

// ---- the quote ---------------------------------------------------------------------------------------------------------------------
// input: { counts: {mode: n}, faceGpsCount, cycle: "month"|"year", date: "YYYY-MM-DD" (for locks), employees? (tier headcount; default Σ counts) }
// contract (optional): { baseFee?, modePrices?, faceGpsPrice?, minimumMonthlyFee?, fixedDiscountPct? (explicit, approved), stackDiscounts?,
//                        approvedTiers?: [min,…] (tiers that need approval and have it), tierLock?: {pct, until} }
export function quote(bookInput, input = {}, contract = null) {
  const book = normalizeBook(bookInput);
  const c = contract || {};
  const cycle = input.cycle === "year" ? "year" : "month";
  const counts = Object.fromEntries(MODES.map((m) => [m, int(input.counts?.[m])]));
  const people = MODES.reduce((s, m) => s + counts[m], 0);
  const eligible = FACE_ELIGIBLE.reduce((s, m) => s + counts[m], 0);
  const faceCount = book.faceGps.enabled ? Math.min(int(input.faceGpsCount), eligible) : 0;
  const notes = [];
  if (input.faceGpsCount && !book.faceGps.enabled) notes.push("Face + GPS isn't available yet.");
  else if (int(input.faceGpsCount) > eligible) notes.push(`Face + GPS needs Verified or Smart Geofence: only ${eligible} eligible ${eligible === 1 ? "person" : "people"}.`);

  const price = (m) => pick(c.modePrices?.[m], book.modePrices[m]);
  const baseFee = pick(c.baseFee, book.baseFee);
  const lines = [];
  if (baseFee > 0 || people === 0) lines.push({ key: "base", label: "Organisation fee", qty: 1, unit: r2(baseFee), amount: r2(baseFee), discountable: false });
  for (const m of MODES) if (counts[m] > 0) lines.push({ key: m, label: MODE_LABEL[m], qty: counts[m], unit: r2(price(m)), amount: r2(counts[m] * price(m)), discountable: book.discountedLines.includes("modes") });
  if (faceCount > 0) { const fp = pick(c.faceGpsPrice, book.faceGps.price); lines.push({ key: "face_gps", label: "Face + GPS add-on", qty: faceCount, unit: r2(fp), amount: r2(faceCount * fp), discountable: book.discountedLines.includes("faceGps") }); }
  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const discountable = r2(lines.filter((l) => l.discountable).reduce((s, l) => s + l.amount, 0));

  // one discount: the greater of volume and annual, unless the contract says otherwise
  const headcount = int(input.employees, people) || people;
  const tier = tierFor(book, headcount);
  const locked = c.tierLock && input.date && input.date <= c.tierLock.until ? c.tierLock : null;
  let volumePct = locked ? num(locked.pct) : tier.pct;
  let approval = null;
  if (book.tierMode === "graduated" && !locked) {
    volumePct = graduatedPct(book, headcount, c.approvedTiers || []);
    if (tier.requiresApproval && !(c.approvedTiers || []).includes(tier.min)) approval = { reason: `The ${tier.pct}% discount for ${tier.min}+ employees needs approval from an authorised administrator. Until approved, the next lower tier applies to those people.`, pct: tier.pct, applied: volumePct, tierMin: tier.min };
  } else if (!locked && tier.requiresApproval && !(c.approvedTiers || []).includes(tier.min)) {
    const free = [...book.volumeTiers].reverse().find((t) => t.min <= headcount && !t.requiresApproval) || { pct: 0, min: 1 };
    approval = { reason: `The ${tier.pct}% discount for ${tier.min}+ employees needs approval from an authorised administrator. Until approved, ${free.pct}% applies.`, pct: tier.pct, applied: free.pct, tierMin: tier.min };
    volumePct = free.pct;
  }
  const annualPct = cycle === "year" ? book.annualDiscountPct : 0;
  const stack = c.stackDiscounts === true || (c.stackDiscounts === undefined && book.stackDiscounts);
  let pct, type;
  if (Number.isFinite(Number(c.fixedDiscountPct)) && c.fixedDiscountPct !== null && c.fixedDiscountPct !== undefined) { pct = num(c.fixedDiscountPct); type = "contract"; }
  else if (stack) { pct = r2(100 - (100 - volumePct) * (100 - annualPct) / 100); type = "volume+annual"; }
  else if (annualPct > volumePct) { pct = annualPct; type = "annual"; }
  else { pct = volumePct; type = pct > 0 ? "volume" : "none"; }
  if (pct <= 0) type = "none";
  const discountAmount = r2(discountable * pct / 100);
  const afterDiscount = r2(subtotal - discountAmount);

  const minMonthly = pick(c.minimumMonthlyFee, book.minimumMonthlyFee);
  const monthlyBeforeMin = afterDiscount;
  const monthly = Math.max(monthlyBeforeMin, minMonthly);
  const minimumApplied = monthly > monthlyBeforeMin;
  // Annual billing: twelve months of the discounted monthly amount (the annual discount is already inside `pct`).
  const total = cycle === "year" ? r2(monthly * 12) : r2(monthly);
  return {
    ok: true, currency: book.currency, cycle, people, headcount, counts, faceGpsCount: faceCount,
    lines, subtotal,
    discount: { type, pct, amount: discountAmount, volumePct, annualPct, tierMin: tier.min, locked: !!locked, rule: stack ? "stacked (contract)" : type === "contract" ? "contract rate" : "greater of volume or annual — never stacked" },
    minimum: { monthly: r2(minMonthly), applied: minimumApplied },
    monthly: r2(monthly), total, monthlyEquivalent: r2(monthly),
    periodLabel: cycle === "year" ? "per year" : "per month",
    needsApproval: approval, notes,
    threshold: thresholdImpact(book, headcount),
  };
}

// What a headcount change does to the bill (used before an admin confirms a change): same quote, before and after.
export function previewChange(book, before, after, contract = null) {
  const a = quote(book, before, contract), b = quote(book, after, contract);
  const grew = MODES.reduce((s, m) => s + int(after.counts?.[m]), 0) > MODES.reduce((s, m) => s + int(before.counts?.[m]), 0);
  return { before: a, after: b, deltaMonthly: r2(b.monthly - a.monthly), deltaPeriod: r2(b.total - a.total), tierChanged: a.discount.tierMin !== b.discount.tierMin, cliff: grew && b.monthly < a.monthly };
}

// ---- impact of publishing a price book on existing customers -----------------------------------------------------------------------
// orgs: [{ id, name, counts, faceGpsCount, cycle, contract, pinned }]. Customers pinned to an older version (price protection) or with
// their own rates are reported separately and are not moved.
export function impactOf(oldBook, newBook, orgs) {
  const rows = [];
  let protectedCount = 0, delta = 0;
  for (const o of orgs || []) {
    const input = { counts: o.counts, faceGpsCount: o.faceGpsCount, cycle: o.cycle, employees: o.employees };
    const now = oldBook ? quote(oldBook, input, o.contract).monthly : 0;
    if (o.pinned || o.contract?.pinnedVersion) { protectedCount++; rows.push({ id: o.id, name: o.name || o.id, now, after: now, delta: 0, protected: true }); continue; }
    const after = quote(newBook, input, o.contract).monthly;
    delta += after - now;
    rows.push({ id: o.id, name: o.name || o.id, now, after, delta: r2(after - now), protected: false });
  }
  const moved = rows.filter((r) => r.delta !== 0);
  return {
    organisations: rows.length, affected: moved.length, protected: protectedCount,
    deltaMonthly: r2(delta), increases: moved.filter((r) => r.delta > 0).length, decreases: moved.filter((r) => r.delta < 0).length,
    top: [...moved].sort((a, c) => Math.abs(c.delta) - Math.abs(a.delta)).slice(0, 10),
  };
}

// ---- cost and margin ---------------------------------------------------------------------------------------------------------------
// Unit costs are measured, not assumed: an empty cost model reports "unknown" rather than a flattering margin.
export const COST_KEYS = ["perGpsEvent", "perPhotoGb", "perFaceCheck", "perNotification", "perReport", "paymentPct", "paymentFixed", "supportPerOrg", "infraPerOrg"];
export function normalizeCostModel(m = {}) { return Object.fromEntries(COST_KEYS.map((k) => [k, Math.max(0, num(m[k]))])); }
export function marginFor({ revenueMonthly, usage = {}, orgs = 1, costModel = {}, alertBelowPct = 30 }) {
  const m = normalizeCostModel(costModel);
  const known = COST_KEYS.some((k) => m[k] > 0);
  const lines = [
    { key: "gps", label: "GPS / location events", qty: int(usage.gpsEvents), cost: r2(int(usage.gpsEvents) * m.perGpsEvent) },
    { key: "photos", label: "Photo storage (GB)", qty: num(usage.photoGb), cost: r2(num(usage.photoGb) * m.perPhotoGb) },
    { key: "face", label: "Face checks", qty: int(usage.faceChecks), cost: r2(int(usage.faceChecks) * m.perFaceCheck) },
    { key: "notify", label: "Notifications", qty: int(usage.notifications), cost: r2(int(usage.notifications) * m.perNotification) },
    { key: "reports", label: "Report generation", qty: int(usage.reports), cost: r2(int(usage.reports) * m.perReport) },
    { key: "payment", label: "Payment processing", qty: 1, cost: r2(num(revenueMonthly) * m.paymentPct / 100 + m.paymentFixed * Math.max(1, orgs)) },
    { key: "support", label: "Support", qty: orgs, cost: r2(orgs * m.supportPerOrg) },
    { key: "infra", label: "Infrastructure share", qty: orgs, cost: r2(orgs * m.infraPerOrg) },
  ];
  const cost = r2(lines.reduce((s, l) => s + l.cost, 0));
  const rev = r2(num(revenueMonthly));
  const margin = r2(rev - cost);
  const pct = rev > 0 ? r2(margin / rev * 100) : null;
  const flags = [];
  if (!known) flags.push("No unit costs have been entered, so this margin is not reliable yet.");
  else if (pct !== null && pct < 0) flags.push("Running at a loss.");
  else if (pct !== null && pct < alertBelowPct) flags.push(`Gross margin is below the ${alertBelowPct}% alert level.`);
  return { revenueMonthly: rev, cost, margin, marginPct: known ? pct : null, lines, flags, costsKnown: known };
}

// SERVER ONLY. Licence-subscription STATE for Bizzux Attendance (attendanceSubscriptions/{orgId}) and the preview / confirm flow.
// The money rules live in lib/attendanceBilling.js (pure, tested). This file records what an admin CONFIRMED and what it would cost.
//
// NOTHING HERE TALKS TO A PAYMENT GATEWAY. No Razorpay / Stripe subscription is created, updated or cancelled, no payment is collected, and
// checkout / webhooks are untouched. Confirmed upgrades add a prorated adjustment that is meant for the NEXT invoice; actually invoicing and
// collecting is a separate step that needs explicit approval (Phase 5 gateway slice, not built).
import { adminDb } from "./firebaseAdmin";
import { logAuditEvent } from "./audit";
import { listBooks, getContract, bookInForce, todayIst } from "./attendancePriceBook";
import { quote, MODES } from "./attendancePricing";
import { planChange, changeKey, alreadyRecorded, canUndo, convertTrial, trialState, accessFor, cleanCounts, totalPeople, addDays, cycleOf, UNDO_HOURS, applyMoves, classifyMoves } from "./attendanceBilling";

const subs = () => adminDb().collection("attendanceSubscriptions");
const nowIso = () => new Date().toISOString();
const fail = (status, message) => ({ status, message });
const DEFAULT_TRIAL_DAYS = 14;

export async function getSubscription(orgId) { const s = await subs().doc(String(orgId)).get(); return s.exists ? { id: s.id, ...s.data() } : null; }

// What a company may use. Assigned basis: every mode (it pays for people actually on each). Purchased basis: only modes it bought.
export function entitlementFor(sub, contract) {
  const modes = Object.fromEntries(MODES.map((m) => [m, true]));
  if ((contract?.billingBasis || sub?.basis) === "purchased") for (const m of MODES) modes[m] = (contract?.purchased?.[m] || 0) > 0;
  return { modes, faceGps: false, source: sub?.status === "trial" ? "trial" : "licence", trialEnds: sub?.trialEnds || null, updatedAt: nowIso() };
}
// The portal tells Attendance what the company may use by writing it onto attSettings/main (Attendance never accepts it from a request).
export async function writeEntitlement(orgId, entitlement) {
  await adminDb().doc(`customers/${orgId}/attSettings/main`).set({ licenceEntitlement: entitlement }, { merge: true });
}

// Keep Attendance's copy of the entitlement in step with the subscription and contract (call after either changes). No subscription = nothing to write.
export async function syncEntitlement(orgId) {
  const sub = await getSubscription(orgId);
  if (!sub) return { synced: false };
  const contract = await getContract(orgId);
  await writeEntitlement(orgId, entitlementFor(sub, contract));
  return { synced: true };
}

async function context(orgId, today) {
  const [listing, contract, sub] = await Promise.all([listBooks(), getContract(orgId), getSubscription(orgId)]);
  const doc = bookInForce(listing.books, today, sub?.priceVersionId || contract?.pinnedVersion || "");
  return { listing, contract, sub, doc };
}

// ---- trial -------------------------------------------------------------------------------------------------------------------------
// One trial per organisation: the subscription document is created once and never again. No card, no charge.
export async function startTrial(actor, orgId, { counts = {}, cycle = "month", source = "self_trial" } = {}) {
  const cust = await adminDb().doc("customers/" + orgId).get();
  if (!cust.exists) throw fail(404, "Set up your business first.");
  const today = todayIst();
  const { doc, contract } = await context(orgId, today);
  if (!doc) throw fail(404, "Attendance pricing hasn't been published yet.");
  if (source === "self_trial" && !contract && Array.isArray(cust.data().subscription?.appKeys) && cust.data().subscription.appKeys.includes("attendance")) {
    throw fail(409, "Your organisation is on its current Attendance plan. Contact us if you would like to move to licence-based pricing.");
  }
  const days = Number(doc.book.trialDays) > 0 ? Number(doc.book.trialDays) : DEFAULT_TRIAL_DAYS;
  const sub = {
    organizationId: orgId, status: "trial", source, cycle: cycle === "year" ? "year" : "month", cycleStart: today, basis: contract?.billingBasis || "assigned",
    priceVersionId: contract?.pinnedVersion || "", trialStartedAt: nowIso(), trialEnds: addDays(today, days),
    billedCounts: cleanCounts(counts), changes: [], adjustments: [], gateway: null, createdAt: nowIso(), createdBy: actor.uid, createdByEmail: actor.email || "",
    history: [{ type: "trial_started", at: nowIso(), by: actor.uid, note: `${days} days, no charge` }],
  };
  try { await subs().doc(orgId).create(sub); }
  catch (e) { if (e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message))) throw fail(409, "This organisation has already used its Attendance trial."); throw e; }
  await writeEntitlement(orgId, entitlementFor(sub, contract));
  await logAuditEvent({ action: "attendance_subscription.trial_start", actor, targetType: "attendanceSubscription", targetId: orgId, details: { days, source } });
  return { ok: true, trialEnds: sub.trialEnds, days };
}

// ---- state, preview, confirm, undo -------------------------------------------------------------------------------------------------
export async function stateFor(orgId, { liveCounts = null } = {}) {
  const today = todayIst();
  const { sub, doc, contract } = await context(orgId, today);
  if (!sub) return { subscription: null, onLicencePricing: !!contract, priceVersion: doc?.version || null };
  const billed = cleanCounts(sub.billedCounts);
  const q = doc ? quote(doc.book, { counts: billed, cycle: sub.cycle, date: today }, contract) : null;
  const live = liveCounts ? cleanCounts(liveCounts) : null;
  // Differences between what is being billed and who is on each mode now (advisory — changes made outside the allocation screen).
  const unreconciled = live ? Object.fromEntries(MODES.map((m) => [m, live[m] - billed[m]]).filter(([, d]) => d !== 0)) : {};
  return {
    subscription: { ...sub, changes: (sub.changes || []).slice(-20), adjustments: (sub.adjustments || []).slice(-20), history: (sub.history || []).slice(-10) },
    access: accessFor(sub, today), trial: trialState(sub, today), quote: q, unreconciled, priceVersion: doc?.version || null, today,
    pendingAdjustments: r2((sub.adjustments || []).filter((a) => !a.invoiced).reduce((s, a) => s + a.amount, 0)),
    entitlement: entitlementFor(sub, contract),
  };
}
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export async function previewChange(orgId, { moves = [], faceTo = 0 } = {}) {
  const today = todayIst();
  const { sub, doc, contract } = await context(orgId, today);
  if (!sub) throw fail(404, "This organisation isn't on licence pricing yet.");
  if (!doc) throw fail(404, "Attendance pricing hasn't been published yet.");
  const access = accessFor(sub, today);
  if (access.access === "blocked") throw fail(402, "This subscription isn't active. Choose a plan to make changes.");
  return { ...planChange({ book: doc.book, contract, sub, moves: cleanMoves(moves), today, faceTo, entitlement: entitlementFor(sub, contract) }), access, subscriptionStatus: sub.status };
}
const cleanMoves = (moves) => (Array.isArray(moves) ? moves : []).slice(0, 50).map((m) => ({ from: MODES.includes(m.from) ? m.from : null, to: MODES.includes(m.to) ? m.to : null, count: Math.max(0, Math.min(100000, Math.floor(Number(m.count) || 0))) })).filter((m) => m.count > 0 && (m.from || m.to));

// Records a confirmed change. Idempotent: the same request is recorded once, one prorated adjustment. Never charges.
export async function confirmChange(actor, orgId, { moves = [], faceTo = 0, requestId = "" } = {}) {
  const today = todayIst();
  const plan = await previewChange(orgId, { moves, faceTo });
  if (plan.blocked) throw fail(403, plan.problems.find((p) => p.code === "not_entitled")?.message || "That change isn't included in your plan.");
  if (plan.noChange) throw fail(400, "Nothing to change.");
  if (!requestId) throw fail(400, "A request id is required so confirming twice can't record the change twice.");
  const clean = cleanMoves(moves);
  const { up, down } = classifyMoves(clean);
  const key = changeKey(orgId, { moves: clean, faceTo, requestId });
  const ref = subs().doc(orgId);
  const out = await adminDb().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const sub = { id: s.id, ...s.data() };
    if (alreadyRecorded(sub, key)) return { duplicate: true, plan };
    const at = nowIso();
    const changes = [...(sub.changes || [])];
    const id = `c_${changes.length + 1}_${Date.now().toString(36)}`;
    if (up.length) changes.push({ id: id + "u", key, kind: "upgrade", status: "applied", moves: up, effectiveOn: today, confirmedAt: at, by: actor.uid, byEmail: actor.email || "" });
    if (down.length) changes.push({ id: id + "d", key: key + "#d", kind: "downgrade", status: "scheduled", moves: down, effectiveOn: plan.effective.downgrades, undoUntil: plan.undoUntil, confirmedAt: at, by: actor.uid, byEmail: actor.email || "" });
    changes.push({ id: id + "k", key, kind: "confirm", status: "recorded", confirmedAt: at, by: actor.uid }); // the idempotency marker for the whole request
    const adjustments = [...(sub.adjustments || [])];
    if (plan.proration.amount > 0) adjustments.push({ id: id + "a", key, amount: plan.proration.amount, date: today, reason: `Upgrade for ${plan.proration.remainingDays} of ${plan.proration.cycleDays} days`, addedTo: "next invoice", invoiced: false });
    tx.update(ref, { billedCounts: plan.counts.today, changes, adjustments, history: [...(sub.history || []), { type: "change_confirmed", at, by: actor.uid, note: `${up.length} upgrade group(s), ${down.length} downgrade group(s)` }] });
    return { duplicate: false, plan, changeIds: { upgrade: up.length ? id + "u" : null, downgrade: down.length ? id + "d" : null } };
  });
  await logAuditEvent({ action: "attendance_subscription.change_confirm", actor, targetType: "attendanceSubscription", targetId: orgId, details: { duplicate: out.duplicate, proration: plan.proration.amount, upgrades: up.length, downgrades: down.length } });
  return { ok: true, duplicate: out.duplicate, plan: out.plan, changeIds: out.changeIds || null };
}

// A scheduled downgrade can be undone for 24 hours after it was confirmed.
export async function undoChange(actor, orgId, changeId) {
  const ref = subs().doc(orgId);
  const res = await adminDb().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw fail(404, "Subscription not found.");
    const sub = s.data();
    const ch = (sub.changes || []).find((c) => c.id === changeId);
    if (!ch) throw fail(404, "Change not found.");
    if (!canUndo(ch, Date.now())) throw fail(409, ch.status === "scheduled" ? `The ${UNDO_HOURS}-hour undo window has passed.` : "Only a scheduled downgrade can be undone.");
    tx.update(ref, { changes: sub.changes.map((c) => (c.id === changeId ? { ...c, status: "undone", undoneAt: nowIso(), undoneBy: actor.uid } : c)), history: [...(sub.history || []), { type: "downgrade_undone", at: nowIso(), by: actor.uid }] });
    return { ok: true };
  });
  await logAuditEvent({ action: "attendance_subscription.change_undo", actor, targetType: "attendanceSubscription", targetId: orgId, details: { changeId } });
  return res;
}

// Sales-assisted onboarding by authorised Bizzux staff: creates the subscription (trial or a manually-billed contracted start) without payment.
export async function onboardForOrg(actor, orgId, { counts = {}, cycle = "month", mode = "trial" } = {}) {
  if (mode === "trial") return startTrial(actor, orgId, { counts, cycle, source: "sales_assisted" });
  const cust = await adminDb().doc("customers/" + orgId).get();
  if (!cust.exists) throw fail(404, "Organisation not found.");
  const today = todayIst();
  const { doc, contract } = await context(orgId, today);
  if (!doc) throw fail(404, "Publish an Attendance price book first.");
  const sub = { organizationId: orgId, status: "active", source: "sales_assisted", cycle: cycle === "year" ? "year" : "month", cycleStart: today, basis: contract?.billingBasis || "assigned", priceVersionId: contract?.pinnedVersion || "", billedCounts: cleanCounts(counts), changes: [], adjustments: [], gateway: null, billing: "manual", createdAt: nowIso(), createdBy: actor.uid, createdByEmail: actor.email || "", history: [{ type: "contracted_start", at: nowIso(), by: actor.uid, note: "billed outside the portal until gateway billing is enabled" }] };
  try { await subs().doc(orgId).create(sub); } catch (e) { if (e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message))) throw fail(409, "This organisation already has an Attendance subscription."); throw e; }
  await writeEntitlement(orgId, entitlementFor(sub, contract));
  await logAuditEvent({ action: "attendance_subscription.onboard", actor, targetType: "attendanceSubscription", targetId: orgId, details: { mode } });
  return { ok: true, first: convertTrial({ book: doc.book, contract, counts, cycle, today }) };
}
export { totalPeople, cycleOf, applyMoves };

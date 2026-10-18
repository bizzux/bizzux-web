// SERVER ONLY. Firestore side of the Attendance price book — the rules live in lib/attendancePricing.js (pure, tested).
//
//   attendancePriceBooks/{id}     immutable versions: draft → pending_approval → scheduled | published (→ retired). Only drafts are edited.
//   attendanceContracts/{orgId}   per-customer terms: billing basis, pinned version (price protection), own rates, approved discounts, tier lock
//   attendanceCostModel/config    measured unit costs for the margin report
//
// Nothing here charges anyone or touches checkout / webhooks / existing subscriptions. Every write is audited.
import { adminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { logAuditEvent } from "./audit";
import {
  PROPOSED_BOOK, normalizeBook, validateBook, canEdit, approvalProblem, submitProblem, bookInForce, normalizeCostModel, MODES, quote, impactOf,
} from "./attendancePricing";

const books = () => adminDb().collection("attendancePriceBooks");
const nowIso = () => new Date().toISOString();
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const fail = (status, message) => ({ status, message });
const who = (a) => ({ uid: a.uid, email: a.email || "" });
const hist = (type, actor, note = "") => ({ type, at: nowIso(), by: actor.uid, byEmail: actor.email || "", ...(note ? { note } : {}) });

export async function listBooks() {
  const s = await books().get();
  const list = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.version || 0) - (a.version || 0));
  const inForce = bookInForce(list, todayIst());
  return { books: list, inForceId: inForce?.id || null, today: todayIst() };
}

async function load(id) {
  const s = await books().doc(String(id || "")).get();
  if (!s.exists) throw fail(404, "Price book version not found.");
  return { ref: s.ref, ...s.data(), id: s.id };
}

export async function createDraft(actor, { fromProposed = false, basedOn = "", name = "", note = "" } = {}) {
  let source = fromProposed ? PROPOSED_BOOK : null;
  if (!source && basedOn) source = (await load(basedOn)).book;
  if (!source) throw fail(400, "Start from the proposed numbers or copy an existing version.");
  const all = await books().get();
  const version = all.docs.reduce((m, d) => Math.max(m, d.data().version || 0), 0) + 1;
  const book = normalizeBook(source);
  const ref = await books().add({
    version, status: "draft", name: String(name || (fromProposed ? "Proposed numbers (not approved)" : `Copy of v${(await load(basedOn)).version}`)).slice(0, 80),
    note: String(note || (fromProposed ? "The numbers from the product brief. Proposals only: not approved, not measured for profitability." : "")).slice(0, 300),
    book, createdBy: actor.uid, createdByEmail: actor.email || "", createdAt: nowIso(), lastEditedBy: actor.uid, editors: [actor.uid], effectiveFrom: null,
    history: [hist("created", actor, fromProposed ? "from the proposed numbers" : `copied from ${basedOn}`)],
  });
  await logAuditEvent({ action: "attendance_pricing.draft_create", actor, targetType: "attendancePriceBook", targetId: ref.id, details: { version, fromProposed: !!fromProposed } });
  return { id: ref.id, version };
}

export async function updateDraft(actor, id, { book, name, note }) {
  const b = await load(id);
  if (!canEdit(b)) throw fail(409, "Only a draft can be edited. Copy this version to make changes.");
  const next = normalizeBook({ ...b.book, ...(book || {}) });
  if (book?.modePrices) next.modePrices = normalizeBook({ modePrices: { ...b.book.modePrices, ...book.modePrices } }).modePrices;
  if (book?.faceGps) next.faceGps = normalizeBook({ faceGps: { ...b.book.faceGps, ...book.faceGps } }).faceGps;
  const problems = validateBook({ ...next });
  await b.ref.update({
    book: next, ...(name !== undefined ? { name: String(name).slice(0, 80) } : {}), ...(note !== undefined ? { note: String(note).slice(0, 300) } : {}),
    lastEditedBy: actor.uid, editors: FieldValue.arrayUnion(actor.uid), history: [...(b.history || []), hist("edited", actor)],
  });
  await logAuditEvent({ action: "attendance_pricing.draft_edit", actor, targetType: "attendancePriceBook", targetId: id, details: { version: b.version } });
  return { ok: true, problems };
}

export async function discardDraft(actor, id) {
  const b = await load(id);
  if (!canEdit(b)) throw fail(409, "Only a draft can be discarded.");
  await b.ref.delete();
  await logAuditEvent({ action: "attendance_pricing.draft_discard", actor, targetType: "attendancePriceBook", targetId: id, details: { version: b.version } });
  return { ok: true };
}

export async function submitDraft(actor, id, effectiveFrom) {
  const b = await load(id);
  const problem = submitProblem(b, validateBook(b.book), effectiveFrom, todayIst());
  if (problem) throw fail(400, problem);
  await b.ref.update({ status: "pending_approval", effectiveFrom, submittedBy: actor.uid, submittedByEmail: actor.email || "", submittedAt: nowIso(), editors: FieldValue.arrayUnion(actor.uid), history: [...(b.history || []), hist("submitted", actor, `effective ${effectiveFrom}`)] });
  await logAuditEvent({ action: "attendance_pricing.submit", actor, targetType: "attendancePriceBook", targetId: id, details: { version: b.version, effectiveFrom } });
  return { ok: true };
}

export async function rejectSubmission(actor, id, note) {
  const b = await load(id);
  if (b.status !== "pending_approval") throw fail(409, "Only a version waiting for approval can be sent back.");
  const text = String(note || "").trim().slice(0, 300);
  if (!text) throw fail(400, "Say what needs to change.");
  await b.ref.update({ status: "draft", effectiveFrom: null, history: [...(b.history || []), hist("sent_back", actor, text)] });
  await logAuditEvent({ action: "attendance_pricing.send_back", actor, targetType: "attendancePriceBook", targetId: id, details: { version: b.version, note: text } });
  return { ok: true };
}

// Two-person publish: the approver must not be anyone who drafted, edited or submitted it.
export async function approveSubmission(actor, id) {
  const b = await load(id);
  const problem = approvalProblem(b, actor.uid);
  if (problem) throw fail(403, problem);
  const errors = validateBook(b.book);
  if (errors.length) throw fail(400, errors[0]);
  const today = todayIst();
  const status = b.effectiveFrom <= today ? "published" : "scheduled";
  await b.ref.update({ status, approvedBy: actor.uid, approvedByEmail: actor.email || "", approvedAt: nowIso(), history: [...(b.history || []), hist("approved", actor, `${status}, effective ${b.effectiveFrom}`)] });
  await logAuditEvent({ action: "attendance_pricing.publish", actor, targetType: "attendancePriceBook", targetId: id, details: { version: b.version, status, effectiveFrom: b.effectiveFrom } });
  return { ok: true, status };
}

// ---- contracts ---------------------------------------------------------------------------------------------------------------------
const contracts = () => adminDb().collection("attendanceContracts");
export async function getContract(orgId) { const s = await contracts().doc(String(orgId)).get(); return s.exists ? { id: s.id, ...s.data() } : null; }
export async function listContracts(limit = 200) { return (await contracts().limit(limit).get()).docs.map((d) => ({ id: d.id, ...d.data() })); }

const money = (v, label) => { const n = Number(v); if (!(n >= 0)) throw fail(400, `${label} must be 0 or more.`); return Math.round(n * 100) / 100; };
// `approvals` = true when the caller may approve discounts (Owner): fixed discounts, stacking and tiers that need approval.
export async function saveContract(actor, orgId, b, { approvals = false } = {}) {
  if (!orgId) throw fail(400, "Choose an organisation.");
  const cust = await adminDb().doc("customers/" + orgId).get();
  if (!cust.exists) throw fail(404, "Organisation not found.");
  const prev = await getContract(orgId);
  // A save only changes what it sends: anything left out keeps its previous value (so, for example, a Billing Admin's edit can't drop the
  // pinned version or an Owner-approved discount by omission). Send "" / null to clear a field on purpose.
  b = { ...(prev || {}), ...Object.fromEntries(Object.entries(b || {}).filter(([, v]) => v !== undefined)) };
  const out = {
    organizationId: orgId,
    billingBasis: b.billingBasis === "purchased" ? "purchased" : "assigned",
    purchased: Object.fromEntries(MODES.map((m) => [m, Math.max(0, Math.floor(Number(b.purchased?.[m]) || 0))])),
    notes: String(b.notes || "").slice(0, 500),
  };
  if (b.pinnedVersion) { const v = await load(b.pinnedVersion); if (!["published", "scheduled", "retired"].includes(v.status)) throw fail(400, "Pin a published version."); out.pinnedVersion = v.id; } else out.pinnedVersion = "";
  for (const k of ["baseFee", "faceGpsPrice", "minimumMonthlyFee"]) if (b[k] !== undefined && b[k] !== null && b[k] !== "") out[k] = money(b[k], k); else out[k] = null;
  out.modePrices = {};
  for (const m of MODES) if (b.modePrices?.[m] !== undefined && b.modePrices[m] !== "" && b.modePrices[m] !== null) out.modePrices[m] = money(b.modePrices[m], `${m} price`);
  // Discounts that differ from the published book are an authorised-administrator decision (Owner): keep what was there unless approved now.
  const keep = (k, d) => (prev && prev[k] !== undefined ? prev[k] : d);
  if (approvals) {
    out.fixedDiscountPct = b.fixedDiscountPct === null || b.fixedDiscountPct === undefined || b.fixedDiscountPct === "" ? null : Math.min(100, money(b.fixedDiscountPct, "Discount"));
    out.stackDiscounts = b.stackDiscounts === true;
    out.approvedTiers = [...new Set((Array.isArray(b.approvedTiers) ? b.approvedTiers : []).map((x) => Math.floor(Number(x))).filter((x) => x > 1))];
    out.discountApprovedBy = actor.uid; out.discountApprovedAt = nowIso();
  } else {
    out.fixedDiscountPct = keep("fixedDiscountPct", null); out.stackDiscounts = keep("stackDiscounts", false); out.approvedTiers = keep("approvedTiers", []);
    if (b.fixedDiscountPct != null && b.fixedDiscountPct !== "" && Number(b.fixedDiscountPct) !== out.fixedDiscountPct) throw fail(403, "A discount that differs from the published book must be approved by the Platform Owner.");
    if (b.stackDiscounts === true && !out.stackDiscounts) throw fail(403, "Stacking discounts must be approved by the Platform Owner.");
  }
  if (b.tierLock) out.tierLock = { pct: Math.min(100, money(b.tierLock.pct, "Locked discount")), until: String(b.tierLock.until || "") }; else out.tierLock = keep("tierLock", null);
  if (out.tierLock && !/^\d{4}-\d{2}-\d{2}$/.test(out.tierLock.until)) throw fail(400, "Choose the date the tier lock ends.");
  out.updatedAt = nowIso(); out.updatedBy = actor.uid; out.updatedByEmail = actor.email || "";
  out.history = [...(prev?.history || []), hist(prev ? "updated" : "created", actor)].slice(-50);
  await contracts().doc(orgId).set(out, { merge: false });
  await logAuditEvent({ action: "attendance_pricing.contract_save", actor, targetType: "attendanceContract", targetId: orgId, details: { basis: out.billingBasis, pinned: out.pinnedVersion || null, discountChanged: approvals } });
  return { ok: true };
}

// ---- cost model --------------------------------------------------------------------------------------------------------------------
export async function getCostModel() { const s = await adminDb().doc("attendanceCostModel/config").get(); return normalizeCostModel(s.exists ? s.data() : {}); }
export async function saveCostModel(actor, input) {
  const model = normalizeCostModel(input);
  await adminDb().doc("attendanceCostModel/config").set({ ...model, updatedAt: nowIso(), updatedBy: actor.uid }, { merge: true });
  await logAuditEvent({ action: "attendance_pricing.cost_model_save", actor, targetType: "attendanceCostModel", targetId: "config", details: model });
  return { ok: true, model };
}

// ---- who is on the new model, and what publishing would do to them -----------------------------------------------------------------
// Only organisations with a contract are on the licence model; everyone else stays on their current plan and is untouched.
export async function usageFor(orgId) {
  const s = await adminDb().doc(`customers/${orgId}/attLicenceUsage/current`).get();
  return s.exists ? s.data() : null;
}
export async function impactFor(newBookDoc, listing) {
  const cs = await listContracts();
  const orgs = [];
  for (const c of cs) {
    const u = await usageFor(c.id);
    orgs.push({ id: c.id, name: c.id, counts: u?.counts || {}, faceGpsCount: u?.faceGps || 0, cycle: u?.cycle || "month", contract: c, pinned: !!c.pinnedVersion });
  }
  const oldBook = bookInForce(listing.books, listing.today);
  return impactOf(oldBook?.book || null, newBookDoc.book, orgs);
}
export { quote, bookInForce, todayIst };

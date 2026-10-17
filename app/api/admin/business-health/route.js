import { NextResponse } from "next/server";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";
import { logAuditEvent } from "@/lib/audit";
import { dateKey, addDays } from "@/lib/costAnalytics";
import { FieldValue } from "firebase-admin/firestore";
import {
  computeRevenue, computeOpex, computeCloud, computeCapital, computeSummary, scenarioBase, mergeSettings,
  validateExpense, validateCapital, validateCash, validateScenario, validateSettings, monthKey, CATEGORY_KEYS,
} from "@/lib/businessHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Super Admin -> Business Health: the platform owner's CONSOLIDATED view of
// earning, spending, cash and break-even. It is deliberately not a ledger
// (that is Bizzux Finance). Every calculation lives in lib/businessHealth.js;
// this route only loads the inputs, calls it, and writes owner edits.
//
// Collections (all additive; platformFinance/costs is the legacy doc and is
// never modified or deleted by this route):
//   bhExpenses/{id}   operating expense lines (category, cadence, status)
//   bhCapital/{id}    investments, refundable deposits, funding
//   bhCash/{id}       dated cash-balance snapshots
//   bhScenarios/{id}  saved what-if scenarios
//   platformFinance/settings   GST / gateway fee / assumed ARPA / legacy-import marker
// Everyone with Super Admin access can view; only the Platform Owner can write.
// Every write is recorded in auditLogs (action "businessHealth.*").

const COLL = { expense: "bhExpenses", capital: "bhCapital", cash: "bhCash", scenario: "bhScenarios" };
const LIMIT = 500;

const plain = (d) => {
  const o = { id: d.id, ...d.data() };
  for (const k of Object.keys(o)) if (o[k]?.toDate) o[k] = o[k].toDate().toISOString();
  return o;
};

export async function GET(req) {
  try {
    await requireSuperAdmin(req);
    const db = adminDb();
    const today = dateKey();
    const from = addDays(today, -29); // trailing 30 days -> monthly run rate
    const [custSnap, exSnap, capSnap, cashSnap, scSnap, setSnap, legacySnap, costSnap] = await Promise.all([
      db.collection("customers").get(),
      db.collection(COLL.expense).limit(LIMIT).get(),
      db.collection(COLL.capital).limit(LIMIT).get(),
      db.collection(COLL.cash).orderBy("date", "desc").limit(60).get(),
      db.collection(COLL.scenario).limit(50).get(),
      db.doc("platformFinance/settings").get(),
      db.doc("platformFinance/costs").get(),
      db.collection("costAnalyticsDaily").where("date", ">=", from).where("date", "<=", today).get(),
    ]);

    const settings = mergeSettings(setSnap.exists ? setSnap.data() : {});
    const customers = custSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const expenses = exSnap.docs.map(plain).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
    const capitalItems = capSnap.docs.map(plain).sort((a, b) => (a.date < b.date ? 1 : -1));
    const cashSnaps = cashSnap.docs.map(plain);
    const scenarios = scSnap.docs.map(plain);
    const m = monthKey(today);

    const revenue = computeRevenue(customers, settings);
    const opex = computeOpex(expenses, m, false);
    const cloud = computeCloud(costSnap.docs.map((d) => d.data()), expenses, m);
    const capital = computeCapital(capitalItems, cashSnaps);
    const cutoff = Date.now() - 90 * 864e5;
    const newPayingLast90 = revenue.lines.filter((l) => l.since && Date.parse(l.since) >= cutoff).length;
    const summary = computeSummary({
      revenue, opex, cloud, capital, settings, newPayingLast90,
      snapshotMonthSalesMarketing: opex.byCategory.sales_marketing.total,
    });

    // Legacy platformFinance/costs rows that haven't been moved yet.
    const legacy = legacySnap.exists ? legacySnap.data() : null;
    const importedAt = setSnap.exists ? setSnap.data().legacyImportedAt : null;
    const legacyPending = !importedAt && legacy && ((legacy.recurring || []).length || (legacy.oneTime || []).length)
      ? {
          recurring: (legacy.recurring || []).map((r, i) => ({ index: i, label: r.label, amount: Number(r.amount) || 0 })),
          oneTime: (legacy.oneTime || []).map((r, i) => ({ index: i, label: r.label, amount: Number(r.amount) || 0 })),
          assumedAvgRevenue: Number(legacy.assumedAvgRevenue) || 0,
        }
      : null;

    const dataQuality = [];
    if (!opex.configured) dataQuality.push("No operating expenses have been entered yet, so cost, profit and break-even are not shown.");
    if (!cloud.configured) dataQuality.push("No cloud cost data in the last 30 days. Add Vercel/Firebase lines or check the FinOps import.");
    else if (cloud.basis === "estimate") dataQuality.push("Cloud cost is partly an estimate (not yet billed). Enter the Vercel/Firebase invoice or sync billing to make it actual.");
    if (!capital.cash) dataQuality.push("No cash balance recorded, so runway can't be calculated.");
    else if (capital.cash.stale) dataQuality.push(`The last cash balance is ${capital.cash.ageDays} days old.`);
    if (revenue.skippedNonInr) dataQuality.push(`${revenue.skippedNonInr} non-INR subscription(s) are excluded from INR figures.`);
    if (!revenue.reconciles) dataQuality.push("Product revenue does not reconcile to MRR. Please report this.");
    if (settings.gatewayFeePct === null) dataQuality.push("Payment gateway fee % isn't set, so contribution margin ignores it.");

    return NextResponse.json({
      asOf: today, month: m, settings, revenue, opex, cloud, capital, summary, scenarioBase: scenarioBase({ summary, opex, cloud, settings }),
      expenses, capitalItems, cashSnaps, scenarios, legacyPending, dataQuality,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

const fail = (status, message) => { throw { status, message }; };

export async function POST(req) {
  try {
    const actor = await requireSuperAdmin(req);
    if (actor.platformRole !== "OWNER") fail(403, "Only the Platform Owner can change Business Health data.");
    const b = await req.json();
    const db = adminDb();
    const audit = (action, targetId, details) => logAuditEvent({ action: "businessHealth." + action, actor, targetType: "businessHealth", targetId, details });
    const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email };

    // Create-or-update a validated record in one collection.
    const upsert = async (kind, validate, name) => {
      const v = validate(b);
      if (!v.ok) fail(400, v.error);
      if (b.id) {
        const ref = db.collection(COLL[kind]).doc(String(b.id));
        const cur = await ref.get();
        if (!cur.exists) fail(404, "That record no longer exists.");
        await ref.set({ ...v.value, ...stamp }, { merge: true });
        await audit(name + ".update", ref.id, { before: cur.data(), after: v.value });
        return ref.id;
      }
      const ref = await db.collection(COLL[kind]).add({ ...v.value, createdAt: FieldValue.serverTimestamp(), createdBy: actor.email, ...stamp });
      await audit(name + ".create", ref.id, { after: v.value });
      return ref.id;
    };
    // Nothing is hard-deleted: archiving hides a record from every figure but keeps it (and the audit trail).
    const archive = async (kind, name) => {
      const ref = db.collection(COLL[kind]).doc(String(b.id || ""));
      const cur = await ref.get();
      if (!cur.exists) fail(404, "That record no longer exists.");
      await ref.set({ archivedAt: FieldValue.serverTimestamp(), archivedBy: actor.email }, { merge: true });
      await audit(name + ".archive", ref.id, { before: cur.data() });
    };

    switch (b.action) {
      case "saveExpense": return NextResponse.json({ ok: true, id: await upsert("expense", validateExpense, "expense") });
      case "archiveExpense": await archive("expense", "expense"); return NextResponse.json({ ok: true });
      case "saveCapital": return NextResponse.json({ ok: true, id: await upsert("capital", validateCapital, "capital") });
      case "archiveCapital": await archive("capital", "capital"); return NextResponse.json({ ok: true });
      case "addCash": return NextResponse.json({ ok: true, id: await upsert("cash", validateCash, "cash") });
      case "archiveCash": await archive("cash", "cash"); return NextResponse.json({ ok: true });
      case "saveScenario": return NextResponse.json({ ok: true, id: await upsert("scenario", validateScenario, "scenario") });
      case "deleteScenario": {
        // Scenarios are just saved sliders (no financial record), so these are really removed.
        const ref = db.collection(COLL.scenario).doc(String(b.id || ""));
        const cur = await ref.get();
        if (!cur.exists) fail(404, "That scenario no longer exists.");
        await ref.delete();
        await audit("scenario.delete", ref.id, { before: cur.data() });
        return NextResponse.json({ ok: true });
      }
      case "refundDeposit": {
        const ref = db.collection(COLL.capital).doc(String(b.id || ""));
        const cur = await ref.get();
        if (!cur.exists || cur.data().type !== "deposit") fail(404, "Deposit not found.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.refundedOn || ""))) fail(400, "Enter the refund date.");
        await ref.set({ refundedOn: b.refundedOn, ...stamp }, { merge: true });
        await audit("deposit.refund", ref.id, { refundedOn: b.refundedOn, amount: cur.data().amount });
        return NextResponse.json({ ok: true });
      }
      case "saveSettings": {
        const v = validateSettings(b.settings || {});
        if (!v.ok) fail(400, v.error);
        const ref = db.doc("platformFinance/settings");
        const cur = await ref.get();
        await ref.set({ ...v.value, ...stamp }, { merge: true });
        await audit("settings.update", "settings", { before: cur.exists ? cur.data() : null, after: v.value });
        return NextResponse.json({ ok: true });
      }
      case "importLegacy": {
        // One-time, owner-confirmed move of platformFinance/costs rows into the new
        // structure. The legacy document is left exactly as it was (rollback = ignore this).
        const setRef = db.doc("platformFinance/settings");
        const [setSnap, legacySnap] = await Promise.all([setRef.get(), db.doc("platformFinance/costs").get()]);
        if (setSnap.exists && setSnap.data().legacyImportedAt) fail(409, "Legacy costs were already imported.");
        if (!legacySnap.exists) fail(404, "There are no legacy costs to import.");
        const legacy = legacySnap.data();
        const today = dateKey();
        const batch = db.batch();
        let ex = 0, cap = 0;
        for (const row of Array.isArray(b.rows) ? b.rows : []) {
          const src = row.source === "oneTime" ? (legacy.oneTime || [])[row.index] : (legacy.recurring || [])[row.index];
          if (!src) continue;
          if (row.source === "oneTime") {
            const v = validateCapital({ label: src.label, type: "investment", amount: src.amount, date: today, notes: "Imported from legacy one-time costs" });
            if (!v.ok) fail(400, `"${src.label}": ${v.error}`);
            batch.set(db.collection(COLL.capital).doc(), { ...v.value, createdAt: FieldValue.serverTimestamp(), createdBy: actor.email, ...stamp, importedFromLegacy: true });
            cap += 1;
          } else {
            if (!CATEGORY_KEYS.includes(row.category)) fail(400, `Choose a category for "${src.label}".`);
            const v = validateExpense({ label: src.label, category: row.category, cadence: "monthly", amount: src.amount, startDate: row.startDate || today, status: "actual", notes: "Imported from legacy recurring costs" });
            if (!v.ok) fail(400, `"${src.label}": ${v.error}`);
            batch.set(db.collection(COLL.expense).doc(), { ...v.value, createdAt: FieldValue.serverTimestamp(), createdBy: actor.email, ...stamp, importedFromLegacy: true });
            ex += 1;
          }
        }
        const extra = {};
        if (Number(legacy.assumedAvgRevenue) > 0 && setSnap.data()?.assumedArpa == null) extra.assumedArpa = Number(legacy.assumedAvgRevenue);
        batch.set(setRef, { ...extra, legacyImportedAt: FieldValue.serverTimestamp(), legacyImportedBy: actor.email, ...stamp }, { merge: true });
        await batch.commit();
        await audit("legacy.import", "platformFinance/costs", { expenses: ex, capital: cap });
        return NextResponse.json({ ok: true, expenses: ex, capital: cap });
      }
      default: fail(400, "Unknown action.");
    }
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

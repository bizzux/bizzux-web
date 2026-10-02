import { NextResponse } from "next/server";
import { requireSuperAdmin, requirePlatformOwner, adminDb } from "@/lib/firebaseAdmin";
import { logAuditEvent } from "@/lib/audit";
import { buildDashboard, dateKey, addDays, isDateKey, monthStart, DEFAULT_RATES, mergeRates } from "@/lib/costAnalytics";
import { loadSyncStatus, billingConfigured, syncBilling, recordSyncError } from "@/lib/billingBigQuery";
import { loadRange, loadRates, loadTenants, materializeDays, dateRange } from "@/lib/usageMetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_DAYS = 366;

function parseRange(sp) {
  const today = dateKey();
  let to = sp.get("to") || today;
  let from = sp.get("from") || addDays(to, -29);
  if (!isDateKey(from) || !isDateKey(to)) throw { status: 400, message: "Dates must be YYYY-MM-DD" };
  if (to > today) to = today;
  if (from > to) throw { status: 400, message: "'from' must not be after 'to'" };
  if (dateRange(from, to).length > MAX_DAYS) throw { status: 400, message: `Range is limited to ${MAX_DAYS} days` };
  return { from, to };
}

// Platform Admin/Owner. Reads ONLY the two daily-aggregate collections
// (date-ranged) plus the customers registry — no transactional scans. See
// lib/costAnalytics.js for the data flow.
export async function GET(req) {
  try {
    await requireSuperAdmin(req);
    const { from, to } = parseRange(new URL(req.url).searchParams);
    // Month-to-date cost needs the start of the month even if the picked range starts later.
    const fetchFrom = monthStart(to) < from ? monthStart(to) : from;

    const [rates, tenants, { usageByDate, days }] = await Promise.all([loadRates(), loadTenants(), loadRange(fetchFrom, to)]);
    await materializeDays(dateRange(fetchFrom, to), usageByDate, days, rates, tenants);

    // KPIs for the picked range; month-to-date is derived inside from days >= month start.
    const data = buildDashboard({ from: fetchFrom, to, usageByDate, days, tenants, rates, today: dateKey() });
    // buildDashboard covered fetchFrom..to for month cost; recompute the picked range for everything else.
    const picked = fetchFrom === from ? data : buildDashboard({ from, to, usageByDate, days, tenants, rates, today: dateKey() });
    if (picked !== data) { picked.kpis.cost.currentMonthCost = data.kpis.cost.currentMonthCost; picked.finops = data.finops; picked.alerts = data.alerts; picked.unitEconomics.monthCost = data.unitEconomics.monthCost; picked.unitEconomics.projectedMonthCost = data.unitEconomics.projectedMonthCost; }
    return NextResponse.json({ ...picked, rates, defaultRates: DEFAULT_RATES, today: dateKey(), billing: await loadSyncStatus() });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

// { action: "rebuild", from, to }  any Platform Admin — recompute the daily
//                                  cost docs (e.g. after editing the rates)
// { action: "rates", rates: {...} } Platform Owner only — edit the rate card
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "rates") {
      const c = await requirePlatformOwner(req);
      const rates = mergeRates(body.rates);
      await adminDb().doc("platformFinance/costRates").set({ ...rates, updatedAt: new Date(), updatedBy: c.email });
      await logAuditEvent({ action: "cost_rates_updated", actor: c, targetType: "platformFinance", targetId: "costRates", details: rates });
      return NextResponse.json({ ok: true, rates });
    }
    if (body.action === "syncBilling") {
      await requireSuperAdmin(req);
      const to = dateKey();
      try {
        const out = await syncBilling(addDays(to, -35), to);
        return NextResponse.json({ ok: true, ...out });
      } catch (e) {
        if (billingConfigured()) await recordSyncError(e.message);
        throw e;
      }
    }
    if (body.action === "rebuild") {
      await requireSuperAdmin(req);
      const sp = new URLSearchParams({ from: body.from || "", to: body.to || "" });
      if (!body.from) sp.delete("from");
      if (!body.to) sp.delete("to");
      const { from, to } = parseRange(sp);
      const [rates, tenants, { usageByDate, days }] = await Promise.all([loadRates(), loadTenants(), loadRange(from, to)]);
      const n = await materializeDays(dateRange(from, to), usageByDate, days, rates, tenants, { force: true });
      return NextResponse.json({ ok: true, rebuilt: n });
    }
    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

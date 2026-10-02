import { NextResponse } from "next/server";
import { dateKey, addDays } from "@/lib/costAnalytics";
import { billingConfigured, syncBilling, recordSyncError } from "@/lib/billingBigQuery";
import { buildDashboard } from "@/lib/costAnalytics";
import { notifyHighAlerts } from "@/lib/costAlerts";
import { loadRange, loadRates, loadTenants, materializeDays, dateRange } from "@/lib/usageMetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Daily (vercel.json crons): finalises costAnalyticsDaily for the last week
// so history exists even if nobody opens the dashboard, and so late-synced
// usage and any imported Google Cloud Billing figures are folded in.
// Vercel calls this with "Authorization: Bearer <CRON_SECRET>".
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== "Bearer " + secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const to = dateKey();
    const from = addDays(to, -8);
    // Real billing first (when the BigQuery export is connected), so the rollup below folds it in.
    let billing = null;
    if (billingConfigured()) {
      try { billing = await syncBilling(addDays(to, -35), to); } catch (e) { await recordSyncError(e.message); billing = { error: e.message }; }
    }
    const [rates, tenants, { usageByDate, days }] = await Promise.all([loadRates(), loadTenants(), loadRange(from, to)]);
    const written = await materializeDays(dateRange(from, to), usageByDate, days, rates, tenants, { force: true });
    // Alert the Platform Owner by email about abnormal usage (best effort).
    let alerted = 0;
    try {
      const a0 = addDays(to, -29);
      const r = await loadRange(a0, to);
      const dash = buildDashboard({ from: a0, to, usageByDate: r.usageByDate, days: r.days, tenants, rates, today: to });
      alerted = (await notifyHighAlerts(dash.alerts)).sent;
    } catch {}
    return NextResponse.json({ ok: true, from, to, written, billing, alerted });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

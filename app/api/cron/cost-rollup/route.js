import { NextResponse } from "next/server";
import { dateKey, addDays } from "@/lib/costAnalytics";
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
    const [rates, tenants, { usageByDate, days }] = await Promise.all([loadRates(), loadTenants(), loadRange(from, to)]);
    const written = await materializeDays(dateRange(from, to), usageByDate, days, rates, tenants, { force: true });
    return NextResponse.json({ ok: true, from, to, written });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

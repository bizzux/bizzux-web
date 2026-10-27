import { NextResponse } from "next/server";
import { purgeExpiredArchives } from "@/lib/orgLifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily (vercel.json crons): removes archived organizations whose 30-day
// recovery window has ended, unless billing, legal hold/retention or a
// dependency blocks it (those stay archived, with the reason recorded).
// Vercel calls this with "Authorization: Bearer <CRON_SECRET>".
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== "Bearer " + secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await purgeExpiredArchives({});
  return NextResponse.json({ ok: !results.some((r) => r.result === "incomplete" || r.result === "error"), results });
}

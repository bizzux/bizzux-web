import { NextResponse } from "next/server";
import { runSupportRetention } from "@/lib/supportRetention";
import { supportBlob } from "@/lib/supportBlob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily (vercel.json crons): removes support screenshots past their retention
// period and uploads that were never attached to a case (lib/supportRetention.js).
// Vercel calls it with "Authorization: Bearer <CRON_SECRET>". Add ?dryRun=1 to
// see what WOULD be removed without deleting anything. The response lists the
// Firestore reads/writes and file deletions it performed.
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== "Bearer " + secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const result = await runSupportRetention({ blob: supportBlob, dryRun });
  return NextResponse.json({ ok: true, ...result });
}

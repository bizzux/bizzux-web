import { NextResponse } from "next/server";
import { reindexBatch } from "@/lib/orgDirectory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Nightly repair of organizationDirectory (the Organizations search index).
// Writes keep it fresh as they happen; this catches anything that changes a
// customer outside those paths (payment webhooks, direct edits). Vercel calls
// it with "Authorization: Bearer <CRON_SECRET>". Reads about 3-4 documents and
// writes 1 per organization, once a day.
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== "Bearer " + secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let after = null, total = { processed: 0, writes: 0, reads: 0 };
  for (let i = 0; i < 50; i++) {
    const r = await reindexBatch({ after, budgetMs: 200000 });
    total = { processed: total.processed + r.processed, writes: total.writes + r.writes, reads: total.reads + r.reads };
    after = r.next;
    if (!after) break;
  }
  return NextResponse.json({ ok: true, ...total, complete: !after });
}

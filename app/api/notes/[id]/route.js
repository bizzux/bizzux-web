import { NextResponse } from "next/server";
import { requireUser, resolveAccount, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

export async function GET(req, { params }) {
  try {
    const c = await requireUser(req);
    const acct = await resolveAccount(c.uid);
    const ref = adminDb().doc(`customers/${acct.accountId}/notesMeetings/${params.id}`);
    const snap = await ref.get();
    if (!snap.exists) throw { status: 404, message: "Meeting not found" };
    const m = snap.data();
    return NextResponse.json({
      meeting: {
        id: snap.id,
        title: m.title || "Untitled meeting",
        status: m.status || "recording",
        startedAt: toIso(m.startedAt),
        endedAt: toIso(m.endedAt),
        durationSec: m.durationSec ?? null,
        transcript: m.transcript || { text: "", segments: [] },
        hasAudio: !!m.audioBlobPath,
        summary: m.summary || null,
        summaryStatus: m.summaryStatus || "pending",
        error: m.error || null,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

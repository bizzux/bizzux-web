import { NextResponse } from "next/server";
import { requireUser, resolveAccount, adminDb } from "@/lib/firebaseAdmin";
import { get } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Streams a meeting's private recording back for the <audio> player on the
// meeting detail page. Same "private blob, proxied through an authenticated
// route" pattern as /api/admin/resume-file — inline playback instead of a
// forced download. Note: this serves the full file on every request rather
// than honoring Range/seek requests (the @vercel/blob SDK's get() doesn't
// document byte-range support), so scrubbing ahead of what's buffered isn't
// available in v1 — playback itself works fine.
export async function GET(req, { params }) {
  try {
    const c = await requireUser(req);
    const acct = await resolveAccount(c.uid);
    const snap = await adminDb().doc(`customers/${acct.accountId}/notesMeetings/${params.id}`).get();
    if (!snap.exists) throw { status: 404, message: "Meeting not found" };
    const m = snap.data();
    if (!m.audioBlobPath) throw { status: 404, message: "No recording on file for this meeting" };

    const result = await get(m.audioBlobPath, { access: "private" });
    if (!result || result.statusCode !== 200) {
      throw { status: 404, message: "Recording could not be found in storage" };
    }

    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": m.audioContentType || result.blob.contentType || "audio/webm",
        "Content-Length": String(result.blob.size),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not load the recording." }, { status: e.status || 500 });
  }
}

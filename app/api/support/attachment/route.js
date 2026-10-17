import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebaseAdmin";
import { CORS_HEADERS, corsPreflight } from "@/lib/cors";
import { myCaseAttachment } from "@/lib/supportCases";
import { supportBlob } from "@/lib/supportBlob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A customer viewing a screenshot on their OWN case (ownership checked on the
// server; anyone else gets the same "not found").
export function OPTIONS() { return corsPreflight(); }

export async function GET(req) {
  try {
    const user = await requireUser(req);
    const u = new URL(req.url);
    const a = await myCaseAttachment({ user, id: u.searchParams.get("case"), index: u.searchParams.get("i") });
    const r = await supportBlob.get(a.path);
    if (!r || r.statusCode !== 200) throw { status: 404, message: "Attachment not found" };
    return new NextResponse(r.stream, {
      headers: { ...CORS_HEADERS, "Content-Type": a.contentType, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500, headers: CORS_HEADERS });
  }
}

import { NextResponse } from "next/server";
import { requireUser, resolveAccount } from "@/lib/firebaseAdmin";
import { CORS_HEADERS_WRITE, corsPreflightWrite } from "@/lib/cors";
import { storeCaseAttachment, MAX_UPLOAD_BYTES } from "@/lib/supportCases";
import { supportBlob } from "@/lib/supportBlob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One screenshot per request (multipart field "file"). The app downsizes
// images first so they fit Vercel's request-body limit; the server re-checks
// size and the real image type from the bytes before storing it privately
// under support/<org>/<uid>/. Nothing is public and nothing is linked to a case
// until the case itself is created.
export function OPTIONS() { return corsPreflightWrite(); }

export async function POST(req) {
  try {
    const user = await requireUser(req);
    const acct = await resolveAccount(user.uid);
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_UPLOAD_BYTES + 64 * 1024) throw { status: 413, message: "That image is too large. Screenshots are limited to 5 MB; try a smaller one." };
    const form = await req.formData();
    const f = form.get("file");
    if (!f || typeof f.arrayBuffer !== "function") throw { status: 400, message: "No file received" };
    const buf = Buffer.from(await f.arrayBuffer());
    const stored = await storeCaseAttachment({ acct, uid: user.uid, file: buf, blob: supportBlob });
    return NextResponse.json({ ok: true, attachment: { ...stored, name: String(f.name || "screenshot").slice(0, 120) } }, { headers: CORS_HEADERS_WRITE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Upload failed" }, { status: e.status || 500, headers: CORS_HEADERS_WRITE });
  }
}

import { NextResponse } from "next/server";
import { requireUser, resolveAccount, adminDb } from "@/lib/firebaseAdmin";
import { get } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Streams a binary file's private blob back — same "private blob, proxied
// through an authenticated route" pattern as app/api/admin/resume-file.
// Plain .txt files never hit this route; the client builds their download
// straight from the text content it already has (see files/page.js).
export async function GET(req, { params }) {
  try {
    const c = await requireUser(req);
    const acct = await resolveAccount(c.uid);
    const snap = await adminDb().doc(`customers/${acct.accountId}/textFiles/${params.id}`).get();
    if (!snap.exists) throw { status: 404, message: "File not found" };
    const f = snap.data();
    if (!f.blobPath) throw { status: 404, message: "This file has no downloadable content" };

    // Explicit token, not env auto-detection — see the note in the
    // duplicate-file handler in app/api/files/route.js for why.
    const result = await get(f.blobPath, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN });
    if (!result || result.statusCode !== 200) {
      throw { status: 404, message: "File could not be found in storage" };
    }

    const filename = (f.title || "file").replace(/[\r\n"]/g, "_") + (f.ext ? "." + f.ext : "");
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": f.contentType || result.blob.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not load the file." }, { status: e.status || 500 });
  }
}

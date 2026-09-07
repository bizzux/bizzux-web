import { NextResponse } from "next/server";
import { requireUser, resolveAccount, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Full file (including content) for the detail/download view — kept
// separate from the list route so listing never has to ship every file's
// full text just to render a table.
export async function GET(req, { params }) {
  try {
    const c = await requireUser(req);
    const acct = await resolveAccount(c.uid);
    const ref = adminDb().doc(`customers/${acct.accountId}/textFiles/${params.id}`);
    const snap = await ref.get();
    if (!snap.exists) throw { status: 404, message: "File not found" };
    const f = snap.data();
    return NextResponse.json({
      file: {
        id: snap.id,
        title: f.title,
        content: f.content || null,
        ext: f.ext || "txt",
        hasBlob: !!f.blobPath,
        folderId: f.folderId || null,
        sizeBytes: f.sizeBytes || 0,
        createdAt: f.createdAt?.toDate ? f.createdAt.toDate().toISOString() : f.createdAt,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

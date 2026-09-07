import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireLiveShare } from "@/lib/shareLinks";
import { get } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUBLIC (guest-token gated) — streams a binary file back for download.
// A guest may only download a file that's either the shared target itself
// (targetType "file") or currently sitting inside the shared folder
// (targetType "folder") — never an arbitrary file id from elsewhere in the
// owner's account, even though this route technically has admin-level
// Firestore access under the hood.
export async function GET(req, { params }) {
  try {
    const { share } = await requireLiveShare(req, params.shareId);
    const fileId = new URL(req.url).searchParams.get("fileId") || share.targetId;

    const snap = await adminDb().doc(`customers/${share.accountId}/textFiles/${fileId}`).get();
    if (!snap.exists || snap.data().deletedAt) throw { status: 404, message: "File not found" };
    const f = snap.data();

    const allowed = share.targetType === "file" ? fileId === share.targetId : f.folderId === share.targetId;
    if (!allowed) throw { status: 403, message: "That file isn't part of this share." };
    if (!f.blobPath) throw { status: 404, message: "This file has no downloadable content" };

    const result = await get(f.blobPath, { access: "private" });
    if (!result || result.statusCode !== 200) throw { status: 404, message: "File could not be found in storage" };

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

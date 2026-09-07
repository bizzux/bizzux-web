import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireLiveShare } from "@/lib/shareLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

// PUBLIC (guest-token gated, not Firebase auth) — returns the shared
// folder's file listing, or a single shared file's own metadata (never
// its full content/blob here; that's /api/share/[shareId]/download).
export async function GET(req, { params }) {
  try {
    const { share } = await requireLiveShare(req, params.shareId);

    if (share.targetType === "file") {
      const snap = await adminDb().doc(`customers/${share.accountId}/textFiles/${share.targetId}`).get();
      if (!snap.exists || snap.data().deletedAt) throw { status: 404, message: "This file is no longer available." };
      const f = snap.data();
      return NextResponse.json({
        mode: share.mode,
        targetType: "file",
        targetName: share.targetName,
        file: {
          id: snap.id,
          title: f.title,
          ext: f.ext || "txt",
          content: f.content || null,
          hasBlob: !!f.blobPath,
          sizeBytes: f.sizeBytes || 0,
        },
      });
    }

    const snap = await adminDb()
      .collection(`customers/${share.accountId}/textFiles`)
      .where("folderId", "==", share.targetId)
      .get();
    const files = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((f) => !f.deletedAt)
      .map((f) => ({
        id: f.id,
        title: f.title,
        ext: f.ext || "txt",
        sizeBytes: f.sizeBytes || 0,
        createdAt: toIso(f.createdAt),
        canDelete: f.uploadedViaShare === params.shareId,
      }));

    return NextResponse.json({ mode: share.mode, targetType: "folder", targetName: share.targetName, files });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

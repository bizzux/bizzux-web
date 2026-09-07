import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireLiveShare } from "@/lib/shareLinks";
import { FieldValue } from "firebase-admin/firestore";
import { del } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_TITLE_LEN = 150;

// PUBLIC (guest-token gated) — a guest can only ever act on the one
// share's target folder, and can only delete files this exact share link
// was used to upload (never a file that already existed, and never
// another share's uploads even into the same folder).
export async function POST(req, { params }) {
  try {
    const { share } = await requireLiveShare(req, params.shareId);
    if (share.targetType !== "folder") throw { status: 403, message: "This share doesn't allow uploads." };
    const body = await req.json();
    const filesCol = adminDb().collection(`customers/${share.accountId}/textFiles`);

    if (body.action === "create") {
      if (share.mode !== "upload") throw { status: 403, message: "This share is view-only." };
      const title = String(body.title || "").trim().slice(0, MAX_TITLE_LEN);
      if (!title) throw { status: 400, message: "File name is required" };

      const doc = {
        title,
        folderId: share.targetId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: null,
        createdByEmail: null,
        uploadedViaShare: params.shareId,
        deletedAt: null,
      };

      if (body.blobPath) {
        doc.blobPath = String(body.blobPath);
        doc.contentType = body.contentType ? String(body.contentType) : "application/octet-stream";
        doc.ext = String(body.ext || "").toLowerCase().slice(0, 10) || "bin";
        doc.sizeBytes = Number(body.sizeBytes) || 0;
        doc.content = null;
      } else {
        const content = String(body.content || "");
        if (!content.trim()) throw { status: 400, message: "File content is empty" };
        if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) throw { status: 400, message: "That file is too large (2MB limit)" };
        doc.content = content;
        doc.ext = "txt";
        doc.sizeBytes = Buffer.byteLength(content, "utf8");
      }

      const ref = await filesCol.add(doc);
      return NextResponse.json({ id: ref.id });
    }

    if (body.action === "delete") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "File id required" };
      const ref = filesCol.doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "File not found" };
      if (snap.data().uploadedViaShare !== params.shareId) {
        throw { status: 403, message: "You can only delete files you uploaded through this link." };
      }
      const data = snap.data();
      if (data.blobPath) await del(data.blobPath).catch(() => {});
      await ref.delete();
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

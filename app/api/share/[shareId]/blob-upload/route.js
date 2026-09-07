import { NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";
import { requireLiveShare } from "@/lib/shareLinks";

export const runtime = "nodejs";

const ALLOWED_EXT_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/octet-stream",
];

// PUBLIC (guest-token gated) — mints a Vercel Blob client token scoped to
// the SHARE OWNER's storage path, never the guest's own (a guest has no
// Bizzux account/accountId of their own). Same reasoning as
// app/api/files/blob-upload and app/api/notes/blob-upload: lets the
// browser upload directly to Blob storage without the file passing through
// this function's own request body.
export async function POST(req, { params }) {
  try {
    const { share } = await requireLiveShare(req, params.shareId);
    if (share.targetType !== "folder" || share.mode !== "upload") {
      throw { status: 403, message: "This share doesn't allow uploads." };
    }

    const body = await req.json();
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`files/${share.accountId}/`)) {
          throw new Error("Invalid upload path");
        }
        return {
          allowedContentTypes: ALLOWED_EXT_MIME,
          addRandomSuffix: true,
          maximumSizeInBytes: 50 * 1024 * 1024,
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Upload failed" }, { status: e.status || 400 });
  }
}

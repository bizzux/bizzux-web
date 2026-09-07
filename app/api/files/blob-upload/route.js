import { NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";
import { requireAccountWithAppsAccess } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

// Mints a scoped client token so the browser can upload a binary file
// (Word/Excel/PowerPoint/PDF/etc.) DIRECTLY to Vercel Blob storage, the same
// pattern app/api/notes/blob-upload uses for meeting recordings — needed
// because a real document can exceed Vercel Route Handlers' ~4.5MB body cap.
// Plain .txt/pasted text never goes through here — that stays inline in
// Firestore (see app/api/files/route.js) so it's still full-text searchable.
const ALLOWED_EXT_TO_MIME = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export async function POST(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);

    const body = await req.json();
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`files/${acct.accountId}/`)) {
          throw new Error("Invalid upload path");
        }
        return {
          allowedContentTypes: [...Object.values(ALLOWED_EXT_TO_MIME), "application/octet-stream"],
          addRandomSuffix: true,
          // Generous but bounded — stops a runaway/abusive upload.
          maximumSizeInBytes: 50 * 1024 * 1024,
        };
      },
      // No onUploadCompleted: same reasoning as notes/blob-upload — needs a
      // public callbackUrl this app doesn't have configured, and isn't
      // needed since the client's own upload() call resolves with the blob
      // path and persists it via the "create" action right after.
    });

    return NextResponse.json(jsonResponse);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Upload failed" }, { status: e.status || 400 });
  }
}

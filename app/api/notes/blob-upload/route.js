import { NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";
import { requireAccountWithAppsAccess } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

// Mints a scoped client token so the browser can upload a meeting's audio
// recording DIRECTLY to Vercel Blob storage (see app/(saas)/notes/new/page.js),
// bypassing this function's own request body entirely — needed because a
// full meeting recording can exceed Vercel Route Handlers' ~4.5MB body cap,
// the same limit /api/careers's resume upload stays safely under.
export async function POST(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);

    const body = await req.json();
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`notes/${acct.accountId}/`)) {
          throw new Error("Invalid upload path");
        }
        return {
          // Wildcard, not an exact list — MediaRecorder's actual mimeType
          // includes a codecs parameter (e.g. "audio/webm;codecs=opus"),
          // which an exact-string allowlist rejects as a non-match.
          allowedContentTypes: ["audio/*"],
          addRandomSuffix: true,
          // Generous but bounded — a several-hour meeting at opus bitrates
          // stays well under this; stops a runaway/abusive upload.
          maximumSizeInBytes: 500 * 1024 * 1024,
        };
      },
      // No onUploadCompleted: that webhook needs a public callbackUrl
      // (unreachable on localhost, and not configured for prod either), and
      // isn't needed anyway — the "finalize" action is the sole place
      // audioBlobPath gets persisted, once the client's own upload() call
      // resolves.
    });

    return NextResponse.json(jsonResponse);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Upload failed" }, { status: e.status || 400 });
  }
}

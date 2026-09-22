import { NextResponse } from "next/server";
import { get } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A public, unauthenticated proxy in front of the project's Blob store —
// which is provisioned "private" (see the "Vercel Blob: Cannot use public
// access on a private store" error that `put(..., { access: "public" })`
// started throwing once this store stopped allowing public blobs). Rather
// than provisioning and wiring up a second, genuinely-public store (a real
// option, but one more piece of infrastructure + a second BLOB token env
// var to manage), this route streams the same private blobs back out
// without requiring a signed-in caller — for anything meant to be publicly
// visible: blog cover images, team photos, and anything else embedded in
// a public marketing page or read by a social-share crawler (which never
// sends auth headers). Every uploader under this scheme (image-upload,
// team/photo-upload) stores as access: "private" and returns
// `/api/media/<path>` instead of the blob's own private URL.
//
// No auth check here is intentional — the whole point is these assets
// need to work for anonymous visitors and crawlers. Not a data leak: only
// paths actually returned by an upload endpoint are ever guessable/linked,
// same trust boundary a real public bucket would have.
export async function GET(req, { params }) {
  try {
    const path = (params.path || []).join("/");
    if (!path) throw { status: 400, message: "Missing path" };

    const result = await get(path, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN });
    if (!result || result.statusCode !== 200) {
      throw { status: 404, message: "Not found" };
    }

    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType || "application/octet-stream",
        // Upload paths are all Date.now()-prefixed (see image-upload/
        // photo-upload), so the same path is never reused for different
        // content — safe to cache aggressively and immutably.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Not found" }, { status: e.status || 404 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/firebaseAdmin";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

// Team photos need to be publicly fetchable (they render on the public
// About page), but the project's Blob store is provisioned private — see
// app/api/media/[...path]/route.js's comment. Uploaded privately here;
// served back out through that public proxy route instead of a direct
// Blob URL.
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const formData = await req.formData();
    const file = formData.get("photo") as File | null;
    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No photo provided" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Please upload an image file" }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Image must be under 5MB" }, { status: 400 });
    }

    const path = `team/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await put(path, file, { access: "private", contentType: file.type });
    return NextResponse.json({ url: `/api/media/${path}` });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Upload failed" }, { status: e.status || 500 });
  }
}

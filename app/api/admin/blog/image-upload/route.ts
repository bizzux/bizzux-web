import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/firebaseAdmin";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

// Same pattern as /api/admin/team/photo-upload — public Blob store since
// cover images render on the public /resources pages and in og:image.
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Please upload an image file" }, { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "Image must be under 8MB" }, { status: 400 });
    }

    const path = `blog/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const blob = await put(path, file, { access: "public", contentType: file.type });
    return NextResponse.json({ url: blob.url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Upload failed" }, { status: e.status || 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/firebaseAdmin";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

// Same private-blob + public /api/media proxy scheme as team/photo-upload.
// SVG is left out on purpose: served from our own domain it could carry
// script; PNG/WebP with a transparent background look just as sharp.
const ALLOWED = ["image/png", "image/jpeg", "image/webp"];

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const formData = await req.formData();
    const file = formData.get("logo") as File | null;
    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No logo provided" }, { status: 400 });
    }
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: "Logo must be a PNG, JPG or WebP image" }, { status: 400 });
    }
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "Logo must be under 2MB" }, { status: 400 });
    }

    const path = `customers/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await put(path, file, { access: "private", contentType: file.type });
    return NextResponse.json({ url: `/api/media/${path}` });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Upload failed" }, { status: e.status || 500 });
  }
}

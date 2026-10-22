import { NextResponse } from "next/server";
import { requireOrgManager } from "@/lib/firebaseAdmin";
import { setUserPhoto, PHOTO_MAX_BYTES } from "@/lib/iam/userPhoto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST multipart { uid, photo, organizationId? } -> { ok, photoURL }. Company Owners and Admins only, for a member of their own company.
export async function POST(req) {
  try {
    const c = await requireOrgManager(req);
    const f = await req.formData();
    const file = f.get("photo");
    if (!file || typeof file === "string") throw { status: 400, message: "No picture was received." };
    if (file.size > PHOTO_MAX_BYTES) throw { status: 400, message: "The picture must be under 2 MB." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    return NextResponse.json(await setUserPhoto({ actor: c, organizationId: f.get("organizationId") || undefined, uid: String(f.get("uid") || ""), contentType: file.type, bytes }));
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { COMPANY_DATA_PATHS } from "@/lib/companyData";
import { adminDb, requireSuperAdmin } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

// "customerLogos" backs the scrolling customer-logo strip on the home and
// Customers pages. Public pages read it server-side (lib/companyData);
// writes are Platform Owner/Admin only, same gate as the rest of /admin.
function logos() {
  return adminDb().collection("customerLogos");
}

function refreshPages() {
  COMPANY_DATA_PATHS.forEach((p) => revalidatePath(p));
}

function cleanWebsite(v: unknown): string {
  const s = String(v || "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : "https://" + s;
}

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const snap = await logos().orderBy("order", "asc").get();
    return NextResponse.json({ customers: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
    if (!body.logoUrl) return NextResponse.json({ error: "Please upload the customer's logo" }, { status: 400 });

    const last = await logos().orderBy("order", "desc").limit(1).get();
    const nextOrder = last.empty ? 0 : (last.docs[0].data().order || 0) + 1;
    const ref = await logos().add({
      name,
      logoUrl: body.logoUrl,
      website: cleanWebsite(body.website),
      active: body.active !== false,
      order: nextOrder,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    refreshPages();
    return NextResponse.json({ id: ref.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

// Also used for reordering: the panel sends { id, order } pairs one at a time.
export async function PATCH(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.logoUrl) patch.logoUrl = body.logoUrl;
    if (body.website !== undefined) patch.website = cleanWebsite(body.website);
    if (body.active !== undefined) patch.active = body.active === true;
    if (typeof body.order === "number") patch.order = body.order;
    await logos().doc(id).update(patch);
    refreshPages();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await logos().doc(id).delete();
    refreshPages();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

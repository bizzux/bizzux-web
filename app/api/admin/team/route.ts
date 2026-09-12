import { NextRequest, NextResponse } from "next/server";
import { adminDb, requireSuperAdmin } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

// The "team" collection backs the About page's CEO/staff section — public
// read (About page fetches it server-side with adminDb(), same pattern the
// homepage's generateMetadata already uses), writes gated to Platform
// Owner/Admin only via requireSuperAdmin, same gate the rest of /admin uses.
function teamCollection() {
  return adminDb().collection("team");
}

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const snap = await teamCollection().orderBy("order", "asc").get();
    const members = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ members });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const name = (body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const snap = await teamCollection().orderBy("order", "desc").limit(1).get();
    const nextOrder = snap.empty ? 0 : (snap.docs[0].data().order || 0) + 1;

    const ref = await teamCollection().add({
      name,
      role: (body.role || "").trim(),
      bio: (body.bio || "").trim(),
      photoUrl: body.photoUrl || null,
      isCEO: body.isCEO === true,
      order: nextOrder,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ id: ref.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const { id, ...patch } = body;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    delete patch.createdAt;
    await teamCollection().doc(id).update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await teamCollection().doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

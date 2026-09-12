import { NextRequest, NextResponse } from "next/server";
import { adminDb, requireSuperAdmin } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

function reviewsCollection() {
  return adminDb().collection("reviews");
}

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const snap = await reviewsCollection().orderBy("createdAt", "desc").get();
    const reviews = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ reviews });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const { id, status } = await req.json();
    if (!id || !["approved", "rejected", "pending"].includes(status)) {
      return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
    }
    await reviewsCollection().doc(id).update({ status, moderatedAt: FieldValue.serverTimestamp() });
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
    await reviewsCollection().doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { cleanBusinessRole } from "@/lib/businessRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The signed-in person's own job role ("what is your role in your company?"). It describes the
// person, so it lives on users/{uid} and travels with them; it grants no permissions.
export async function GET(req) {
  try {
    const c = await requireUser(req);
    const s = await adminDb().doc("users/" + c.uid).get();
    return NextResponse.json({ businessRole: s.exists ? s.data().businessRole || "" : "" });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || (typeof e.code === "string" && e.code.startsWith("auth/") ? 401 : 500) });
  }
}

export async function POST(req) {
  try {
    const c = await requireUser(req);
    const body = await req.json();
    const businessRole = cleanBusinessRole(body.businessRole);
    if (!businessRole) throw { status: 400, message: "Choose your role in the company" };
    await adminDb().doc("users/" + c.uid).set({ businessRole, businessRoleUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ ok: true, businessRole });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || (typeof e.code === "string" && e.code.startsWith("auth/") ? 401 : 500) });
  }
}

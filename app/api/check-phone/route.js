import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, unauthenticated check — called before an account is created, so
// there's no signed-in user yet to verify. Only returns a yes/no, nothing
// else about any existing customer.
export async function POST(req) {
  try {
    const { phone } = await req.json();
    const clean = String(phone || "").trim();
    if (!clean) return NextResponse.json({ available: true });

    const snap = await adminDb().collection("customers").where("phone", "==", clean).limit(1).get();
    return NextResponse.json({ available: snap.empty });
  } catch {
    // Fail open on our own error so a broken check never blocks signup —
    // Firebase Auth still guarantees email uniqueness regardless.
    return NextResponse.json({ available: true });
  }
}

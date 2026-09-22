import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Switches which side of a dual owner+staff login resolveAccount() resolves
// to (see lib/firebaseAdmin.js) — only meaningful when the signed-in uid
// has BOTH a customers/ doc (their own account) and a memberships/ doc
// (staff on someone else's team). Rejects the switch outright for anyone
// who doesn't actually have both, so this can never be used to fake
// membership somewhere they weren't invited.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const body = await req.json();
    const useMembership = body.context === "membership";

    const [ownerSnap, memSnap] = await Promise.all([
      adminDb().doc("customers/" + c.uid).get(),
      adminDb().doc("memberships/" + c.uid).get(),
    ]);
    if (!ownerSnap.exists || !memSnap.exists) {
      throw { status: 400, message: "This login doesn't have both an owned account and a team membership to switch between" };
    }

    await adminDb().doc("users/" + c.uid).set(
      { useMembershipContext: useMembership, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return NextResponse.json({ ok: true, useMembershipContext: useMembership });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

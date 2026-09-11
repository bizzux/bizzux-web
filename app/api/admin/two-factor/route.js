import { NextResponse } from "next/server";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lets a Super Admin REQUIRE 2FA for a specific person (any uid — org
// owner, team member, or a Platform Admin/Owner, since twoFactor/{uid} is
// keyed the same way for all three — see lib/twoFactor.js). Their next
// sign-in is forced through /setup-2fa before reaching anything else, the
// same style of forced flow as mustChangePassword. This is the actual
// "enforce" lever — opt-in alone doesn't guarantee anyone turns it on.
export async function POST(req) {
  try {
    const c = await requireSuperAdmin(req);
    const body = await req.json();
    const uid = String(body.uid || "");
    if (!uid) throw { status: 400, message: "User id required" };
    const required = !!body.required;

    await adminDb().doc("twoFactor/" + uid).set({ required }, { merge: true });

    await logAuditEvent({
      action: required ? "twofactor.require" : "twofactor.unrequire",
      actor: c, targetType: "user", targetId: uid,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

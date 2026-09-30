import { NextResponse } from "next/server";
import { adminDb, requireSuperAdmin, requirePlatformOwner } from "@/lib/firebaseAdmin";
import { readPolicy, normalizePolicy, SESSION_APPS, SESSION_LIMITS, SESSION_DEFAULTS } from "@/lib/sessionPolicy";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";

// Any platform admin can view the session policy; only the Platform Owner
// can change it (security config — see requirePlatformOwner).
export async function GET(req) {
  try {
    const me = await requireSuperAdmin(req);
    return NextResponse.json({
      policy: await readPolicy(),
      apps: SESSION_APPS,
      limits: SESSION_LIMITS,
      defaults: SESSION_DEFAULTS,
      canEdit: me.platformRole === "OWNER",
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function PUT(req) {
  try {
    const me = await requirePlatformOwner(req);
    const before = await readPolicy();
    const policy = normalizePolicy(await req.json());
    await adminDb().doc("platformSettings/session").set({ ...policy, updatedAt: new Date(), updatedBy: me.email });
    await logAuditEvent({
      action: "session_policy_updated",
      actor: me,
      targetType: "platformSettings",
      targetId: "session",
      details: { before, after: policy },
    });
    return NextResponse.json({ policy });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

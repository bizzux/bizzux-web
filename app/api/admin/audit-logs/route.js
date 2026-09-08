import { NextResponse } from "next/server";
import { requirePlatformAdmin, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

// Read-only — entries are written by lib/audit.js's logAuditEvent() from
// wherever a sensitive action happens (see the call sites in
// admin/platform-admins and admin/customers). Most-recent-first, capped at
// 200 so this stays a simple single query with no pagination UI yet.
export async function GET(req) {
  try {
    await requirePlatformAdmin(req);
    const snap = await adminDb().collection("auditLogs").orderBy("createdAt", "desc").limit(200).get();
    const logs = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        action: data.action,
        actorEmail: data.actorEmail,
        actorRole: data.actorRole,
        targetType: data.targetType,
        targetId: data.targetId,
        details: data.details || {},
        createdAt: toIso(data.createdAt),
      };
    });
    return NextResponse.json({ logs });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

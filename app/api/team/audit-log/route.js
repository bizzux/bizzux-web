import { NextResponse } from "next/server";
import { requireAccountAdmin, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

// Org-scoped view of the same auditLogs collection the Platform Admin
// portal reads in full (app/api/admin/audit-logs/route.js) — filtered to
// this org's own accountId so an account admin can see what happened on
// their own team (invites, role/app-access changes, etc.) without needing
// platform-wide access.
export async function GET(req) {
  try {
    const acct = await requireAccountAdmin(req);
    let snap;
    try {
      snap = await adminDb()
        .collection("auditLogs")
        .where("targetId", "==", acct.accountId)
        .orderBy("createdAt", "desc")
        .limit(100)
        .get();
    } catch {
      snap = await adminDb().collection("auditLogs").where("targetId", "==", acct.accountId).limit(100).get();
    }
    const logs = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        action: data.action,
        actorEmail: data.actorEmail,
        details: data.details || {},
        createdAt: toIso(data.createdAt),
      };
    });
    return NextResponse.json({ logs });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

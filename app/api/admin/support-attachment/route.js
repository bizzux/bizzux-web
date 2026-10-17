import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requirePlatformPermission } from "@/lib/platformRoles";
import { logAuditEvent } from "@/lib/audit";
import { TICKETS } from "@/lib/supportTickets";
import { supportBlob } from "@/lib/supportBlob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Support staff viewing a customer's screenshot on a ticket (support.tickets).
// Screenshots can contain customer data, so every view is recorded in the audit
// log against the organization.
export async function GET(req) {
  try {
    const c = await requirePlatformPermission(req, "support.tickets");
    const u = new URL(req.url);
    const snap = await adminDb().doc(TICKETS + "/" + String(u.searchParams.get("ticket") || "").slice(0, 128)).get();
    if (!snap.exists) throw { status: 404, message: "Ticket not found" };
    const t = snap.data();
    const a = (t.attachments || [])[parseInt(u.searchParams.get("i"), 10)];
    if (!a) throw { status: 404, message: "Attachment not found" };
    const r = await supportBlob.get(a.path);
    if (!r || r.statusCode !== 200) throw { status: 404, message: "Attachment not found in storage" };
    await logAuditEvent({
      action: "support_ticket.attachment_viewed", actor: c, targetType: "organization", targetId: t.organizationId,
      details: { ticketId: snap.id, code: t.code, name: a.name },
    });
    return new NextResponse(r.stream, {
      headers: { "Content-Type": a.contentType, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

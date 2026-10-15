import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Company switcher for logins an admin linked to several companies. The
// chosen company is stored server-side (users/{uid}.activeOrganizationId)
// and re-validated against an ACTIVE organizationMembership by
// resolveAccount() on every request in every Bizzux app, so the client can
// never act in a company it doesn't belong to.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const { organizationId } = await req.json();
    if (!organizationId) throw { status: 400, message: "organizationId required" };
    const [own, mem, om] = await Promise.all([
      adminDb().doc("customers/" + c.uid).get(),
      adminDb().doc("memberships/" + c.uid).get(),
      adminDb().doc("organizationMemberships/" + organizationId + "_" + c.uid).get(),
    ]);
    const flagged = own.data()?.multiOrg || mem.data()?.multiOrg;
    if (!flagged) throw { status: 400, message: "This login belongs to a single company" };
    if (!om.exists || om.data().status !== "active") throw { status: 403, message: "You are not an active member of that company" };
    await adminDb().doc("users/" + c.uid).set({ activeOrganizationId: organizationId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await logAuditEvent({ action: "auth.switch_organization", actor: c, targetType: "organization", targetId: organizationId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

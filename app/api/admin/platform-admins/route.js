import { NextResponse } from "next/server";
import { requirePlatformAdmin, requirePlatformOwner, requireRecentAuth, adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { logAuditEvent } from "@/lib/audit";
import { FieldValue } from "firebase-admin/firestore";
import {
  createInvitation, revokeInvitation, changeRole, setAccess, listAdministrators, adminHistory,
  assertAssignableRole, normalizeEmail,
} from "@/lib/platformAdminAccess";
import { ASSIGNABLE_ROLES, ROLE_LABELS, ROLE_SUMMARIES } from "@/lib/platformRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (e) =>
  NextResponse.json({ error: e.message || "Failed", ...(e.code ? { code: e.code } : {}) }, { status: e.status || 500 });

// Owner + Admin can both view the roster (so an Admin can see their peers),
// but only the Owner can invite, change or revoke — see the POST guard. No
// request can ever create, change or remove role:"OWNER": that only exists via
// the one-time bootstrap in lib/firebaseAdmin.js's resolvePlatformRole().
export async function GET(req) {
  try {
    const c = await requirePlatformAdmin(req);
    const history = new URL(req.url).searchParams.get("history");
    if (history) return NextResponse.json({ history: await adminHistory(history) });
    const { admins, invitations } = await listAdministrators({ includeInvitations: c.platformRole === "OWNER" });
    return NextResponse.json({
      admins, invitations,
      roles: ASSIGNABLE_ROLES.map((id) => ({ id, label: ROLE_LABELS[id], summary: ROLE_SUMMARIES[id] })),
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req) {
  try {
    const c = await requirePlatformOwner(req);
    const body = await req.json();
    requireRecentAuth(c); // every mutation here is a privileged change

    if (body.action === "invite" || body.action === "resend") {
      const r = await createInvitation({ actor: c, email: body.email, role: body.role, origin: new URL(req.url).origin });
      return NextResponse.json({ ok: true, invitationId: r.id });
    }

    if (body.action === "revokeInvitation") {
      await revokeInvitation({ actor: c, id: body.id });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "changeRole") {
      return NextResponse.json({ ok: true, ...(await changeRole({ actor: c, uid: body.uid, role: body.role })) });
    }

    // Kept for existing callers: add someone who already has a Bizzux sign-in.
    // New work should use "invite", which doesn't need a prior sign-in.
    if (body.action === "create") {
      const email = normalizeEmail(body.email);
      let user;
      try {
        user = await adminAuth().getUserByEmail(email);
      } catch {
        throw { status: 404, message: "No Bizzux sign-in exists yet for that email. Send an invitation instead." };
      }
      const ref = adminDb().doc("platformAdmins/" + user.uid);
      const existing = await ref.get();
      if (existing.exists && existing.data().role === "OWNER") {
        throw { status: 400, message: "That account is already the Platform Owner." };
      }
      const role = body.role ? assertAssignableRole(body.role) : "ADMIN";
      await ref.set({
        email, role, status: "active", permissions: null,
        createdBy: c.email, invitedBy: c.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      await logAuditEvent({ action: "platform_admin.create", actor: c, targetType: "platformAdmin", targetId: user.uid, details: { email, role } });
      return NextResponse.json({ ok: true, uid: user.uid });
    }

    if (body.action === "disable" || body.action === "reactivate") {
      await setAccess({ actor: c, uid: body.uid, enable: body.action === "reactivate" });
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return fail(e);
  }
}

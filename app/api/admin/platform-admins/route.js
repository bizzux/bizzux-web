import { NextResponse } from "next/server";
import { requirePlatformAdmin, requirePlatformOwner, adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { logAuditEvent } from "@/lib/audit";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

// Owner + Admin can both view the roster (so an Admin can see their peers),
// but only the Owner can create or disable/reactivate one — see the POST
// guard below. This route can never create role:"OWNER" — that only ever
// happens via the one-time bootstrap in lib/firebaseAdmin.js's
// resolvePlatformRole(), matched against a hardcoded env email, never from
// a request body here.
export async function GET(req) {
  try {
    await requirePlatformAdmin(req);
    const snap = await adminDb().collection("platformAdmins").orderBy("createdAt", "asc").get();
    const admins = snap.docs.map((d) => {
      const data = d.data();
      return {
        uid: d.id,
        email: data.email,
        role: data.role,
        status: data.status || "active",
        createdBy: data.createdBy,
        createdAt: toIso(data.createdAt),
      };
    });
    return NextResponse.json({ admins });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requirePlatformOwner(req);
    const body = await req.json();

    if (body.action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) throw { status: 400, message: "Email is required" };

      let user;
      try {
        user = await adminAuth().getUserByEmail(email);
      } catch {
        throw { status: 404, message: "No Bizzux sign-in exists yet for that email — they need to sign up or sign in at least once first." };
      }

      const ref = adminDb().doc("platformAdmins/" + user.uid);
      const existing = await ref.get();
      if (existing.exists && existing.data().role === "OWNER") {
        throw { status: 400, message: "That account is already the Platform Owner." };
      }

      await ref.set({
        email, role: "ADMIN", status: "active", permissions: null,
        createdBy: c.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });

      await logAuditEvent({
        action: "platform_admin.create", actor: c,
        targetType: "platformAdmin", targetId: user.uid, details: { email },
      });

      return NextResponse.json({ ok: true, uid: user.uid });
    }

    if (body.action === "disable" || body.action === "reactivate") {
      const uid = String(body.uid || "");
      if (!uid) throw { status: 400, message: "Admin id is required" };
      const ref = adminDb().doc("platformAdmins/" + uid);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Platform admin not found" };
      if (snap.data().role === "OWNER") throw { status: 400, message: "The Platform Owner can't be disabled." };

      const status = body.action === "disable" ? "disabled" : "active";
      await ref.update({ status, updatedAt: FieldValue.serverTimestamp() });

      await logAuditEvent({
        action: body.action === "disable" ? "platform_admin.disable" : "platform_admin.reactivate",
        actor: c, targetType: "platformAdmin", targetId: uid, details: { email: snap.data().email },
      });

      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

import { NextResponse } from "next/server";
import { requirePlatformOwner, adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logAuditEvent } from "@/lib/audit";
import { purgeUser, lookupUser, RECOVERY_DAYS } from "@/lib/userPurge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const toIso = (v) => (v?.toDate ? v.toDate().toISOString() : v ? new Date(v).toISOString() : null);

// Platform Owner -> Delete & Recover users.
//
// Two ways to remove someone:
//   - Close (for real customers): sign-in is disabled and every app locked
//     right away, but nothing is deleted. Recoverable for RECOVERY_DAYS;
//     after that the daily job (app/api/cron/purge-closed) wipes it fully.
//     The email stays taken while it's recoverable.
//   - Delete now (mainly for testing): full wipe across every app
//     immediately (see lib/userPurge.js), so the same email can sign up
//     again as a brand-new user.
//
// Refuses your own account, any Platform Owner/Admin, and a business on a
// paid plan (cancel or downgrade it first; this is not a billing tool).

export async function GET(req) {
  try {
    const actor = await requirePlatformOwner(req);
    const url = new URL(req.url);

    // Closed accounts still inside their recovery window, soonest wipe first.
    if (url.searchParams.get("closed") === "1") {
      const snap = await adminDb().collection("closedAccounts").orderBy("purgeAfter", "asc").get();
      const closed = snap.docs.map((d) => {
        const c = d.data();
        return {
          uid: d.id, email: c.email, organizationName: c.organizationName || null,
          closedAt: toIso(c.closedAt), purgeAfter: toIso(c.purgeAfter), closedBy: c.closedByEmail || null,
        };
      });
      return NextResponse.json({ closed, recoveryDays: RECOVERY_DAYS });
    }

    const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
    if (!email) throw { status: 400, message: "Enter an email address" };
    return NextResponse.json({ user: await lookupUser(email, actor), recoveryDays: RECOVERY_DAYS });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const actor = await requirePlatformOwner(req);
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) throw { status: 400, message: "Enter an email address" };

    const info = await lookupUser(email, actor);
    const db = adminDb();

    if (body.action === "recover") {
      if (!info.closed) throw { status: 409, message: "This account isn't closed." };
      await adminAuth().updateUser(info.uid, { disabled: false });
      if (info.ownsBusiness) {
        const snap = await db.doc("customers/" + info.uid).get();
        const before = snap.exists ? snap.data().statusBeforeClose : null;
        await db.doc("customers/" + info.uid).set(
          { status: before || "trial", statusBeforeClose: FieldValue.delete() },
          { merge: true }
        );
      }
      await db.doc("closedAccounts/" + info.uid).delete();
      await logAuditEvent({ action: "user.recover", actor, targetType: "user", targetId: info.uid, details: { email } });
      return NextResponse.json({ ok: true });
    }

    if (info.blockedReason) throw { status: 409, message: info.blockedReason };

    if (body.action === "close") {
      if (info.closed) throw { status: 409, message: "This account is already closed." };
      const now = Timestamp.now();
      const purgeAfter = Timestamp.fromMillis(now.toMillis() + RECOVERY_DAYS * DAY_MS);
      // Sign-in disabled and existing sessions ended; the business's status
      // becomes "closed", which canAccessApps() treats as locked, so its
      // team loses app access too. Nothing is deleted yet.
      await adminAuth().updateUser(info.uid, { disabled: true });
      await adminAuth().revokeRefreshTokens(info.uid);
      if (info.ownsBusiness) {
        await db.doc("customers/" + info.uid).set(
          { status: "closed", statusBeforeClose: info.ownsBusiness.status || "trial" },
          { merge: true }
        );
      }
      await db.doc("closedAccounts/" + info.uid).set({
        email, organizationName: info.ownsBusiness?.organizationName || null,
        closedAt: now, purgeAfter, closedByUid: actor.uid, closedByEmail: actor.email,
      });
      await logAuditEvent({
        action: "user.close", actor, targetType: "user", targetId: info.uid,
        details: { email, organizationName: info.ownsBusiness?.organizationName || null, purgeAfter: purgeAfter.toDate().toISOString() },
      });
      return NextResponse.json({ ok: true, purgeAfter: purgeAfter.toDate().toISOString() });
    }

    if (body.action === "delete") {
      // Typed confirmation, checked server-side too, so a stray request
      // can't delete someone.
      if (String(body.confirmEmail || "").trim().toLowerCase() !== email) {
        throw { status: 400, message: "Type the email address exactly to confirm." };
      }
      const report = await purgeUser(info);
      await logAuditEvent({
        action: "user.delete", actor, targetType: "user", targetId: info.uid,
        details: { email, organizationName: info.ownsBusiness?.organizationName || null, ...report },
      });
      return NextResponse.json({ ok: true, report });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { Timestamp } from "firebase-admin/firestore";
import { logAuditEvent } from "@/lib/audit";
import { lookupUser, purgeUser } from "@/lib/userPurge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily (vercel.json crons): permanently wipes accounts the Platform Owner
// closed more than RECOVERY_DAYS ago. Vercel calls this with
// "Authorization: Bearer <CRON_SECRET>", so nothing else can trigger it.
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== "Bearer " + secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = adminDb();
  const due = await db.collection("closedAccounts").where("purgeAfter", "<=", Timestamp.now()).limit(25).get();
  const results = [];

  for (const d of due.docs) {
    const { email } = d.data();
    try {
      let info;
      try {
        info = await lookupUser(email, null);
      } catch (e) {
        // Sign-in already gone (e.g. deleted by hand): just clear the record.
        if (e?.status === 404) {
          await d.ref.delete();
          results.push({ email, result: "already gone" });
          continue;
        }
        throw e;
      }
      // Became a Platform Admin or a paid customer since closing: leave it
      // for a person to decide rather than wiping automatically.
      if (info.blockedReason) {
        results.push({ email, result: "skipped: " + info.blockedReason });
        continue;
      }
      const report = await purgeUser(info);
      await logAuditEvent({
        action: "user.purge_after_close", actor: { uid: "cron", email: "system", platformRole: "SYSTEM" },
        targetType: "user", targetId: info.uid, details: { email, ...report },
      });
      results.push({ email, result: "wiped", ...report });
    } catch (e) {
      results.push({ email, result: "error: " + (e?.message || "failed") });
    }
  }

  return NextResponse.json({ checked: due.size, results });
}

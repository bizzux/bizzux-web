// Sensitive-operation audit trail — a single top-level `auditLogs`
// collection, written by whichever route just performed something worth
// tracking (creating/disabling a Platform Admin, suspending an
// organization, extending a trial, resetting a password, changing
// pricing, etc.). Deliberately simple: one flat collection, no fan-out,
// queryable by actor/target/action from the Platform Admin portal's Audit
// Logs tab. Never let a logging failure break the action it's describing —
// callers should fire this after the real write succeeds and swallow any
// error from it.
import { adminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export async function logAuditEvent({ action, actor, targetType, targetId, details }) {
  try {
    await adminDb()
      .collection("auditLogs")
      .add({
        action,
        actorUid: actor?.uid || null,
        actorEmail: actor?.email || null,
        actorRole: actor?.platformRole || actor?.profile || null,
        targetType: targetType || null,
        targetId: targetId || null,
        details: details || {},
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (e) {
    // Never let audit logging itself take down the action it's describing.
    console.error("logAuditEvent failed:", action, e?.message || e);
  }
}

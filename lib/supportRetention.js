// SERVER ONLY. Retention of support screenshots.
//
//  1. Closed tickets: a screenshot is removed SUPPORT_ATTACHMENT_RETENTION_DAYS
//     (default 90, minimum 7) after its ticket is resolved/closed. Reopening the
//     ticket stops the clock; closing again restarts it. The ticket keeps its text,
//     the attachment's name and size, and a "removed after the retention period" marker.
//  2. Abandoned uploads: a screenshot uploaded but never attached to a submitted
//     case is deleted after 24 hours.
//  3. Account deletion also removes the organization's support/ folder (lib/userPurge.js).
//
// How: supportTickets.purgeAttachmentsAtMs (set when a ticket with screenshots
// closes) and a supportUploads/{id} registry (path, linked flag) mean the daily
// job only reads what is actually due - it never scans every ticket or lists the
// whole blob store. Dry-run reports without deleting anything.
import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";
import { logAuditEvent } from "./audit";

export const UPLOADS = "supportUploads";
export const DEFAULT_RETENTION_DAYS = 90;
export const ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000;

export const retentionDays = () => Math.max(7, parseInt(process.env.SUPPORT_ATTACHMENT_RETENTION_DAYS, 10) || DEFAULT_RETENTION_DAYS);
export const retentionDueMs = (closedAtMs) => closedAtMs + retentionDays() * 864e5;

const uploadId = (path) => createHash("sha1").update(path).digest("hex").slice(0, 32);

export async function registerUpload({ path, orgId, uid, size }) {
  await adminDb().doc(UPLOADS + "/" + uploadId(path)).set({ path, organizationId: orgId, uid, size, linked: false, createdAtMs: Date.now() });
}

export async function linkUploads(paths, ticketId) {
  const db = adminDb();
  const batch = db.batch();
  for (const p of paths) batch.set(db.doc(UPLOADS + "/" + uploadId(p)), { linked: true, ticketId, path: p }, { merge: true });
  await batch.commit();
}

const missing = (e) => /not.?found|ENOENT|404/i.test(String(e?.message || e));

// One run of the retention job. Returns the operations it performed so cost
// is visible (reads/writes are of Firestore; files are blob deletions).
export async function runSupportRetention({ blob, dryRun = false, now = Date.now(), maxTickets = 100, maxOrphans = 200 }) {
  const db = adminDb();
  const out = { dryRun, ticketsDue: 0, ticketsPurged: 0, filesDeleted: 0, orphansFound: 0, orphansDeleted: 0, reads: 0, writes: 0, errors: [] };

  // 1. closed tickets past retention
  const due = await db.collection("supportTickets").where("purgeAttachmentsAtMs", "<=", now).orderBy("purgeAttachmentsAtMs", "asc").limit(maxTickets).get();
  out.reads += due.size; out.ticketsDue = due.size;
  for (const d of due.docs) {
    const t = d.data();
    if (dryRun) { out.filesDeleted += (t.attachments || []).filter((a) => a.path && !a.purged).length; continue; }
    try {
      const kept = [];
      for (const a of t.attachments || []) {
        if (a.path && !a.purged) {
          try { await blob.del(a.path); } catch (e) { if (!missing(e)) throw e; }
          out.filesDeleted++;
        }
        kept.push({ name: a.name, size: a.size, contentType: a.contentType, purged: true });
      }
      await d.ref.update({ attachments: kept, attachmentsPurgedAt: now, purgeAttachmentsAtMs: FieldValue.delete() }); out.writes++;
      await d.ref.collection("notes").add({ kind: "event", visibility: "internal", body: `Screenshots removed after the ${retentionDays()}-day retention period`, authorEmail: "system", createdAtMs: now, createdAt: FieldValue.serverTimestamp() }); out.writes++;
      const reg = db.batch();
      for (const a of t.attachments || []) if (a.path) reg.delete(db.doc(UPLOADS + "/" + uploadId(a.path)));
      await reg.commit(); out.writes += (t.attachments || []).length;
      await logAuditEvent({
        action: "support_ticket.attachments_purged", actor: { uid: null, email: "system:retention" }, targetType: "organization", targetId: t.organizationId,
        details: { ticketId: d.id, code: t.code, files: (t.attachments || []).length, retentionDays: retentionDays() },
      }); out.writes++;
      out.ticketsPurged++;
    } catch (e) { out.errors.push(d.id + ": " + String(e?.message || e).slice(0, 120)); }
  }

  // 2. uploads that never became part of a case
  const orphans = await db.collection(UPLOADS).where("linked", "==", false).where("createdAtMs", "<", now - ORPHAN_AFTER_MS).limit(maxOrphans).get();
  out.reads += orphans.size; out.orphansFound = orphans.size;
  if (!dryRun) {
    for (const d of orphans.docs) {
      try {
        try { await blob.del(d.data().path); } catch (e) { if (!missing(e)) throw e; }
        await d.ref.delete(); out.writes++;
        out.orphansDeleted++; out.filesDeleted++;
      } catch (e) { out.errors.push(d.id + ": " + String(e?.message || e).slice(0, 120)); }
    }
  }
  return out;
}

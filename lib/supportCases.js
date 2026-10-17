// SERVER ONLY. Customer-side support cases: an app user (e.g. in Bizzux
// Attendance) raises a case with up to 3 screenshots, sees its status and the
// staff replies written for them, and answers back. It is the SAME record as
// the staff ticket (supportTickets/{id}) - source "app" - so Bizzux support sees
// it in the Customer Support workspace with its attachments.
//
// Isolation rules (all enforced here, on the server):
//   - the organization always comes from the caller's own account, never from the request
//   - a user only ever reads or answers cases THEY raised (requesterUid == uid)
//   - customers see only public messages (customer messages and staff replies marked
//     "Visible to customer"); internal notes and system events never leave the server
//   - customers can't set priority, assignee, status or follow-up dates
//   - screenshots are private blobs under support/<org>/<uid>/..., checked by magic bytes,
//     and only attachable by the person who uploaded them
import { randomBytes } from "crypto";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";
import { logAuditEvent } from "./audit";
import { TICKETS, CATEGORIES } from "./supportTickets";
import { notifyStaffNewCase, notifyStaffCustomerReply } from "./supportEmail";
import { registerUpload, linkUploads } from "./supportRetention";

export const MAX_ATTACHMENTS = 3;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // after the app downsizes; Vercel route bodies cap near 4.5 MB
export const CASE_CATEGORIES = ["technical", "how_to", "account_access", "billing", "other"];
export const CASES_PER_HOUR = 5;
export const REPLIES_PER_HOUR = 30;
const APP_KEYS = ["attendance", "business", "pos", "notes", "files", "projects", "chat", "crm", "mail", "capture", "finance", "portal"];
const str = (v, n) => String(v ?? "").trim().slice(0, n);
const toIso = (ms) => (ms ? new Date(ms).toISOString() : null);

export const CUSTOMER_STATUS = {
  open: "Received", in_progress: "In progress", waiting_customer: "Waiting for your reply", resolved: "Resolved", closed: "Closed",
};

// Image type from the file's own bytes, never from the filename or declared type.
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: "png", contentType: "image/png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", contentType: "image/jpeg" };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", contentType: "image/webp" };
  return null;
}

async function consumeRate(uid, kind, max) {
  const db = adminDb();
  const ref = db.doc("supportRate/" + uid + "_" + kind);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const now = Date.now();
    const d = s.exists ? s.data() : null;
    const fresh = d && now - d.windowStart < 3600000;
    const count = fresh ? d.count + 1 : 1;
    if (count > max) throw { status: 429, message: "You've sent a lot of messages in the last hour. Please try again a little later." };
    tx.set(ref, { windowStart: fresh ? d.windowStart : now, count });
  });
}

// Stores one screenshot (already downsized by the app) and returns its descriptor.
export async function storeCaseAttachment({ acct, uid, file, blob }) {
  if (!file || !file.length) throw { status: 400, message: "No file received" };
  if (file.length > MAX_UPLOAD_BYTES) throw { status: 413, message: "That image is too large. Screenshots are limited to 5 MB; try a smaller one." };
  const kind = sniffImage(file);
  if (!kind) throw { status: 400, message: "Only PNG, JPG or WebP images can be attached." };
  const path = `support/${acct.accountId}/${uid}/${Date.now()}-${randomBytes(6).toString("hex")}.${kind.ext}`;
  await blob.put(path, file, { access: "private", contentType: kind.contentType, addRandomSuffix: false });
  // registry of uploads so abandoned ones (never attached to a case) can be cleaned up
  await registerUpload({ path, orgId: acct.accountId, uid, size: file.length });
  return { path, size: file.length, contentType: kind.contentType };
}

async function verifyAttachments(list, acct, uid, blob) {
  const items = Array.isArray(list) ? list : [];
  if (items.length > MAX_ATTACHMENTS) throw { status: 400, message: "You can attach up to " + MAX_ATTACHMENTS + " screenshots." };
  const prefix = `support/${acct.accountId}/${uid}/`;
  const out = [];
  for (const a of items) {
    const path = String(a?.path || "");
    if (!path.startsWith(prefix) || path.includes("..") || !/^[A-Za-z0-9._\/-]+$/.test(path)) throw { status: 400, message: "Invalid attachment" };
    const h = await blob.head(path).catch(() => null);
    if (!h) throw { status: 400, message: "An attachment could not be found; please add it again." };
    if (h.size > MAX_UPLOAD_BYTES + 1024) throw { status: 400, message: "An attachment is too large." };
    out.push({ path, name: str(a.name, 120) || "screenshot", size: h.size, contentType: h.contentType });
  }
  return out;
}

function customerView(id, t) {
  return {
    id, code: t.code, subject: t.subject, description: t.description || "", category: t.category,
    status: t.status, statusLabel: CUSTOMER_STATUS[t.status] || t.status, appKey: t.appKey || null,
    createdAt: toIso(t.createdAtMs), updatedAt: toIso(t.updatedAtMs),
    attachments: (t.attachments || []).map((a, index) => ({ index, name: a.name, size: a.size, contentType: a.contentType, purged: !!a.purged })),
  };
}

export async function createCase({ user, acct, body, blob }) {
  const db = adminDb();
  const subject = str(body.subject, 160);
  if (subject.length < 3) throw { status: 400, message: "Please give your problem a short title." };
  const description = str(body.description, 4000);
  if (description.length < 5) throw { status: 400, message: "Please describe what happened." };
  const category = CASE_CATEGORIES.includes(body.category) ? body.category : "other";
  const appKey = APP_KEYS.includes(body.appKey) ? body.appKey : null;
  const orgId = acct.accountId;
  const org = await db.doc("organizations/" + orgId).get();
  const cust = org.exists ? null : await db.doc("customers/" + orgId).get();
  if (!org.exists && !cust?.exists) throw { status: 404, message: "We couldn't find your organization." };
  const orgData = org.exists ? org.data() : cust.data();
  const attachments = await verifyAttachments(body.attachments, acct, user.uid, blob);
  await consumeRate(user.uid, "case", CASES_PER_HOUR);

  const ctx = body.context && typeof body.context === "object" ? body.context : {};
  const now = Date.now();
  const ref = db.collection(TICKETS).doc();
  const counterRef = db.doc("counters/supportTickets");
  const number = await db.runTransaction(async (tx) => {
    const s = await tx.get(counterRef);
    const n = s.exists && s.data().next ? s.data().next : 1001;
    tx.set(counterRef, { next: n + 1 }, { merge: true });
    tx.set(ref, {
      number: n, code: "BZX-" + n, organizationId: orgId, organizationName: orgData.organizationName || orgData.name || orgData.companyName || "",
      subject, description, category: CATEGORIES.includes(category) ? category : "other", priority: "normal", status: "open",
      contactName: str(body.contactName, 80) || str(user.name, 80), contactEmail: (user.email || "").toLowerCase(), contactPhone: "",
      assigneeUid: null, assigneeEmail: null,
      source: "app", appKey, requesterUid: user.uid, requesterEmail: (user.email || "").toLowerCase(), requesterName: str(body.contactName, 80) || str(user.name, 80),
      attachments, awaitingStaff: true,
      context: { page: str(ctx.page, 200), appVersion: str(ctx.appVersion, 40), userAgent: str(ctx.userAgent, 300), screen: str(ctx.screen, 30) },
      createdByUid: user.uid, createdByEmail: (user.email || "").toLowerCase(), createdAtMs: now, updatedAtMs: now,
      followUpAtMs: null, closedAtMs: null, noteCount: 0,
    });
    return n;
  });
  await ref.collection("notes").add({ kind: "event", visibility: "internal", body: "Case raised from the " + (appKey || "app") + " app by " + (user.email || user.uid), authorEmail: user.email || "", authorUid: user.uid, createdAtMs: now, createdAt: FieldValue.serverTimestamp() });
  await logAuditEvent({
    action: "support_ticket.created", actor: { uid: user.uid, email: user.email, profile: acct.profile || "customer" }, targetType: "organization", targetId: orgId,
    details: { ticketId: ref.id, code: "BZX-" + number, source: "app", appKey, subject, attachments: attachments.length },
  });
  if (attachments.length) await linkUploads(attachments.map((a) => a.path), ref.id);
  const saved = (await ref.get()).data();
  await notifyStaffNewCase(ref.id, saved);
  return customerView(ref.id, saved);
}

export async function listMyCases({ user, limit = 25 }) {
  const snap = await adminDb().collection(TICKETS).where("requesterUid", "==", user.uid)
    .orderBy("updatedAtMs", "desc").orderBy(FieldPath.documentId(), "desc").limit(Math.max(1, Math.min(50, parseInt(limit, 10) || 25))).get();
  return { cases: snap.docs.map((d) => customerView(d.id, d.data())) };
}

async function loadMine(user, id) {
  const ref = adminDb().doc(TICKETS + "/" + str(id, 128));
  const snap = await ref.get();
  // same answer for "doesn't exist" and "not yours": nothing about other people's cases is revealed
  if (!snap.exists || snap.data().requesterUid !== user.uid) throw { status: 404, message: "Case not found" };
  return { ref, t: snap.data() };
}

export async function getMyCase({ user, id }) {
  const { ref, t } = await loadMine(user, id);
  const notes = await ref.collection("notes").where("visibility", "==", "public").orderBy("createdAtMs", "asc").limit(200).get();
  return {
    case: customerView(ref.id, t),
    messages: notes.docs.map((d) => {
      const n = d.data();
      return { id: d.id, from: n.kind === "customer" ? "you" : "support", body: n.body, createdAt: toIso(n.createdAtMs) };
    }),
  };
}

export async function replyToCase({ user, id, body }) {
  const { ref, t } = await loadMine(user, id);
  const text = str(body, 4000);
  if (!text) throw { status: 400, message: "Write your reply first." };
  await consumeRate(user.uid, "reply", REPLIES_PER_HOUR);
  const now = Date.now();
  await ref.collection("notes").add({ kind: "customer", visibility: "public", body: text, authorEmail: user.email || "", authorUid: user.uid, createdAtMs: now, createdAt: FieldValue.serverTimestamp() });
  const reopen = ["resolved", "closed"].includes(t.status);
  await ref.update({ updatedAtMs: now, noteCount: FieldValue.increment(1), awaitingStaff: true, ...(reopen ? { status: "open", closedAtMs: null, purgeAttachmentsAtMs: FieldValue.delete() } : {}), ...(t.status === "waiting_customer" ? { status: "open" } : {}) });
  if (reopen) {
    await ref.collection("notes").add({ kind: "event", visibility: "internal", body: "Customer replied; ticket reopened", authorEmail: user.email || "", authorUid: user.uid, createdAtMs: now, createdAt: FieldValue.serverTimestamp() });
  }
  await notifyStaffCustomerReply(ref.id, t, text);
  return { ok: true };
}

// Which stored attachment a given case/index refers to (ownership is checked by loadMine).
export async function myCaseAttachment({ user, id, index }) {
  const { t } = await loadMine(user, id);
  const a = (t.attachments || [])[parseInt(index, 10)];
  if (!a || a.purged) throw { status: 404, message: "Attachment not found" };
  return a;
}

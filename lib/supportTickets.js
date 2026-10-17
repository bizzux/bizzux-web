// SERVER ONLY. Customer Support ticketing, linked to the same organization id
// as everything else (organizations/{id} == customers/{id}). Staff workspace
// only: tickets are logged by Bizzux support staff (from a call, email or chat)
// on behalf of a customer; customers don't submit them yet.
//
//   supportTickets/{id}            the ticket
//   supportTickets/{id}/notes/{n}  append-only timeline (notes + system events);
//                                  never edited or deleted, so it's a reliable record
//   counters/supportTickets        { next } for human ticket numbers (BZX-1001...)
//
// Permission: support.tickets (Owner, Platform Admin, Support Agent). Billing
// Administrators and customer-side admins have none. Creation, assignment,
// status changes and closures are also written to the audit log against the
// organization, so they show in its Audit trail.
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";
import { logAuditEvent } from "./audit";
import { hasPermission } from "./platformRoles";

export const TICKETS = "supportTickets";
export const STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed"];
export const OPEN_STATUSES = ["open", "in_progress", "waiting_customer"];
export const PRIORITIES = ["low", "normal", "high", "urgent"];
export const CATEGORIES = ["technical", "billing", "onboarding", "how_to", "account_access", "other"];
const FIRST_NUMBER = 1001;

const str = (v, n) => String(v ?? "").trim().slice(0, n);
const toIso = (ms) => (ms ? new Date(ms).toISOString() : null);

export async function assertTicketPermission(actor) {
  let stored = null;
  if (actor.platformRole && actor.platformRole !== "OWNER") {
    const snap = await adminDb().doc("platformAdmins/" + actor.uid).get();
    stored = snap.exists ? snap.data().permissions : null;
  }
  if (!hasPermission(actor.platformRole, stored, "support.tickets")) {
    throw { status: 403, message: "You don't have permission for this action (support.tickets)" };
  }
}

function publicTicket(id, t) {
  return {
    id, code: t.code, number: t.number, organizationId: t.organizationId, organizationName: t.organizationName || "",
    subject: t.subject, description: t.description || "", category: t.category, priority: t.priority, status: t.status,
    contactName: t.contactName || "", contactEmail: t.contactEmail || "", contactPhone: t.contactPhone || "",
    assigneeUid: t.assigneeUid || null, assigneeEmail: t.assigneeEmail || null,
    createdByEmail: t.createdByEmail, createdAt: toIso(t.createdAtMs), updatedAt: toIso(t.updatedAtMs),
    followUpAt: toIso(t.followUpAtMs), closedAt: toIso(t.closedAtMs), noteCount: t.noteCount || 0,
    source: t.source || "staff", appKey: t.appKey || null, requesterEmail: t.requesterEmail || null, requesterName: t.requesterName || null,
    awaitingStaff: !!t.awaitingStaff, context: t.context || null,
    // storage paths never leave the server; staff fetch an attachment by ticket id + index
    attachments: (t.attachments || []).map((a, index) => ({ index, name: a.name, size: a.size, contentType: a.contentType })),
  };
}

// An assignee must be active staff who themselves hold support.tickets.
async function resolveAssignee(uid) {
  if (!uid) return null;
  const snap = await adminDb().doc("platformAdmins/" + uid).get();
  const d = snap.exists ? snap.data() : null;
  if (!d || d.status === "disabled" || !hasPermission(d.role, d.permissions, "support.tickets")) {
    throw { status: 400, message: "That person can't be assigned tickets (not active support staff)" };
  }
  return { uid, email: d.email || "" };
}

function parseFollowUp(v) {
  if (v === null || v === "" || v === undefined) return null;
  const d = new Date(String(v).length <= 10 ? v + "T09:00:00" : v);
  if (isNaN(d)) throw { status: 400, message: "Follow-up date is not valid" };
  return d.getTime();
}

async function nextNumber(tx) {
  const ref = adminDb().doc("counters/supportTickets");
  const s = await tx.get(ref);
  const n = s.exists && s.data().next ? s.data().next : FIRST_NUMBER;
  tx.set(ref, { next: n + 1 }, { merge: true });
  return n;
}

async function addTimeline(ref, entry) {
  // visibility: "internal" (staff only) today; "public" will be what a customer can see
  await ref.collection("notes").add({ visibility: "internal", ...entry, createdAtMs: Date.now(), createdAt: FieldValue.serverTimestamp() });
}

export async function createTicket({ actor, body }) {
  await assertTicketPermission(actor);
  const db = adminDb();
  const orgId = str(body.organizationId, 128);
  if (!orgId) throw { status: 400, message: "Choose the organization this ticket is about" };
  const org = await db.doc("organizations/" + orgId).get();
  if (!org.exists) throw { status: 404, message: "Organization not found" };
  const subject = str(body.subject, 160);
  if (subject.length < 3) throw { status: 400, message: "Subject is required" };
  const category = CATEGORIES.includes(body.category) ? body.category : "other";
  const priority = PRIORITIES.includes(body.priority) ? body.priority : "normal";
  const assignee = await resolveAssignee(str(body.assigneeUid, 128) || null);
  const followUpAtMs = parseFollowUp(body.followUpAt);
  const now = Date.now();
  const ref = db.collection(TICKETS).doc();
  const orgData = org.data();
  const number = await db.runTransaction(async (tx) => {
    const n = await nextNumber(tx);
    tx.set(ref, {
      number: n, code: "BZX-" + n, organizationId: orgId, organizationName: orgData.organizationName || orgData.name || "",
      subject, description: str(body.description, 4000), category, priority, status: "open",
      contactName: str(body.contactName, 80), contactEmail: str(body.contactEmail, 200).toLowerCase(), contactPhone: str(body.contactPhone, 20),
      assigneeUid: assignee?.uid || null, assigneeEmail: assignee?.email || null,
      // source/appKey/requester*/attachments are in place for customer-submitted cases from the apps
      source: "staff", appKey: null, requesterUid: null, attachments: [], awaitingStaff: false,
      createdByUid: actor.uid, createdByEmail: actor.email || "", createdAtMs: now, updatedAtMs: now,
      followUpAtMs, closedAtMs: null, noteCount: 0,
    });
    return n;
  });
  await addTimeline(ref, { kind: "event", body: "Ticket created", authorEmail: actor.email || "", authorUid: actor.uid });
  await logAuditEvent({
    action: "support_ticket.created", actor, targetType: "organization", targetId: orgId,
    details: { ticketId: ref.id, code: "BZX-" + number, subject, priority, category, assignee: assignee?.email || null },
  });
  const saved = await ref.get();
  return publicTicket(ref.id, saved.data());
}

export async function getTicket({ actor, id }) {
  await assertTicketPermission(actor);
  const ref = adminDb().doc(TICKETS + "/" + str(id, 128));
  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: "Ticket not found" };
  const notes = await ref.collection("notes").orderBy("createdAtMs", "asc").limit(300).get();
  return {
    ticket: publicTicket(ref.id, snap.data()),
    notes: notes.docs.map((d) => ({ id: d.id, kind: d.data().kind, visibility: d.data().visibility || "internal", body: d.data().body, authorEmail: d.data().authorEmail, createdAt: toIso(d.data().createdAtMs) })),
  };
}

export async function addNote({ actor, id, body, visibility }) {
  await assertTicketPermission(actor);
  const text = str(body, 4000);
  const pub = visibility === "public";
  if (!text) throw { status: 400, message: "Write a note first" };
  const ref = adminDb().doc(TICKETS + "/" + str(id, 128));
  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: "Ticket not found" };
  await addTimeline(ref, { kind: "note", body: text, authorEmail: actor.email || "", authorUid: actor.uid, visibility: pub ? "public" : "internal" });
  // a public reply means the customer has been answered
  await ref.update({ updatedAtMs: Date.now(), noteCount: FieldValue.increment(1), ...(pub ? { awaitingStaff: false } : {}) });
  return { ok: true };
}

export async function updateTicket({ actor, id, patch }) {
  await assertTicketPermission(actor);
  const ref = adminDb().doc(TICKETS + "/" + str(id, 128));
  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: "Ticket not found" };
  const t = snap.data();
  const set = {};
  const events = [];
  const audit = [];

  if (patch.status !== undefined && patch.status !== t.status) {
    if (!STATUSES.includes(patch.status)) throw { status: 400, message: "Invalid status" };
    set.status = patch.status;
    set.closedAtMs = patch.status === "closed" || patch.status === "resolved" ? Date.now() : null;
    events.push(`Status changed: ${t.status} → ${patch.status}`);
    audit.push(["support_ticket.status", { from: t.status, to: patch.status }]);
  }
  if (patch.priority !== undefined && patch.priority !== t.priority) {
    if (!PRIORITIES.includes(patch.priority)) throw { status: 400, message: "Invalid priority" };
    set.priority = patch.priority;
    events.push(`Priority changed: ${t.priority} → ${patch.priority}`);
  }
  if (patch.category !== undefined && patch.category !== t.category) {
    if (!CATEGORIES.includes(patch.category)) throw { status: 400, message: "Invalid category" };
    set.category = patch.category;
  }
  if (patch.assigneeUid !== undefined && (patch.assigneeUid || null) !== (t.assigneeUid || null)) {
    const a = await resolveAssignee(str(patch.assigneeUid, 128) || null);
    set.assigneeUid = a?.uid || null; set.assigneeEmail = a?.email || null;
    events.push(a ? `Assigned to ${a.email}` : "Unassigned");
    audit.push(["support_ticket.assigned", { from: t.assigneeEmail || null, to: a?.email || null }]);
  }
  if (patch.followUpAt !== undefined) {
    const ms = parseFollowUp(patch.followUpAt);
    if (ms !== (t.followUpAtMs || null)) {
      set.followUpAtMs = ms;
      events.push(ms ? "Follow-up set for " + new Date(ms).toLocaleDateString("en-GB") : "Follow-up cleared");
    }
  }
  if (patch.subject !== undefined && str(patch.subject, 160) !== t.subject) {
    const s = str(patch.subject, 160);
    if (s.length < 3) throw { status: 400, message: "Subject is required" };
    set.subject = s;
    events.push("Subject edited");
  }
  if (!Object.keys(set).length) return { ok: true, unchanged: true };
  set.updatedAtMs = Date.now();
  await ref.update(set);
  for (const e of events) await addTimeline(ref, { kind: "event", body: e, authorEmail: actor.email || "", authorUid: actor.uid });
  for (const [action, details] of audit) {
    await logAuditEvent({ action, actor, targetType: "organization", targetId: t.organizationId, details: { ticketId: ref.id, code: t.code, ...details } });
  }
  const fresh = await ref.get();
  return { ok: true, ticket: publicTicket(ref.id, fresh.data()) };
}

const encodeCursor = (v, id) => Buffer.from(JSON.stringify({ v, id })).toString("base64url");
const decodeCursor = (c) => { try { const d = JSON.parse(Buffer.from(String(c), "base64url").toString("utf8")); return d && "v" in d && d.id ? d : null; } catch { return null; } };

// Server-side filtering, sorting (most recently updated first) and cursor
// pagination. One condition is pushed to Firestore (organization, else the
// exact status, else assignee, else priority, each indexed); the rest filter
// the fetched batch, which keeps loading until the page is full.
export async function listTickets({ actor, status = "open", assignee, priority, organizationId, due = false, awaiting = false, limit = 25, cursor } = {}) {
  await assertTicketPermission(actor);
  limit = Math.max(1, Math.min(100, parseInt(limit, 10) || 25));
  const me = actor.uid;
  const assigneeUid = assignee === "me" ? me : assignee && assignee !== "unassigned" && assignee !== "any" ? assignee : null;
  const statusSet = status === "all" ? null : status === "open" ? OPEN_STATUSES : STATUSES.includes(status) ? [status] : OPEN_STATUSES;
  const exactStatus = statusSet && statusSet.length === 1 ? statusSet[0] : null;
  const orgId = organizationId ? str(organizationId, 128) : null;
  const serverField = orgId ? ["organizationId", orgId] : exactStatus ? ["status", exactStatus] : assigneeUid ? ["assigneeUid", assigneeUid] : priority && PRIORITIES.includes(priority) ? ["priority", priority] : null;
  const now = Date.now();

  const match = (t) =>
    (!statusSet || statusSet.includes(t.status)) &&
    (!assigneeUid || t.assigneeUid === assigneeUid) &&
    (assignee !== "unassigned" || !t.assigneeUid) &&
    (!priority || !PRIORITIES.includes(priority) || t.priority === priority) &&
    (!orgId || t.organizationId === orgId) &&
    (!awaiting || (t.awaitingStaff === true && OPEN_STATUSES.includes(t.status))) &&
    (!due || (t.followUpAtMs && t.followUpAtMs <= now && OPEN_STATUSES.includes(t.status)));

  const cur = cursor ? decodeCursor(cursor) : null;
  if (cursor && !cur) throw { status: 400, message: "Invalid cursor" };
  const rows = [];
  let last = cur, exhausted = false;
  const batch = Math.max(50, limit * 2);
  for (let i = 0; i < 6 && rows.length < limit + 1 && !exhausted; i++) {
    let q = adminDb().collection(TICKETS);
    if (serverField) q = q.where(serverField[0], "==", serverField[1]);
    q = q.orderBy("updatedAtMs", "desc").orderBy(FieldPath.documentId(), "desc");
    if (last) q = q.startAfter(last.v, last.id);
    const snap = await q.limit(batch).get();
    if (snap.size < batch) exhausted = true;
    for (const d of snap.docs) {
      const t = d.data();
      last = { v: t.updatedAtMs, id: d.id };
      if (match(t)) rows.push(publicTicket(d.id, t));
    }
  }
  const page = rows.slice(0, limit);
  const lastRow = page[page.length - 1];
  let nextCursor = null;
  if (rows.length > limit && lastRow) nextCursor = encodeCursor(new Date(lastRow.updatedAt).getTime(), lastRow.id);
  else if (!exhausted && last) nextCursor = encodeCursor(last.v, last.id);
  return { tickets: page, nextCursor };
}

// Headline numbers via count() aggregates (about 1 read per 1,000 matches).
export async function ticketSummary({ actor }) {
  await assertTicketPermission(actor);
  const col = adminDb().collection(TICKETS);
  const count = async (q) => (await q.count().get()).data().count;
  const [open, mine, urgent, due, awaiting] = await Promise.all([
    count(col.where("status", "in", OPEN_STATUSES)),
    count(col.where("status", "in", OPEN_STATUSES).where("assigneeUid", "==", actor.uid)),
    count(col.where("status", "in", OPEN_STATUSES).where("priority", "==", "urgent")),
    count(col.where("followUpAtMs", "<=", Date.now()).where("status", "in", OPEN_STATUSES)),
    count(col.where("awaitingStaff", "==", true).where("status", "in", OPEN_STATUSES)),
  ]);
  return { open, mine, urgent, followUpsDue: due, awaitingReply: awaiting };
}

export async function listAssignees({ actor }) {
  await assertTicketPermission(actor);
  const snap = await adminDb().collection("platformAdmins").get();
  return snap.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .filter((d) => d.status !== "disabled" && hasPermission(d.role, d.permissions, "support.tickets"))
    .map((d) => ({ uid: d.uid, email: d.email || "", role: d.role }));
}

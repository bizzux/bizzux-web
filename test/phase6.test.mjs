// Phase 6: customer case submission from the apps (isolation, public/internal
// separation, attachments, rate limits) and how it surfaces to support staff.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import * as nodeCrypto from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "test@demo-bizzux.iam.gserviceaccount.com" });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run via firebase emulators:exec");

const fa = await import("../lib/firebaseAdmin.js");
const cases = await import("../lib/supportCases.js");
const casesRoute = await import("../app/api/support/cases/route.js");
const attRoute = await import("../app/api/support/attachment/route.js");
const staffRoute = await import("../app/api/admin/support-tickets/route.js");
const staffAttRoute = await import("../app/api/admin/support-attachment/route.js");
const { createOrganization } = await import("../lib/organization.js");
const db = fa.adminDb();
const rnd = () => Math.random().toString(36).slice(2, 8);

async function signIn(email) {
  const u = await fa.adminAuth().createUser({ email, password: "Passw0rd-" + rnd() });
  const custom = await fa.adminAuth().createCustomToken(u.uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  return { uid: u.uid, email, token: (await r.json()).idToken };
}
const hdr = (w) => ({ Authorization: "Bearer " + w.token, "Content-Type": "application/json" });
const call = async (fn, w, url, body) => { const r = await fn(new Request("http://x/" + url, body ? { method: "POST", headers: hdr(w), body: JSON.stringify(body) } : { headers: hdr(w) })); return { status: r.status, body: await r.json().catch(() => null) }; };
const cPost = (w, body) => call(casesRoute.POST, w, "c", body);
const cGet = (w, qs = "") => call(casesRoute.GET, w, "c" + qs);
const sPost = (w, body) => call(staffRoute.POST, w, "s", body);
const sGet = (w, qs = "") => call(staffRoute.GET, w, "s" + qs);

// a stand-in for the private blob store
const store = new Map();
const fakeBlob = {
  put: async (path, body, opts) => { store.set(path, { size: body.length, contentType: opts.contentType }); },
  head: async (path) => { const s = store.get(path); if (!s) throw new Error("not found"); return s; },
  del: async (path) => { if (!store.delete(path)) throw new Error("not found"); },
};
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 2)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(300, 3)]);

let ownerA, empA, ownerB, support, billing, orgA, orgB;
before(async () => {
  ownerA = await signIn("p6ownerA-" + rnd() + "@example.test");
  empA = await signIn("p6empA-" + rnd() + "@example.test");
  ownerB = await signIn("p6ownerB-" + rnd() + "@example.test");
  support = await signIn("p6support-" + rnd() + "@bizzux.test");
  billing = await signIn("p6bill-" + rnd() + "@bizzux.test");
  await db.doc("platformAdmins/" + support.uid).set({ email: support.email, role: "SUPPORT_AGENT", status: "active", permissions: null });
  await db.doc("platformAdmins/" + billing.uid).set({ email: billing.email, role: "BILLING_ADMIN", status: "active", permissions: null });
  orgA = ownerA.uid; orgB = ownerB.uid;
  for (const [id, name, u] of [[orgA, "Attendance Customer A", ownerA], [orgB, "Other Customer B", ownerB]]) {
    await createOrganization({ id, name, type: "CUSTOMER", createdBy: id });
    await db.doc("customers/" + id).set({ email: u.email, organizationName: name, status: "trial" });
  }
  // an employee of organization A (memberships/{uid}), not its owner
  await db.doc("memberships/" + empA.uid).set({ accountId: orgA, profile: "Staff/Shopkeeper" });
});

const good = { action: "create", subject: "Check-in button does nothing", description: "Tap check in on my phone and nothing happens.", category: "technical", appKey: "attendance", context: { page: "/my-attendance", appVersion: "build-42", userAgent: "TestBrowser/1.0", screen: "390x844" } };

test("an app user raises a case: organization comes from their account, customers can't set staff fields", async () => {
  const r = await cPost(empA, { ...good, organizationId: orgB, priority: "urgent", assigneeUid: support.uid, status: "closed", followUpAt: "2030-01-01" });
  assert.equal(r.status, 200);
  assert.equal(r.body.case.statusLabel, "Received"); assert.match(r.body.case.code, /^BZX-\d+$/);
  const t = (await db.doc("supportTickets/" + r.body.case.id).get()).data();
  assert.equal(t.organizationId, orgA, "organization is taken from the caller's own account, not the request");
  assert.equal(t.source, "app"); assert.equal(t.appKey, "attendance"); assert.equal(t.requesterUid, empA.uid);
  assert.equal(t.priority, "normal"); assert.equal(t.status, "open"); assert.equal(t.assigneeUid, null); assert.equal(t.followUpAtMs, null);
  assert.equal(t.awaitingStaff, true); assert.equal(t.context.page, "/my-attendance");
  assert.equal(t.contactEmail, empA.email.toLowerCase());
  const audit = (await db.collection("auditLogs").where("targetId", "==", orgA).get()).docs.map((d) => d.data()).find((a) => a.action === "support_ticket.created" && a.details.ticketId === r.body.case.id);
  assert.equal(audit.details.source, "app"); assert.equal(audit.actorEmail, empA.email.toLowerCase());
});

test("validation, authentication and rate limit", async () => {
  assert.equal((await cPost(ownerA, { ...good, subject: "x" })).status, 400);
  assert.equal((await cPost(ownerA, { ...good, description: "no" })).status, 400);
  assert.equal((await casesRoute.GET(new Request("http://x/c", { headers: {} }))).status, 401);
  assert.equal((await cPost(support, good)).status, 404, "platform staff without a customer account can't raise cases");
  const u = await signIn("p6rate-" + rnd() + "@example.test");
  await db.doc("customers/" + u.uid).set({ email: u.email, organizationName: "Rate Co", status: "trial" });
  await createOrganization({ id: u.uid, name: "Rate Co", type: "CUSTOMER", createdBy: u.uid });
  for (let i = 0; i < cases.CASES_PER_HOUR; i++) assert.equal((await cPost(u, { ...good, subject: "Case number " + i })).status, 200);
  assert.equal((await cPost(u, { ...good, subject: "One too many" })).status, 429);
});

test("isolation: users see only their own cases; other organizations and colleagues get 'not found'", async () => {
  const mine = (await cPost(empA, { ...good, subject: "Private to empA" })).body.case;
  const list = (await cGet(empA)).body.cases;
  assert.ok(list.some((c) => c.id === mine.id));
  assert.ok(list.every((c) => c.subject !== "Other customer's case"));
  const theirs = (await cPost(ownerB, { ...good, subject: "Other customer's case" })).body.case;
  assert.ok(!(await cGet(empA)).body.cases.some((c) => c.id === theirs.id));
  assert.equal((await cGet(empA, "?id=" + theirs.id)).status, 404, "other organization");
  assert.equal((await cGet(ownerA, "?id=" + mine.id)).status, 404, "same organization, different person");
  assert.equal((await cPost(ownerB, { action: "reply", id: mine.id, body: "hijack" })).status, 404);
  assert.equal((await cGet(empA, "?id=does-not-exist")).status, 404);
  const att = await call(attRoute.GET, ownerB, "a?case=" + mine.id + "&i=0");
  assert.equal(att.status, 404);
  // staff attachment viewer: customers, billing and anonymous are refused
  assert.equal((await call(staffAttRoute.GET, empA, "a?ticket=" + mine.id + "&i=0")).status, 403);
  assert.equal((await call(staffAttRoute.GET, billing, "a?ticket=" + mine.id + "&i=0")).status, 403);
  assert.equal((await call(staffAttRoute.GET, support, "a?ticket=nope&i=0")).status, 404);
});

test("public vs internal: customers never see internal notes, events, assignee, priority or storage paths", async () => {
  const c = (await cPost(empA, { ...good, subject: "Thread test" })).body.case;
  const id = c.id;
  assert.equal((await sPost(support, { action: "note", id, body: "INTERNAL: looks like a geofence issue" })).status, 200);
  assert.equal((await sPost(support, { action: "update", id, patch: { priority: "high", assigneeUid: support.uid, status: "waiting_customer" } })).status, 200);
  assert.equal((await sPost(support, { action: "note", id, body: "Hi, could you tell us which phone you use?", visibility: "public" })).status, 200);
  let view = (await cGet(empA, "?id=" + id)).body;
  assert.deepEqual(view.messages.map((m) => [m.from, m.body]), [["support", "Hi, could you tell us which phone you use?"]]);
  assert.equal(view.case.statusLabel, "Waiting for your reply");
  const raw = JSON.stringify(view);
  for (const leak of ["INTERNAL", "geofence", "priority", "assignee", "support/", "Ticket created", "awaitingStaff"]) assert.ok(!raw.includes(leak), "leaked: " + leak);
  // staff see everything, flagged
  const staff = (await sGet(support, "?id=" + id)).body;
  assert.ok(staff.notes.some((n) => n.visibility === "internal" && n.body.startsWith("INTERNAL")));
  assert.equal(staff.ticket.awaitingStaff, false, "a public reply marks the customer as answered");
  assert.equal(staff.ticket.source, "app"); assert.equal(staff.ticket.requesterEmail, empA.email.toLowerCase());

  // customer answers: back to open, awaiting staff; resolved tickets reopen
  assert.equal((await cPost(empA, { action: "reply", id, body: "It's a Samsung A14." })).status, 200);
  assert.equal((await cPost(empA, { action: "reply", id, body: "   " })).status, 400);
  view = (await cGet(empA, "?id=" + id)).body;
  assert.deepEqual(view.messages.map((m) => m.from), ["support", "you"]);
  let t = (await sGet(support, "?id=" + id)).body.ticket;
  assert.equal(t.status, "open"); assert.equal(t.awaitingStaff, true);
  await sPost(support, { action: "update", id, patch: { status: "resolved" } });
  assert.equal((await cGet(empA, "?id=" + id)).body.case.statusLabel, "Resolved");
  await cPost(empA, { action: "reply", id, body: "Still happening, sorry." });
  t = (await sGet(support, "?id=" + id)).body.ticket;
  assert.equal(t.status, "open"); assert.equal(t.closedAt, null);

  // workspace: awaiting-reply filter and tile
  const awaiting = (await sGet(support, "?awaiting=1&limit=100")).body.tickets;
  assert.ok(awaiting.some((x) => x.id === id) && awaiting.every((x) => x.awaitingStaff));
  assert.ok((await sGet(support, "?summary=1")).body.awaitingReply >= 1);
  await sPost(support, { action: "note", id, body: "Fixed in the next release.", visibility: "public" });
  assert.ok(!(await sGet(support, "?awaiting=1&limit=100")).body.tickets.some((x) => x.id === id));
});

test("screenshots: real image types only, up to 3, size-limited, only the uploader can attach them", async () => {
  const acctA = { accountId: orgA, profile: "Staff/Shopkeeper" };
  const up = (buf, who = empA, acct = acctA) => cases.storeCaseAttachment({ acct, uid: who.uid, file: buf, blob: fakeBlob });
  const png = await up(PNG), jpg = await up(JPG), webp = await up(WEBP);
  assert.equal(png.contentType, "image/png"); assert.equal(jpg.contentType, "image/jpeg"); assert.equal(webp.contentType, "image/webp");
  assert.ok(png.path.startsWith(`support/${orgA}/${empA.uid}/`));
  await assert.rejects(up(Buffer.from("<script>alert(1)</script>".padEnd(200, " "))), (e) => e.status === 400, "html/svg/text are not images");
  await assert.rejects(up(Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(300)])), (e) => e.status === 400, "pdf rejected");
  await assert.rejects(up(Buffer.alloc(cases.MAX_UPLOAD_BYTES + 1, 1)), (e) => e.status === 413);
  await assert.rejects(up(Buffer.alloc(0)), (e) => e.status === 400);

  const mk = (list, who = empA, acct = acctA) => cases.createCase({
    user: { uid: who.uid, email: who.email }, acct, body: { ...good, subject: "With screenshots " + rnd(), attachments: list }, blob: fakeBlob,
  });
  const ok = await mk([png, jpg, webp].map((a, i) => ({ ...a, name: "shot" + i + ".png" })));
  assert.equal(ok.attachments.length, 3); assert.ok(ok.attachments.every((a) => !("path" in a)), "customers never get storage paths");
  await assert.rejects(mk([png, jpg, webp, png]), (e) => e.status === 400, "max 3");
  await assert.rejects(mk([{ path: png.path.replace(empA.uid, ownerB.uid), name: "x" }]), (e) => e.status === 400, "someone else's path");
  await assert.rejects(mk([{ path: `support/${orgB}/${empA.uid}/x.png`, name: "x" }]), (e) => e.status === 400, "other organization's path");
  await assert.rejects(mk([{ path: `support/${orgA}/${empA.uid}/../../${ownerB.uid}/x.png`, name: "x" }]), (e) => e.status === 400, "path traversal");
  await assert.rejects(mk([{ path: `support/${orgA}/${empA.uid}/never-uploaded.png`, name: "x" }]), (e) => e.status === 400, "not uploaded");
  // a colleague can't attach my upload
  await assert.rejects(mk([png], ownerA, { accountId: orgA }), (e) => e.status === 400);

  // staff view: metadata only, never paths; viewing a screenshot is audited
  const staff = (await sGet(support, "?id=" + ok.id)).body.ticket;
  assert.equal(staff.attachments.length, 3);
  assert.ok(staff.attachments.every((a) => a.name && a.size && a.contentType && !("path" in a)));
  const stored = (await db.doc("supportTickets/" + ok.id).get()).data().attachments;
  assert.ok(stored.every((a) => a.path.startsWith(`support/${orgA}/${empA.uid}/`)));
  assert.ok(!JSON.stringify((await cGet(empA, "?id=" + ok.id)).body).includes("support/" + orgA));
});

// ---------------------------------------------------------------------------
// Email notifications
// ---------------------------------------------------------------------------
const resetRate = async (u) => { for (const k of ["case", "reply"]) await db.doc("supportRate/" + u.uid + "_" + k).delete(); };
const mailLib = await import("../lib/supportEmail.js");
const retention = await import("../lib/supportRetention.js");
const sentMail = [];
mailLib.setMailer(async (m) => { sentMail.push(m); return { sent: true }; });
const mailsFor = (needle) => sentMail.filter((m) => m.subject.includes(needle));

test("emails: staff hear about new cases and customer replies; customers hear about public replies and resolution", async () => {
  await resetRate(empA);
  process.env.SUPPORT_NOTIFY_EMAILS = "support-inbox@bizzux.test";
  const tag = "Mail" + rnd();
  const c = (await cPost(empA, { ...good, subject: `${tag} <b>bold</b> sync`, description: "Description <script>alert(1)</script> here", attachments: [] })).body.case;
  const created = mailsFor(c.code);
  assert.equal(created.length, 1); assert.deepEqual(created[0].to, ["support-inbox@bizzux.test"]);
  assert.ok(created[0].subject.includes("New case")); assert.ok(created[0].html.includes("Attendance Customer A"));
  assert.ok(created[0].html.includes("&lt;b&gt;bold&lt;/b&gt;") && !created[0].html.includes("<script>"), "customer text is HTML-escaped");
  assert.ok(created[0].html.includes("/admin#org=" + orgA + "&amp;tab=support") || created[0].html.includes("/admin#org=" + orgA + "&tab=support"));

  // customer reply -> staff, but only once per throttle window
  await cPost(empA, { action: "reply", id: c.id, body: "First follow up" });
  await cPost(empA, { action: "reply", id: c.id, body: "Second follow up right after" });
  assert.equal(mailsFor(c.code).filter((m) => m.subject.includes("Customer replied")).length, 1, "throttled");
  await db.doc("supportTickets/" + c.id).update({ lastStaffEmailAtMs: Date.now() - mailLib.STAFF_FOLLOWUP_THROTTLE_MS - 1000 });
  await cPost(empA, { action: "reply", id: c.id, body: "Third follow up later" });
  assert.equal(mailsFor(c.code).filter((m) => m.subject.includes("Customer replied")).length, 2);

  // internal notes never email anyone; public reply -> the customer only
  const before = sentMail.length;
  await sPost(support, { action: "note", id: c.id, body: "INTERNAL secret note" });
  assert.equal(sentMail.length, before, "internal note sends nothing");
  await sPost(support, { action: "note", id: c.id, body: "We found the problem, update coming.", visibility: "public" });
  const toCustomer = sentMail.at(-1);
  assert.deepEqual(toCustomer.to, empA.email.toLowerCase()); assert.ok(toCustomer.subject.includes("Bizzux support replied"));
  assert.ok(toCustomer.html.includes("We found the problem") && !toCustomer.html.includes("INTERNAL"));
  assert.ok(toCustomer.html.includes("attendance.bizzux.com"));

  // resolving emails the customer once; other status changes don't
  const n = sentMail.length;
  await sPost(support, { action: "update", id: c.id, patch: { status: "in_progress" } });
  assert.equal(sentMail.length, n);
  await sPost(support, { action: "update", id: c.id, patch: { status: "resolved" } });
  assert.ok(sentMail.at(-1).subject.includes("Marked resolved") && sentMail.at(-1).to === empA.email.toLowerCase());

  // staff-created tickets have no customer to email
  const staffTicket = (await sPost(support, { action: "create", organizationId: orgA, subject: "Logged from a phone call" })).body.ticket;
  const m = sentMail.length;
  await sPost(support, { action: "note", id: staffTicket.id, body: "Called them back", visibility: "public" });
  await sPost(support, { action: "update", id: staffTicket.id, patch: { status: "resolved" } });
  assert.equal(sentMail.length, m);
});

test("emails: default recipients, assignee routing, disable switch, and a mail failure never breaks the case", async () => {
  await resetRate(empA);
  delete process.env.SUPPORT_NOTIFY_EMAILS;
  let c = (await cPost(empA, { ...good, subject: "Recipients " + rnd() })).body.case;
  let to = mailsFor(c.code)[0].to;
  assert.ok(to.includes(support.email) && !to.includes(billing.email), "everyone who can work tickets, not billing");
  // assigned -> only the assignee hears about follow-ups
  await sPost(support, { action: "update", id: c.id, patch: { assigneeUid: support.uid } });
  await cPost(empA, { action: "reply", id: c.id, body: "Any news?" });
  assert.deepEqual(mailsFor(c.code).filter((x) => x.subject.includes("Customer replied")).at(-1).to, [support.email]);

  // switched off
  process.env.SUPPORT_EMAILS_DISABLED = "1";
  const n = sentMail.length;
  c = (await cPost(empA, { ...good, subject: "Disabled " + rnd() })).body.case;
  assert.equal(sentMail.length, n);
  delete process.env.SUPPORT_EMAILS_DISABLED;

  await resetRate(empA);
  // transport throws -> case still created, reply still saved
  const prev = mailLib.setMailer(async () => { throw new Error("Resend is down"); });
  const ok = await cPost(empA, { ...good, subject: "Mail down " + rnd() });
  assert.equal(ok.status, 200);
  assert.equal((await cPost(empA, { action: "reply", id: ok.body.case.id, body: "still works" })).status, 200);
  assert.equal((await sPost(support, { action: "note", id: ok.body.case.id, body: "public while mail is down", visibility: "public" })).status, 200);
  mailLib.setMailer(prev);
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------
test("retention: screenshots are removed after the period for closed tickets; reopening stops the clock", async () => {
  await resetRate(empA);
  const acctA = { accountId: orgA, profile: "Staff/Shopkeeper" };
  const up = (buf) => cases.storeCaseAttachment({ acct: acctA, uid: empA.uid, file: buf, blob: fakeBlob });
  const a1 = await up(PNG), a2 = await up(JPG);
  const mkCase = async (atts) => cases.createCase({ user: { uid: empA.uid, email: empA.email }, acct: acctA, body: { ...good, subject: "Retention " + rnd(), attachments: atts }, blob: fakeBlob });
  const withShots = await mkCase([a1, a2]);
  const reg = (p) => db.doc("supportUploads/" + nodeCrypto.createHash("sha1").update(p).digest("hex").slice(0, 32)).get();
  assert.equal((await reg(a1.path)).data().linked, true, "linked to the case");

  // closing starts the clock only for tickets that have screenshots
  await sPost(support, { action: "update", id: withShots.id, patch: { status: "resolved" } });
  const t = (await db.doc("supportTickets/" + withShots.id).get()).data();
  assert.ok(Math.abs(t.purgeAttachmentsAtMs - (t.closedAtMs + 90 * 864e5)) < 1000);
  const plain = await mkCase([]);
  await sPost(support, { action: "update", id: plain.id, patch: { status: "closed" } });
  assert.equal((await db.doc("supportTickets/" + plain.id).get()).data().purgeAttachmentsAtMs, undefined);

  // reopening (staff or customer) stops it; closing again restarts it
  await sPost(support, { action: "update", id: withShots.id, patch: { status: "open" } });
  assert.equal((await db.doc("supportTickets/" + withShots.id).get()).data().purgeAttachmentsAtMs, undefined);
  await sPost(support, { action: "update", id: withShots.id, patch: { status: "resolved" } });
  await cPost(empA, { action: "reply", id: withShots.id, body: "Not fixed" });
  assert.equal((await db.doc("supportTickets/" + withShots.id).get()).data().purgeAttachmentsAtMs, undefined, "customer reopen clears it");
  await sPost(support, { action: "update", id: withShots.id, patch: { status: "closed" } });

  // not due yet -> nothing happens; dry run reports but deletes nothing
  const early = await retention.runSupportRetention({ blob: fakeBlob, now: Date.now() + 30 * 864e5 });
  assert.equal(early.ticketsPurged, 0); assert.ok(store.has(a1.path));
  const dry = await retention.runSupportRetention({ blob: fakeBlob, now: Date.now() + 91 * 864e5, dryRun: true });
  assert.equal(dry.dryRun, true); assert.ok(dry.ticketsDue >= 1 && dry.ticketsPurged === 0 && store.has(a1.path) && store.has(a2.path));
  assert.equal(dry.writes, 0);

  // due -> files deleted, ticket keeps its text with a purged marker, audited
  const run = await retention.runSupportRetention({ blob: fakeBlob, now: Date.now() + 91 * 864e5 });
  assert.ok(run.ticketsPurged >= 1 && run.filesDeleted >= 2); assert.deepEqual(run.errors, []);
  assert.ok(!store.has(a1.path) && !store.has(a2.path));
  const after = (await db.doc("supportTickets/" + withShots.id).get()).data();
  assert.equal(after.subject.startsWith("Retention"), true); assert.equal(after.purgeAttachmentsAtMs, undefined);
  assert.ok(after.attachments.length === 2 && after.attachments.every((a) => a.purged && !a.path && a.name));
  assert.equal((await reg(a1.path)).exists, false, "registry cleaned");
  const staffView = (await sGet(support, "?id=" + withShots.id)).body;
  assert.ok(staffView.ticket.attachments.every((a) => a.purged));
  assert.ok(staffView.notes.some((n) => n.body.includes("Screenshots removed after the 90-day retention")));
  assert.equal((await call(staffAttRoute.GET, support, "a?ticket=" + withShots.id + "&i=0")).status, 404);
  assert.equal((await call(attRoute.GET, empA, "a?case=" + withShots.id + "&i=0")).status, 404);
  assert.ok((await cGet(empA, "?id=" + withShots.id)).body.case.attachments.every((a) => a.purged));
  assert.ok((await db.collection("auditLogs").where("targetId", "==", orgA).get()).docs.some((d) => d.data().action === "support_ticket.attachments_purged" && d.data().details.ticketId === withShots.id));
  // idempotent
  const again = await retention.runSupportRetention({ blob: fakeBlob, now: Date.now() + 91 * 864e5 });
  assert.equal(again.filesDeleted, 0);
});

test("retention: abandoned uploads are removed after 24h; linked and recent ones are kept; period is configurable", async () => {
  await resetRate(empA);
  const acctA = { accountId: orgA, profile: "Staff/Shopkeeper" };
  const up = (buf) => cases.storeCaseAttachment({ acct: acctA, uid: empA.uid, file: buf, blob: fakeBlob });
  const abandoned = await up(PNG), recent = await up(JPG), kept = await up(WEBP);
  const idOf = (p) => nodeCrypto.createHash("sha1").update(p).digest("hex").slice(0, 32);
  await db.doc("supportUploads/" + idOf(abandoned.path)).update({ createdAtMs: Date.now() - 25 * 3600 * 1000 });
  await db.doc("supportUploads/" + idOf(kept.path)).update({ createdAtMs: Date.now() - 48 * 3600 * 1000 });
  await cases.createCase({ user: { uid: empA.uid, email: empA.email }, acct: acctA, body: { ...good, subject: "Keeps its shot " + rnd(), attachments: [kept] }, blob: fakeBlob });

  const dry = await retention.runSupportRetention({ blob: fakeBlob, dryRun: true });
  assert.ok(dry.orphansFound >= 1 && store.has(abandoned.path));
  const run = await retention.runSupportRetention({ blob: fakeBlob });
  assert.ok(run.orphansDeleted >= 1);
  assert.ok(!store.has(abandoned.path), "abandoned upload removed");
  assert.ok(store.has(recent.path), "recent upload kept");
  assert.ok(store.has(kept.path), "attached upload kept even though older than 24h");

  assert.equal(retention.retentionDays(), 90);
  process.env.SUPPORT_ATTACHMENT_RETENTION_DAYS = "30"; assert.equal(retention.retentionDays(), 30);
  process.env.SUPPORT_ATTACHMENT_RETENTION_DAYS = "2"; assert.equal(retention.retentionDays(), 7, "never shorter than a week");
  process.env.SUPPORT_ATTACHMENT_RETENTION_DAYS = "nonsense"; assert.equal(retention.retentionDays(), 90);
  delete process.env.SUPPORT_ATTACHMENT_RETENTION_DAYS;
});

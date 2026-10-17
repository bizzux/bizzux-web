// Phase 6: customer case submission from the apps (isolation, public/internal
// separation, attachments, rate limits) and how it surfaces to support staff.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

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

// Phase 5: Customer Support ticketing (permissions, numbering, workflow, notes,
// server-side filtering and pagination, organization linkage).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "test@demo-bizzux.iam.gserviceaccount.com" });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run via firebase emulators:exec");

const fa = await import("../lib/firebaseAdmin.js");
const route = await import("../app/api/admin/support-tickets/route.js");
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
const post = async (w, body) => { const r = await route.POST(new Request("http://x/x", { method: "POST", headers: hdr(w), body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const get = async (w, qs = "") => { const r = await route.GET(new Request("http://x/x" + qs, { headers: hdr(w) })); return { status: r.status, body: await r.json() }; };
const audits = async (orgId, action) => (await db.collection("auditLogs").where("targetId", "==", orgId).get()).docs.map((d) => d.data()).filter((a) => a.action === action);

let owner, admin, support, support2, billing, custAdmin, disabledStaff, orgA, orgB;
before(async () => {
  owner = await signIn("p5owner-" + rnd() + "@bizzux.test");
  admin = await signIn("p5admin-" + rnd() + "@bizzux.test");
  support = await signIn("p5support-" + rnd() + "@bizzux.test");
  support2 = await signIn("p5support2-" + rnd() + "@bizzux.test");
  billing = await signIn("p5bill-" + rnd() + "@bizzux.test");
  custAdmin = await signIn("p5cust-" + rnd() + "@example.test");
  disabledStaff = await signIn("p5off-" + rnd() + "@bizzux.test");
  const role = (u, r, status = "active") => db.doc("platformAdmins/" + u.uid).set({ email: u.email, role: r, status, permissions: null });
  await role(owner, "OWNER"); await role(admin, "ADMIN"); await role(support, "SUPPORT_AGENT"); await role(support2, "SUPPORT_AGENT");
  await role(billing, "BILLING_ADMIN"); await role(disabledStaff, "SUPPORT_AGENT", "disabled");
  await db.doc("customers/" + custAdmin.uid).set({ email: custAdmin.email, organizationName: "Their Co", status: "trial" });
  await db.doc("memberships/" + custAdmin.uid).set({ accountId: custAdmin.uid, profile: "Global Admin" });
  orgA = "p5a-" + rnd(); orgB = "p5b-" + rnd();
  await createOrganization({ id: orgA, name: "Alpha Marine " + rnd(), type: "CUSTOMER", createdBy: "x" });
  await createOrganization({ id: orgB, name: "Bravo Retail " + rnd(), type: "CUSTOMER", createdBy: "x" });
});

const newTicket = (who, over = {}) => post(who, { action: "create", organizationId: orgA, subject: "Cannot sync notes", description: "Customer says sync stalls", category: "technical", priority: "normal", contactName: "Lash", contactEmail: "lash@example.test", ...over });

test("permissions: support staff and admins can use tickets; billing, customer admins and anonymous cannot", async () => {
  for (const who of [owner, admin, support]) assert.equal((await newTicket(who)).status, 200);
  assert.equal((await newTicket(billing)).status, 403);
  assert.equal((await newTicket(custAdmin)).status, 403);
  assert.equal((await get(billing)).status, 403);
  assert.equal((await get(custAdmin)).status, 403);
  assert.equal((await get(custAdmin, "?summary=1")).status, 403);
  assert.equal((await route.GET(new Request("http://x/x", { headers: {} }))).status, 401);
  // a disabled staff account loses access immediately
  assert.equal((await get(disabledStaff)).status, 403);
});

test("validation and organization linkage", async () => {
  assert.equal((await newTicket(support, { organizationId: "does-not-exist" })).status, 404);
  assert.equal((await newTicket(support, { organizationId: "" })).status, 400);
  assert.equal((await newTicket(support, { subject: "x" })).status, 400);
  assert.equal((await newTicket(support, { assigneeUid: billing.uid })).status, 400, "billing admins can't be assigned tickets");
  assert.equal((await newTicket(support, { assigneeUid: disabledStaff.uid })).status, 400);
  assert.equal((await newTicket(support, { followUpAt: "not a date" })).status, 400);
  const ok = (await newTicket(support, { assigneeUid: support2.uid, priority: "urgent", category: "billing", followUpAt: "2030-01-15" })).body.ticket;
  assert.equal(ok.organizationId, orgA); assert.ok(ok.organizationName.startsWith("Alpha Marine"));
  assert.equal(ok.assigneeEmail, support2.email); assert.equal(ok.priority, "urgent"); assert.equal(ok.status, "open");
  assert.match(ok.code, /^BZX-\d+$/);
  assert.equal((await audits(orgA, "support_ticket.created")).some((a) => a.details.ticketId === ok.id), true);
  // unknown priority/category fall back to safe defaults rather than being stored
  const t = (await newTicket(support, { priority: "weird", category: "weird" })).body.ticket;
  assert.equal(t.priority, "normal"); assert.equal(t.category, "other");
});

test("ticket numbers are unique and sequential even when created at the same time", async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => newTicket(support, { subject: "Concurrent ticket " + i })));
  const nums = results.map((r) => r.body.ticket.number).sort((a, b) => a - b);
  assert.equal(new Set(nums).size, 8);
  assert.equal(nums[7] - nums[0], 7, "no gaps or duplicates");
});

test("workflow: status, assignment, follow-up, timeline, audit", async () => {
  const t = (await newTicket(support)).body.ticket;
  let r = await post(support, { action: "update", id: t.id, patch: { status: "in_progress", assigneeUid: support2.uid, priority: "high", followUpAt: "2030-02-01" } });
  assert.equal(r.status, 200); assert.equal(r.body.ticket.status, "in_progress"); assert.equal(r.body.ticket.assigneeEmail, support2.email);
  assert.equal(r.body.ticket.priority, "high"); assert.ok(r.body.ticket.followUpAt.startsWith("2030-02-01"));
  assert.equal((await post(support, { action: "update", id: t.id, patch: { status: "nonsense" } })).status, 400);
  assert.equal((await post(support, { action: "update", id: t.id, patch: { assigneeUid: billing.uid } })).status, 400);
  assert.equal((await post(support, { action: "update", id: t.id, patch: { status: "in_progress" } })).body.unchanged, true);
  r = await post(support2, { action: "update", id: t.id, patch: { status: "resolved" } });
  assert.ok(r.body.ticket.closedAt, "resolved stamps a closed time");
  r = await post(support2, { action: "update", id: t.id, patch: { status: "open", assigneeUid: null, followUpAt: null } });
  assert.equal(r.body.ticket.closedAt, null); assert.equal(r.body.ticket.assigneeUid, null); assert.equal(r.body.ticket.followUpAt, null);
  assert.equal((await post(billing, { action: "update", id: t.id, patch: { status: "closed" } })).status, 403);
  assert.equal((await post(custAdmin, { action: "update", id: t.id, patch: { status: "closed" } })).status, 403);

  const detail = (await get(support, "?id=" + t.id)).body;
  const events = detail.notes.filter((n) => n.kind === "event").map((n) => n.body);
  assert.ok(events.some((e) => e.includes("open → in_progress") === false && e.includes("in_progress → resolved")));
  assert.ok(events.includes("Ticket created") && events.some((e) => e.startsWith("Assigned to")) && events.includes("Unassigned") && events.includes("Follow-up cleared"));
  const st = await audits(orgA, "support_ticket.status");
  assert.ok(st.some((a) => a.details.ticketId === t.id && a.details.to === "resolved"));
  assert.ok((await audits(orgA, "support_ticket.assigned")).some((a) => a.details.ticketId === t.id));
});

test("notes: append-only timeline, validated, counted", async () => {
  const t = (await newTicket(support)).body.ticket;
  assert.equal((await post(support, { action: "note", id: t.id, body: "   " })).status, 400);
  assert.equal((await post(support, { action: "note", id: t.id, body: "Asked customer to reinstall." })).status, 200);
  assert.equal((await post(support2, { action: "note", id: t.id, body: "Reinstall fixed the sync." })).status, 200);
  assert.equal((await post(support, { action: "note", id: "nope", body: "x" })).status, 404);
  assert.equal((await post(billing, { action: "note", id: t.id, body: "sneaky" })).status, 403);
  const d = (await get(support, "?id=" + t.id)).body;
  const notes = d.notes.filter((n) => n.kind === "note");
  assert.deepEqual(notes.map((n) => n.body), ["Asked customer to reinstall.", "Reinstall fixed the sync."]);
  assert.deepEqual(notes.map((n) => n.authorEmail), [support.email, support2.email]);
  assert.equal(d.ticket.noteCount, 2);
});

test("listing: server-side filters, organization isolation, follow-ups due, pagination", async () => {
  const tag = "Listing " + rnd();
  const mkB = (over) => post(support, { action: "create", organizationId: orgB, subject: tag + " " + rnd(), ...over });
  const closed = (await mkB({})).body.ticket;
  await post(support, { action: "update", id: closed.id, patch: { status: "closed" } });
  const mine = (await mkB({ assigneeUid: support.uid, priority: "high" })).body.ticket;
  const due = (await mkB({ followUpAt: "2020-01-01" })).body.ticket;
  for (let i = 0; i < 5; i++) await mkB({});

  // organization filter never leaks another organization's tickets
  const forB = (await get(support, "?org=" + orgB + "&status=all&limit=100")).body.tickets;
  assert.ok(forB.length >= 8 && forB.every((t) => t.organizationId === orgB));
  const forA = (await get(support, "?org=" + orgA + "&status=all&limit=100")).body.tickets;
  assert.ok(forA.length >= 1 && forA.every((t) => t.organizationId === orgA));
  assert.ok(!forA.some((t) => t.subject.startsWith(tag)));

  // status groups
  const open = (await get(support, "?org=" + orgB + "&limit=100")).body.tickets;
  assert.ok(!open.some((t) => t.id === closed.id), "closed tickets are hidden from the default (open) view");
  assert.ok((await get(support, "?org=" + orgB + "&status=closed")).body.tickets.some((t) => t.id === closed.id));
  // assignee / priority / due
  assert.ok((await get(support, "?org=" + orgB + "&assignee=me")).body.tickets.every((t) => t.assigneeUid === support.uid));
  assert.ok((await get(support2, "?org=" + orgB + "&assignee=me")).body.tickets.length === 0);
  assert.ok((await get(support, "?org=" + orgB + "&assignee=unassigned&limit=100")).body.tickets.every((t) => !t.assigneeUid));
  assert.deepEqual((await get(support, "?org=" + orgB + "&priority=high")).body.tickets.map((t) => t.id), [mine.id]);
  assert.deepEqual((await get(support, "?org=" + orgB + "&due=1")).body.tickets.map((t) => t.id), [due.id]);

  // pagination: pages of 3 cover everything exactly once, newest update first
  const seen = []; let cursor = null; let pages = 0;
  do {
    const qs = "?org=" + orgB + "&status=all&limit=3" + (cursor ? "&cursor=" + cursor : "");
    const r = await get(support, qs);
    assert.ok(r.body.tickets.length <= 3);
    seen.push(...r.body.tickets); cursor = r.body.nextCursor; pages++;
  } while (cursor && pages < 20);
  assert.equal(new Set(seen.map((t) => t.id)).size, seen.length, "no duplicates");
  assert.equal(seen.length, forB.length, "no gaps");
  assert.deepEqual(seen.map((t) => t.id), forB.map((t) => t.id), "stable order");
  const times = seen.map((t) => new Date(t.updatedAt).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  assert.equal((await get(support, "?cursor=garbage!!")).status, 400);
  assert.ok((await get(support, "?limit=100000")).body.tickets.length <= 100);
});

test("summary counts and assignable staff", async () => {
  const s = (await get(support, "?summary=1")).body;
  assert.ok(s.open >= 1 && s.urgent >= 1 && s.mine >= 0 && s.followUpsDue >= 1);
  const open = (await get(support, "?status=open&limit=100")).body.tickets.length;
  assert.ok(s.open >= open);
  const a = (await get(support, "?assignees=1")).body;
  const emails = a.assignees.map((x) => x.email);
  assert.ok(emails.includes(support.email) && emails.includes(admin.email) && emails.includes(owner.email));
  assert.ok(!emails.includes(billing.email) && !emails.includes(disabledStaff.email));
  assert.ok(a.statuses.includes("waiting_customer") && a.priorities.includes("urgent"));
});

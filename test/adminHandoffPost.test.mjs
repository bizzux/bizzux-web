// URL-free hand-off to the Admin Center: authorization, origin allow-list, single use, expiry, origin binding, cookie attributes. Emulators, real routes.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { cleanReturnTo, originOfFrom, cleanIntent } from "../lib/shell/handoff.js";

test("pure rules: returnTo is a plain path on the app, origins come only from the allow-list, intents are fixed", () => {
  assert.equal(cleanReturnTo("/people?x=1"), "/people?x=1");
  for (const bad of ["//evil.com", "https://evil.com", "/..//etc", "/a\\b", "javascript:alert(1)", "people", "", "/" + "a".repeat(250)]) assert.equal(cleanReturnTo(bad), "/", String(bad).slice(0, 20));
  assert.equal(originOfFrom("attendance"), "https://attendance.bizzux.com");
  assert.equal(originOfFrom("evil"), null); assert.equal(originOfFrom("https://evil.com"), null);
  assert.equal(cleanIntent("add-employee"), "add-employee"); assert.equal(cleanIntent("add-employee-existing"), "add-employee-existing"); assert.equal(cleanIntent("add-employee-new"), "add-employee-new"); assert.equal(cleanIntent("drop-tables"), "");
});

const emu = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
process.env.NEXT_PUBLIC_WWW_ORIGIN = "https://www.bizzux.com";
const fa = emu ? await import("../lib/firebaseAdmin.js") : null;
const hand = emu ? await import("../app/api/admin-center/handoff/route.js") : null;
const redeem = emu ? await import("../app/api/admin-center/redeem/route.js") : null;
const session = emu ? await import("../app/api/admin-center/session/route.js") : null;
const RUN = Math.random().toString(36).slice(2, 7);
const AUTH = emu ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1` : "";
const post = async (p, b) => (await fetch(`${AUTH}/${p}?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function person(label) { const u = await fa.adminAuth().createUser({ email: `${label}-${RUN}@x.test`, emailVerified: true, displayName: label }); return { uid: u.uid, token: (await post("accounts:signInWithCustomToken", { token: await fa.adminAuth().createCustomToken(u.uid), returnSecureToken: true })).idToken }; }
let O, admin, member, db;
before(async () => {
  if (!emu) return;
  db = fa.adminDb(); O = await person("owner"); admin = await person("admin"); member = await person("member");
  await db.doc("customers/" + O.uid).set({ status: "active" });
  await db.doc(`organizationMemberships/${O.uid}_${O.uid}`).set({ organizationId: O.uid, userId: O.uid, role: "OWNER", status: "active" });
  for (const [w, profile] of [[admin, "Admin"], [member, "Staff/Shopkeeper"]]) { await db.doc("memberships/" + w.uid).set({ accountId: O.uid, profile }); await db.doc(`organizationMemberships/${O.uid}_${w.uid}`).set({ organizationId: O.uid, userId: w.uid, role: "MEMBER", status: "active" }); }
});
const ask = (w, body) => hand.POST(new Request("http://x/api/admin-center/handoff", { method: "POST", headers: { ...(w ? { Authorization: "Bearer " + w.token } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const send = (code, origin) => { const f = new FormData(); f.set("code", code); return redeem.POST(new Request("https://admin.bizzux.com/api/admin-center/redeem", { method: "POST", headers: origin ? { Origin: origin } : {}, body: f })); };
const cookieOf = (res) => (res.headers.get("set-cookie") || "").split(";")[0].split("=").slice(1).join("=");
const exchange = (handle) => session.POST(new Request("https://admin.bizzux.com/api/admin-center/session", { method: "POST", headers: handle ? { cookie: "bzx_sso=" + handle } : {} }));

test("who may ask: administrators only; anonymous 401, member 403; unknown app and bad context are cleaned or refused", { skip: !emu }, async () => {
  assert.equal((await ask(null, { from: "attendance" })).status, 401);
  assert.equal((await ask(member, { from: "attendance" })).status, 403, "a plain member is refused whatever the menu showed");
  assert.equal((await ask(admin, { from: "evil" })).status, 400);
  assert.equal((await ask(admin, { from: "https://evil.com" })).status, 400);
  const ok = await ask(admin, { from: "attendance", intent: "add-employee", returnTo: "//evil.com/steal", to: "/users" });
  assert.equal(ok.status, 200); const d = await ok.json();
  assert.equal(d.action, "https://admin.bizzux.com/api/admin-center/redeem");
  assert.equal(d.returnUrl, "https://attendance.bizzux.com/", "an unsafe returnTo falls back to the app root; the origin is never the caller's");
  assert.ok(d.code.length >= 40 && !JSON.stringify(d).includes("token"));
  const stored = await db.collection("ssoCodes").get();
  assert.ok(stored.docs.every((x) => x.id.length === 64 && !JSON.stringify(x.data()).includes(d.code)), "only a hash is stored");
});

test("full flow: code -> POST form -> redirect with no token in the address -> host-only cookie -> one sign-in of the SAME person", { skip: !emu }, async () => {
  const d = await (await ask(admin, { from: "attendance", intent: "add-employee", returnTo: "/people", to: "/users" })).json();
  const res = await send(d.code, "https://attendance.bizzux.com");
  assert.equal(res.status, 303);
  assert.equal(new URL(res.headers.get("location")).pathname, "/sso/complete"); assert.equal(new URL(res.headers.get("location")).search, "", "nothing in the URL");
  const sc = res.headers.get("set-cookie");
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Path=\/api\/admin-center/); assert.ok(!/Domain=/i.test(sc), "host-only: no Domain attribute, so never shared across subdomains");
  assert.ok(!sc.includes(d.code), "the cookie is an opaque handle, not the code");
  const handle = cookieOf(res);
  const s = await exchange(handle);
  assert.equal(s.status, 200); const body = await s.json();
  assert.equal(body.to, "/users"); assert.deepEqual([body.context.from, body.context.intent, body.context.returnUrl], ["attendance", "add-employee", "https://attendance.bizzux.com/people"]);
  const idt = (await post("accounts:signInWithCustomToken", { token: body.customToken, returnSecureToken: true })).idToken;
  assert.equal((await fa.adminAuth().verifyIdToken(idt)).uid, admin.uid, "signed in as the SAME person");
  assert.equal((await exchange(handle)).status, 401, "the handle works once");
  assert.match((await exchange(handle)).headers.get("set-cookie"), /Max-Age=0/, "cookie cleared");
});

test("single use, expiry, origin binding (login-CSRF), garbage", { skip: !emu }, async () => {
  const a = await (await ask(admin, { from: "crm" })).json();
  assert.equal((await send(a.code, "https://evil.example")).status, 303, "wrong origin is answered with the generic failure redirect");
  assert.match((await send(a.code, "https://evil.example")).headers.get("location"), /error=1/);
  assert.equal(cookieOf(await send(a.code, "https://evil.example")), "", "no session started");
  const b = await (await ask(admin, { from: "crm" })).json();
  assert.equal(cookieOf(await send(b.code, "")), "", "a missing Origin header is refused too");
  const c = await (await ask(admin, { from: "crm" })).json();
  const first = await send(c.code, "https://crm.bizzux.com"); assert.ok(cookieOf(first), "right origin works");
  assert.match((await send(c.code, "https://crm.bizzux.com")).headers.get("location"), /error=1/, "a code works once");
  const e = await (await ask(admin, { from: "crm" })).json();
  const { createHash } = await import("node:crypto");
  await db.collection("ssoCodes").doc(createHash("sha256").update(e.code).digest("hex")).update({ exp: Date.now() - 1 });
  assert.match((await send(e.code, "https://crm.bizzux.com")).headers.get("location"), /error=1/, "expired after 30 seconds");
  for (const junk of ["", "short", "x".repeat(300), "../../etc"]) assert.match((await send(junk, "https://crm.bizzux.com")).headers.get("location"), /error=1/);
  assert.equal((await exchange("")).status, 401); assert.equal((await exchange("nonsense-nonsense-nonsense")).status, 401);
});

test("the portal uses the same flow; no endpoint returns a URL that carries a token", { skip: !emu }, async () => {
  const d = await (await ask(admin, { from: "portal", returnTo: "/dashboard" })).json();
  assert.equal(d.returnUrl, "https://www.bizzux.com/dashboard");
  assert.ok(!/token=|#/.test(JSON.stringify(d)), "no token or fragment in the response");
  const aud = await db.collection("auditLogs").where("action", "==", "admin_center.handoff").get();
  assert.ok(aud.docs.some((x) => x.data().details?.method === "post_code"), "audited");
});

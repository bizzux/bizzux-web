// Login Journey Diagnostics: ingest -> aggregation -> admin read, on the Auth+Firestore emulators
// (no production reads/writes). Run: npm run test:authjourney
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "test@demo-bizzux.iam.gserviceaccount.com" });
process.env.PLATFORM_OWNER_EMAIL = "owner-aj@bizzux.test";
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Run via firebase emulators:exec");

const fa = await import("../lib/firebaseAdmin.js");
const lib = await import("../lib/authJourney.js");
const ingest = await import("../app/api/auth-journey/route.js");
const admin = await import("../app/api/admin/auth-journeys/route.js");
const db = fa.adminDb();
const rnd = () => Math.random().toString(36).slice(2, 8);

async function signIn(email) {
  const u = await fa.adminAuth().createUser({ email, password: "Passw0rd-" + rnd() });
  const custom = await fa.adminAuth().createCustomToken(u.uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  return { uid: u.uid, email, token: (await r.json()).idToken };
}
// What the browser sends: a "simple" text/plain POST, token in the body.
const send = (events, idToken) => ingest.POST(new Request("http://localhost/api/auth-journey", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ events, idToken }) }));
const read = async (who, qs = "") => { const r = await admin.GET(new Request("http://localhost/x?" + qs, { headers: { Authorization: "Bearer " + who.token } })); return { status: r.status, body: await r.json() }; };

const T0 = Date.now() - 60000;
const ev = (journeyId, event, offsetMs, extra = {}) => ({ event, journeyId, correlationId: "corr" + journeyId.slice(0, 8), attempt: 1, app: "crm", method: "password", buildVersion: "t1", at: new Date(T0 + offsetMs).toISOString(), ...extra });

let owner, googleUser, bizzuxIdUser, otherOrgUser, stranger;
before(async () => {
  owner = await signIn("owner-aj@bizzux.test");
  await db.doc("platformAdmins/" + owner.uid).set({ email: owner.email, role: "OWNER", status: "active", permissions: null });
  googleUser = await signIn("google-" + rnd() + "@example.test");
  bizzuxIdUser = await signIn("bid-" + rnd() + "@example.test");
  otherOrgUser = await signIn("other-" + rnd() + "@example.test");
  stranger = await signIn("none-" + rnd() + "@example.test");
  // Each is the Admin of their own organization (customers/{uid}).
  for (const u of [googleUser, bizzuxIdUser, otherOrgUser]) await db.doc("customers/" + u.uid).set({ organizationName: "Org " + u.uid.slice(0, 4), status: "active" });
});

test("categorizeAuthError maps raw codes to safe categories", () => {
  assert.equal(lib.categorizeAuthError("auth/invalid-credential"), "invalid_credentials");
  assert.equal(lib.categorizeAuthError("auth/popup-blocked"), "popup_blocked");
  assert.equal(lib.categorizeAuthError("auth/network-request-failed"), "network");
  assert.equal(lib.categorizeAuthError("auth/unauthorized-domain"), "redirect_failed");
  assert.equal(lib.categorizeAuthError("something bizarre"), "unknown");
});

test("1. successful Google login produces the expected ordered events and a correct duration", async () => {
  const j = "gj" + rnd() + "abcdef";
  const names = ["LOGIN_STARTED", "AUTH_PROVIDER_SELECTED", "OAUTH_REDIRECT_STARTED", "OAUTH_CALLBACK_RECEIVED", "AUTH_SUCCEEDED", "SESSION_INITIALIZED", "APP_ACCESS_GRANTED"];
  const res = await send(names.map((n, i) => ev(j, n, i * 700, { method: "google" })), googleUser.token);
  assert.equal(res.status, 204);
  const out = await read(googleUser, "email=" + encodeURIComponent(googleUser.email));
  assert.equal(out.status, 200);
  const jr = out.body.journeys.find((x) => x.journeyId === j);
  assert.ok(jr, "journey found for the user");
  assert.deepEqual(jr.events.map((e) => e.event), names);
  assert.equal(jr.outcome, "success");
  assert.equal(jr.method, "google");
  assert.equal(jr.attempts, 1);
  assert.equal(jr.durationMs, 6 * 700, "duration = first event -> APP_ACCESS_GRANTED");
  assert.equal(jr.precededSuccess, "OAUTH_CALLBACK_RECEIVED");
});

test("2/3. controlled failure records a safe category; retry then success stays in ONE journey", async () => {
  const j = "bj" + rnd() + "abcdef";
  // Attempt 1: anonymous (not signed in yet), typed identifier is sent only to be hashed.
  await send([
    ev(j, "LOGIN_STARTED", 0, { method: "bizzux-id", subject: bizzuxIdUser.email }),
    ev(j, "AUTH_FAILED", 900, { method: "bizzux-id", errorCategory: "invalid_credentials", subject: bizzuxIdUser.email }),
  ]);
  // Attempt 2 after the failure: now authenticated.
  await send([
    ev(j, "LOGIN_RETRY", 8000, { method: "bizzux-id", attempt: 2 }),
    ev(j, "LOGIN_STARTED", 8001, { method: "bizzux-id", attempt: 2 }),
    ev(j, "AUTH_SUCCEEDED", 9200, { method: "bizzux-id", attempt: 2 }),
    ev(j, "SESSION_INITIALIZED", 9800, { method: "bizzux-id", attempt: 2 }),
    ev(j, "APP_ACCESS_GRANTED", 10300, { method: "bizzux-id", attempt: 2 }),
  ], bizzuxIdUser.token);
  const out = await read(bizzuxIdUser, "email=" + encodeURIComponent(bizzuxIdUser.email));
  const jr = out.body.journeys.find((x) => x.journeyId === j);
  assert.ok(jr);
  assert.equal(jr.outcome, "success");
  assert.equal(jr.attempts, 2);
  assert.equal(jr.failuresBeforeSuccess, 1);
  assert.equal(jr.failureReason, "invalid_credentials");
  assert.equal(jr.durationMs, 10300, "first attempt -> access granted, across the retry");
  assert.equal(out.body.summary.retriedThenSucceeded, 1);
  // Platform owner finds the same journey by the typed email even before sign-in attribution.
  const own = await read(owner, "email=" + encodeURIComponent(bizzuxIdUser.email));
  assert.ok(own.body.journeys.some((x) => x.journeyId === j));
});

test("nothing sensitive is stored; unknown values are collapsed", async () => {
  const j = "sj" + rnd() + "abcdef";
  await send([{ ...ev(j, "AUTH_FAILED", 0, { errorCategory: "Wrong password 'hunter2' for bob@x.com", app: "Evil App!", method: "magic" }), password: "hunter2", token: "secret-token" }], googleUser.token);
  await send([{ ...ev(j, "BOGUS_EVENT", 1) }, { ...ev("x", "AUTH_FAILED", 1) }]); // unknown event / bad journey id -> dropped
  const snap = await db.collection(lib.COLLECTION).where("journeyId", "==", j).get();
  assert.equal(snap.size, 1);
  const d = snap.docs[0].data();
  const blob = JSON.stringify(d);
  for (const bad of ["hunter2", "secret-token", "bob@x.com", googleUser.token.slice(0, 40), googleUser.email, googleUser.uid]) assert.ok(!blob.includes(bad), "must not contain " + bad);
  assert.equal(d.errorCategory, null);
  assert.equal(d.app, "other");
  assert.equal(d.method, "other");
  assert.ok(d.expireAt, "retention timestamp set");
});

test("5. only authorized administrators can read; tenants are isolated", async () => {
  assert.equal((await read(stranger)).status >= 400, true, "user with no admin role is refused");
  const a = await read(googleUser);                       // admin of their own org
  const b = await read(otherOrgUser);                      // admin of another org, no events of their own
  assert.equal(a.status, 200);
  assert.ok(a.body.journeys.length >= 1);
  assert.ok(a.body.journeys.every((x) => x.events.length > 0));
  assert.equal(b.status, 200);
  assert.equal(b.body.journeys.length, 0, "other org sees nothing of org A");
  // Org admin cannot reach another org's user by email either.
  const cross = await read(otherOrgUser, "email=" + encodeURIComponent(googleUser.email));
  assert.equal(cross.body.journeys.length, 0);
  // Platform owner sees across organizations.
  const all = await read(owner);
  const ids = new Set(all.body.journeys.map((x) => x.journeyId));
  assert.ok(all.body.journeys.length >= 3 && ids.size >= 3);
  // Responses never expose hashes or uids.
  assert.ok(!JSON.stringify(all.body).match(/uidHash|subjectHash|orgHash/));
});

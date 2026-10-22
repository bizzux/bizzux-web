// Bizzux login ID ("first.last@bizzux"): pure rules + emulator tests for atomic reservation, one identity for both forms, no enumeration, suggestions.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { stripLoginSuffix, isBizzuxId, toLoginId, slugName, candidates } from "../lib/loginId.js";

test("pure: the suffix is virtual and stripped only when it is exactly @bizzux", () => {
  assert.equal(stripLoginSuffix("Rajthilak.Kumar@bizzux"), "rajthilak.kumar");
  assert.equal(stripLoginSuffix("  rajthilak.kumar@BIZZUX "), "rajthilak.kumar");
  assert.equal(stripLoginSuffix("rajthilak.kumar"), "rajthilak.kumar");
  assert.equal(stripLoginSuffix("rajthilak@bizzux.com"), "rajthilak@bizzux.com", "a real email is NEVER rewritten");
  assert.equal(stripLoginSuffix("a@gmail.com"), "a@gmail.com");
  assert.equal(stripLoginSuffix(null), "");
  assert.equal(isBizzuxId("rajthilak.kumar@bizzux"), true);
  assert.equal(isBizzuxId("rajthilak.kumar@bizzux.com"), false, "bizzux.com is a real mailbox domain, not a Bizzux ID");
  assert.equal(isBizzuxId("rajthilak.kumar"), false);
  assert.equal(toLoginId("Priya.Sharma"), "priya.sharma@bizzux"); assert.equal(toLoginId(""), "");
});

test("pure: names become first.last; accents folded; junk normalized; length capped; suggestions numbered", () => {
  assert.equal(slugName("Rajthilak", "Kumar"), "rajthilak.kumar");
  assert.equal(slugName("José", "Núñez"), "jose.nunez");
  assert.equal(slugName("Mary Ann", "O'Neil-Smith"), "mary.ann.o.neil.smith");
  assert.equal(slugName("", "Babu"), "babu"); assert.equal(slugName("", ""), "");
  assert.ok(slugName("A".repeat(40), "B".repeat(40)).length <= 32);
  assert.deepEqual(candidates("suresh.babu", 3), ["suresh.babu", "suresh.babu2", "suresh.babu3"]);
  assert.ok(candidates("x".repeat(32), 3).every((c) => c.length <= 32), "a numbered variant still fits the 32 character limit");
});

const emu = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
const fa = emu ? await import("../lib/firebaseAdmin.js") : null;
const ua = emu ? await import("../lib/usernameAuth.js") : null;
const svc = emu ? await import("../lib/iam/identityService.js") : null;
const loginRoute = emu ? await import("../app/api/auth/username-login/route.js") : null;
const RUN = Math.random().toString(36).slice(2, 7);
const AUTHURL = emu ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1` : "";
const verify = async (customToken) => {
  const r = await (await fetch(`${AUTHURL}/accounts:signInWithCustomToken?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) })).json();
  return (await fa.adminAuth().verifyIdToken(r.idToken)).uid;
};
const login = (username, password, ip = "9.9.9." + Math.floor(Math.random() * 250)) => loginRoute.POST(new Request("http://x/api/auth/username-login", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ username, password }) }));
const create = (username) => ua.createUsernameUser({ username, password: "Passw0rd!x1", displayName: "T " + username, organizationId: "org_" + RUN, mustChangePassword: false });
before(async () => { if (emu) await fa.adminDb().doc("customers/org_" + RUN).set({ status: "active" }); });
const authCount = async () => (await fa.adminAuth().listUsers(1000)).users.length;

test("atomic reservation: five simultaneous creations of one name -> exactly one wins, the others are refused and leave no Firebase user behind", { skip: !emu }, async () => {
  const name = `race.${RUN}`;
  const before = await authCount();
  const res = await Promise.allSettled([1, 2, 3, 4, 5].map(() => create(name)));
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1, "exactly one creation succeeds");
  assert.ok(res.filter((r) => r.status === "rejected").every((r) => r.reason?.status === 409), "the rest are 409 already taken");
  assert.equal((await authCount()) - before, 1, "no orphan Firebase users from the losers");
  const doc = await fa.adminDb().doc("usernames/" + name).get(); assert.ok(doc.exists);
});

test("the Bizzux ID and the short username resolve to the SAME identity; case does not matter; creation accepts either form", { skip: !emu }, async () => {
  const name = `first.last${RUN}`;
  const made = await create(`${name}@bizzux`); // entered as a Bizzux ID
  assert.equal(made.username, name, "stored as the plain username");
  const stored = await fa.adminDb().doc("usernames/" + name).get(); assert.equal(stored.data().uid, made.uid);
  assert.equal((await fa.adminDb().doc(`usernames/${name}@bizzux`).get()).exists, false, "no second record under the virtual form");
  const user = await fa.adminAuth().getUser(made.uid); assert.ok(!user.email, "the virtual ID is never a Firebase email");
  const uids = [];
  for (const form of [name, `${name}@bizzux`, `${name.toUpperCase()}@BIZZUX`]) {
    const r = await login(form, "Passw0rd!x1"); assert.equal(r.status, 200, form);
    uids.push(await verify((await r.json()).token));
  }
  assert.deepEqual([...new Set(uids)], [made.uid], "all forms sign in as the same uid");
  assert.equal((await create(name).catch((e) => e.status)), 409, "the short form is taken once the ID exists");
  assert.equal((await create(`${name}@bizzux`).catch((e) => e.status)), 409, "and so is the ID form");
});

test("no enumeration: unknown user and wrong password answer identically", { skip: !emu }, async () => {
  const name = `enum${RUN}`; await create(name);
  const a = await login(`${name}@bizzux`, "wrong-password-1"), b = await login(`nobody${RUN}@bizzux`, "wrong-password-1");
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.deepEqual(await a.json(), await b.json(), "same body, so the form cannot tell which names exist");
});

test("availability: free -> ok with the full ID; taken -> next free numbered suggestion (looks across both stores)", { skip: !emu }, async () => {
  const base = `suresh.babu${RUN}`;
  assert.deepEqual((({ ok, loginId }) => ({ ok, loginId }))(await svc.usernameAvailability(base)), { ok: true, loginId: base + "@bizzux" });
  await create(base);
  const t = await svc.usernameAvailability(base + "@bizzux");
  assert.equal(t.ok, false); assert.equal(t.suggestion, base + "2"); assert.equal(t.suggestionLoginId, base + "2@bizzux");
  await fa.adminDb().doc("attUsernames/" + base + "2").set({ username: base + "2" }); // taken in the legacy Attendance store
  assert.equal((await svc.usernameAvailability(base)).suggestion, base + "3", "a name held by the legacy Attendance store is skipped too");
});

test("a name held by the legacy Attendance store is refused by the portal (one namespace)", { skip: !emu }, async () => {
  const name = `legacy${RUN}`;
  await fa.adminDb().doc("attUsernames/" + name).set({ username: name });
  assert.equal(await create(name + "@bizzux").catch((e) => e.status), 409);
});

import { analyzeLoginIds } from "../lib/loginIdAudit.js";
test("dry run analysis: clean names are ready; shared names, bad formats and orphans need a decision", () => {
  const r = analyzeLoginIds({
    portal: [{ id: "joshika", uid: "u1" }, { id: "karthi.p", uid: "u2" }, { id: "dup.name", uid: "u3" }, { id: "x", uid: "u9" }],
    attendance: [{ id: "dup.name", uid: "u4" }, { id: "meena", uid: "u5" }],
    authUids: new Set(["u1", "u2", "u3", "u4"]),
  });
  assert.equal(r.readyToGainLoginId, 3); // joshika, karthi.p, meena (meena's uid u5 is missing in Auth, reported separately)
  assert.deepEqual(r.needDecision.bothStores, ["dup.name"]);
  assert.deepEqual(r.needDecision.invalidFormat, ["x"]);
  assert.deepEqual(r.needDecision.noFirebaseUser, ["meena", "x"]);
  assert.equal(r.safeToProceed, false);
  assert.deepEqual(r.sampleReady.slice(0, 2), ["joshika@bizzux", "karthi.p@bizzux"]);
  assert.equal(analyzeLoginIds({ portal: [{ id: "ok.name", uid: "u1" }], authUids: new Set(["u1"]) }).safeToProceed, true);
});

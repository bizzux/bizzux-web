import test from "node:test";
import assert from "node:assert/strict";
import { newInviteToken, hashInviteToken, findInvite } from "../lib/inviteTokens.js";

const store = (docs) => async (id) => ({ exists: id in docs, data: () => docs[id] });

test("tokens are long, random, and only their hash is the stored id", () => {
  const a = newInviteToken(), b = newInviteToken();
  assert.ok(a.token.length >= 43);
  assert.notEqual(a.token, b.token);
  assert.equal(a.id, hashInviteToken(a.token));
  assert.notEqual(a.id, a.token);
  assert.match(a.id, /^[0-9a-f]{64}$/);
});

test("the emailed token finds its invite, a wrong one finds nothing", async () => {
  const { token, id } = newInviteToken();
  const byId = store({ [id]: { tokenHashed: true, email: "a@b.co" } });
  assert.ok(await findInvite(token, byId));
  assert.equal(await findInvite(token + "x", byId), null);
  assert.equal(await findInvite("", byId), null);
});

test("the stored hash is not a usable link before sign-in, only after the invitee proved their email", async () => {
  const { id } = newInviteToken();
  const byId = store({ [id]: { tokenHashed: true, email: "a@b.co" } });
  assert.equal(await findInvite(id, byId, { signedIn: false }), null);
  assert.ok(await findInvite(id, byId, { signedIn: true }));
});

test("older invites that used the raw token as their id still work", async () => {
  const byId = store({ "legacy-uuid": { email: "a@b.co" } });
  assert.ok(await findInvite("legacy-uuid", byId));
  assert.ok(await findInvite("legacy-uuid", byId, { signedIn: true }));
});

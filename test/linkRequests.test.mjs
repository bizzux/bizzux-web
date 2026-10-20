import test from "node:test";
import assert from "node:assert/strict";
import { linkRequestProblem, linkRequestId } from "../lib/linkRules.js";

test("only the named person can answer, once, before it expires", () => {
  const now = Date.now();
  const r = { targetUid: "u1", status: "pending", expiresAt: { toMillis: () => now + 1000 } };
  assert.equal(linkRequestProblem(r, "u1", now), "");
  assert.match(linkRequestProblem(r, "u2", now), /not for you/);
  assert.match(linkRequestProblem({ ...r, status: "accepted" }, "u1", now), /already/);
  assert.match(linkRequestProblem({ ...r, status: "declined" }, "u1", now), /already/);
  assert.match(linkRequestProblem({ ...r, expiresAt: { toMillis: () => now - 1 } }, "u1", now), /expired/);
  assert.match(linkRequestProblem({ ...r, expiresAt: undefined }, "u1", now), /expired/);
  assert.match(linkRequestProblem(null, "u1", now), /no longer/);
});

test("one open request per company and person", () => {
  assert.equal(linkRequestId("org", "u1"), "org_u1");
});

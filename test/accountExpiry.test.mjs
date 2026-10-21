import test from "node:test";
import assert from "node:assert/strict";
import { cleanExpiry, accountExpired, cleanEmploymentType } from "../lib/accountExpiry.js";

test("expiry dates are validated", () => {
  assert.deepEqual(cleanExpiry(""), { ok: true, value: "" });
  assert.deepEqual(cleanExpiry(" 2026-12-31 "), { ok: true, value: "2026-12-31" });
  for (const bad of ["31-12-2026", "2026-13-01", "2026-02-30", "soon"]) assert.equal(cleanExpiry(bad).ok, false, bad);
});

test("access lasts through the expiry day, then stops; no or bad value never locks out", () => {
  const e = { accountExpiresAt: "2026-10-21" };
  assert.equal(accountExpired(e, Date.parse("2026-10-21T23:59:59Z")), false);
  assert.equal(accountExpired(e, Date.parse("2026-10-22T00:00:01Z")), true);
  assert.equal(accountExpired({}), false);
  assert.equal(accountExpired({ accountExpiresAt: "junk" }), false);
});

test("employment type falls back to Employee", () => {
  assert.equal(cleanEmploymentType("Contractor"), "Contractor");
  assert.equal(cleanEmploymentType("Boss"), "Employee");
});

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOrganizationRow } from "../lib/orgProvisioning.js";
import { buildDirectoryEntry } from "../lib/orgDirectory.js";

const admin = { type: "CUSTOMER", provisionedVia: "platform-admin", provisionedByEmail: "ops@bizzux.com", createdAt: null };
const self = { type: "CUSTOMER", registrationMethod: "self", registeredByEmail: "owner@acme.com" };
const legacySelf = { type: "CUSTOMER" };
const placeholder = {};

test("admin-registered org", () => {
  const r = normalizeOrganizationRow("a", admin, null, 0);
  assert.equal(r.kind, "admin-provisioned");
  assert.equal(r.registeredBy, "ops@bizzux.com");
  assert.equal(buildDirectoryEntry({ id: "a", org: admin, customer: null, owner: null }).kind, "admin-provisioned");
});
test("self-registered org (new record with marker)", () => {
  const r = normalizeOrganizationRow("s", self, null, 0);
  assert.equal(r.kind, "self-service");
  assert.equal(r.registeredBy, "owner@acme.com");
});
test("existing org without markers still loads", () => {
  const r = normalizeOrganizationRow("l", legacySelf, { email: "x@y.com" }, 0);
  assert.equal(r.kind, "self-service");
  assert.equal(r.registeredBy, "x@y.com");
});
test("unverifiable record is Unknown (placeholder)", () => {
  const r = normalizeOrganizationRow("p", placeholder, null, 0);
  assert.equal(r.kind, "placeholder");
  assert.equal(r.registeredBy, "");
});

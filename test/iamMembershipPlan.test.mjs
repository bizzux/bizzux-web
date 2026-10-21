import test from "node:test";
import assert from "node:assert/strict";
import { planBackfill, planRollback, roleFromProfile, SCHEMA_VERSION } from "../lib/iamMembershipPlan.js";

const base = () => ({ customers: [{ id: "o1", status: "active" }], memberships: [], team: [], orgMemberships: [] });

test("owner and legacy member get canonical records; nothing is linked by email", () => {
  const d = base();
  d.memberships = [{ uid: "u2", accountId: "o1", profile: "Admin" }, { uid: "u3", accountId: "o1", profile: "Viewer/Auditor" }];
  const { ops } = planBackfill(d);
  const by = Object.fromEntries(ops.map((o) => [o.id, o]));
  assert.equal(by["o1_o1"].data.role, "OWNER");
  assert.equal(by["o1_u2"].data.role, "ADMIN");
  assert.equal(by["o1_u3"].data.role, "VIEWER");
  assert.ok(ops.every((o) => o.type === "create" && o.data.schemaVersion === SCHEMA_VERSION));
});

test("disabled team member becomes suspended; closed company and orphaned membership are skipped, not created", () => {
  const d = base();
  d.customers.push({ id: "gone", status: "closed" });
  d.memberships = [{ uid: "u2", accountId: "o1", profile: "Manager" }, { uid: "u9", accountId: "nocompany", profile: "Admin" }];
  d.team = [{ org: "o1", uid: "u2", profile: "Manager", disabled: true }];
  const { ops, skipped } = planBackfill(d);
  assert.equal(ops.find((o) => o.id === "o1_u2").data.status, "suspended");
  assert.ok(!ops.some((o) => o.id === "nocompany_u9" || o.id === "gone_gone"));
  assert.equal(skipped.length, 2);
});

test("existing records: only absent fields are filled; role, status and profile are never overwritten", () => {
  const d = base();
  d.memberships = [{ uid: "u2", accountId: "o1", profile: "Admin" }];
  d.orgMemberships = [
    { id: "o1_o1", organizationId: "o1", userId: "o1", role: "OWNER", status: "active" },
    { id: "o1_u2", organizationId: "o1", userId: "u2", role: "MEMBER", status: "suspended", profile: "Manager", schemaVersion: 2, source: "invite" },
  ];
  const { ops } = planBackfill(d);
  assert.deepEqual(ops.map((o) => o.id), ["o1_o1"]);
  assert.deepEqual(Object.keys(ops[0].fields).sort(), ["profile", "schemaVersion", "source"]);
  assert.equal(ops[0].fields.profile, "Admin");
});

test("running the plan twice is a no-op (idempotent)", () => {
  const d = base();
  d.memberships = [{ uid: "u2", accountId: "o1", profile: "Staff/Shopkeeper" }];
  const first = planBackfill(d).ops;
  d.orgMemberships = first.map((o) => ({ id: o.id, ...o.data }));
  assert.deepEqual(planBackfill(d).ops, []);
});

test("canonical-only records (no legacy) are left alone except bookkeeping", () => {
  const d = base();
  d.orgMemberships = [{ id: "o1_o1", organizationId: "o1", userId: "o1", role: "OWNER", status: "active", profile: "Admin", schemaVersion: 2, source: "owner" }, { id: "o1_x", organizationId: "o1", userId: "x", role: "MEMBER", status: "removed" }];
  const { ops } = planBackfill(d);
  assert.deepEqual(ops, [{ type: "fill", id: "o1_x", fields: { schemaVersion: 2 } }]);
});

test("rollback removes what we created and only the fields we filled, and refuses to touch changed records", () => {
  const journal = [
    { type: "create", id: "a", data: { source: "backfill", role: "MEMBER", status: "active" } },
    { type: "create", id: "b", data: { source: "backfill", role: "MEMBER", status: "active" } },
    { type: "fill", id: "c", fields: { profile: "Admin", schemaVersion: 2 } },
  ];
  const cur = new Map([
    ["a", { source: "backfill", role: "MEMBER", status: "active" }],
    ["b", { source: "backfill", role: "ADMIN", status: "active" }],
    ["c", { profile: "Manager", schemaVersion: 2 }],
  ]);
  const undo = planRollback(journal, cur);
  assert.deepEqual(undo.find((u) => u.id === "a"), { type: "delete", id: "a" });
  assert.equal(undo.find((u) => u.id === "b").type, "skip");
  assert.deepEqual(undo.find((u) => u.id === "c"), { type: "unfill", id: "c", fields: ["schemaVersion"] });
});

test("role mapping equals the live one", () => {
  assert.equal(roleFromProfile("Global Admin", false), "ADMIN");
  assert.equal(roleFromProfile("Anything", false), "MEMBER");
});

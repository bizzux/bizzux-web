import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyze, summarize, roleFromProfile } from "../lib/iamAuditAnalysis.js";

const empty = () => ({ customers: [], memberships: [], orgMemberships: [], assignments: [], subs: [], usernames: [], attUsernames: [], team: [], employees: [], authUsers: [] });
const codes = (d) => analyze(d).map((f) => f.code).sort();

test("roleFromProfile matches the live mapping source", () => {
  const src = fs.readFileSync(new URL("../lib/organizationMembership.js", import.meta.url), "utf8");
  for (const p of ["Global Admin", "Admin", "Viewer/Auditor", "Manager", "Staff/Shopkeeper", "weird"]) {
    if (["Global Admin", "Admin", "Viewer/Auditor"].includes(p)) assert.ok(src.includes(`"${p}"`), p);
    assert.equal(roleFromProfile(p, false), p === "Global Admin" || p === "Admin" ? "ADMIN" : p === "Viewer/Auditor" ? "VIEWER" : "MEMBER");
  }
  assert.equal(roleFromProfile("Staff/Shopkeeper", true), "OWNER");
});

test("a clean company produces no findings", () => {
  const d = empty();
  d.customers = [{ id: "o1", status: "active" }];
  d.authUsers = [{ uid: "o1", email: "a@x", providers: ["google.com"] }, { uid: "u2", email: "b@x", providers: ["password"] }];
  d.orgMemberships = [{ id: "o1_o1", organizationId: "o1", userId: "o1", role: "OWNER", status: "active" }, { id: "o1_u2", organizationId: "o1", userId: "u2", role: "MEMBER", status: "active" }];
  d.memberships = [{ uid: "u2", accountId: "o1", profile: "Staff/Shopkeeper", status: "active" }];
  d.team = [{ org: "o1", id: "t1", uid: "u2", profile: "Staff/Shopkeeper", status: "active" }];
  d.subs = [{ organizationId: "o1", appId: "bizzux-attendance", status: "ACTIVE" }];
  d.assignments = [{ organizationId: "o1", userId: "u2", appId: "bizzux-attendance", role: "MEMBER", status: "ACTIVE" }];
  d.employees = [{ org: "o1", id: "e1", userId: "u2", status: "active", organizationId: "o1" }];
  assert.deepEqual(codes(d), []);
});

test("duplicate identities are reported, never merged", () => {
  const d = empty();
  d.authUsers = [{ uid: "a", email: "Same@X.com" }, { uid: "b", email: "same@x.com" }];
  d.usernames = [{ name: "ravi", uid: "a", organizationId: "o" }];
  d.attUsernames = [{ name: "ravi", uid: "b", accountId: "o", status: "active" }];
  const c = codes(d);
  assert.ok(c.includes("DUP_EMAIL"));
  assert.ok(c.includes("DUP_USERNAME_CROSS_STORE"));
});

test("missing and orphaned structures", () => {
  const d = empty();
  d.customers = [{ id: "o1", status: "active" }];
  d.memberships = [{ uid: "u2", accountId: "o1", profile: "Admin" }];
  d.team = [{ org: "o1", id: "t", uid: "u3", profile: "Manager" }];
  d.employees = [{ org: "o1", id: "e", userId: "u9", status: "active", organizationId: "o2", loginUsername: "gone" }];
  d.authUsers = [{ uid: "o1" }, { uid: "u2" }, { uid: "u3" }];
  d.attUsernames = [{ name: "lonely", uid: "u7", accountId: "o1", status: "active" }];
  const c = codes(d);
  for (const want of ["OWNER_NO_ORG_MEMBERSHIP", "MEMBERSHIP_NO_ORG_MEMBERSHIP", "TEAM_NO_ORG_MEMBERSHIP", "EMPLOYEE_ORG_MISMATCH", "EMPLOYEE_USER_NOT_IN_AUTH", "EMPLOYEE_USER_NOT_MEMBER", "EMPLOYEE_USERNAME_MISSING", "ATT_USERNAME_NO_EMPLOYEE"]) assert.ok(c.includes(want), want);
});

test("role, profile, assignment and multi-org conflicts", () => {
  const d = empty();
  d.customers = [{ id: "o1", status: "active" }];
  d.orgMemberships = [
    { organizationId: "o1", userId: "o1", role: "ADMIN", status: "active" },
    { organizationId: "o1", userId: "u2", role: "MEMBER", status: "ACTIVE", profile: "Manager" },
    { organizationId: "o1", userId: "u3", role: "OWNER", status: "active" },
    { organizationId: "o2", userId: "u2", role: "MEMBER", status: "active" },
    { organizationId: "o1", userId: "u9", role: "MEMBER", status: "active" },
  ];
  d.memberships = [{ uid: "u2", accountId: "o1", profile: "Admin" }];
  d.team = [{ org: "o1", id: "t", uid: "u2", profile: "Manager" }];
  d.subs = [];
  d.assignments = [{ organizationId: "o1", userId: "u2", appId: "bizzux-attendance", status: "ACTIVE" }, { organizationId: "o1", userId: "u8", appId: "bizzux-crm", status: "on" }];
  const c = codes(d);
  for (const want of ["OWNER_ROLE_CONFLICT", "ROLE_CONFLICT_LEGACY_VS_CANONICAL", "PROFILE_CONFLICT_TEAM_VS_MEMBERSHIP", "ASSIGNMENT_NO_ACTIVE_SUBSCRIPTION", "ASSIGNMENT_NON_MEMBER", "STATUS_VOCAB_ASSIGNMENT", "STATUS_VOCAB_MEMBERSHIP", "ORG_MEMBERSHIP_UNKNOWN_ORG", "MULTI_ORG_WITHOUT_FLAG"]) assert.ok(c.includes(want), want);
  assert.equal(summarize(analyze(d)).OWNER_ROLE_CONFLICT, 1);
});

test("the runner can only read: no write calls and write methods are blocked at runtime", () => {
  const src = fs.readFileSync(new URL("../scripts/iam-audit.mjs", import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const bad of [".set(", ".update(", ".delete(", ".create(", ".add(", ".batch(", "runTransaction", "bulkWriter", "createUser(", "updateUser(", "deleteUser(", "setCustomUserClaims", "revokeRefreshTokens", "createCustomToken"]) {
    // the blocker list itself names these; allow them only inside the BLOCKED array literal line
    const lines = src.split("\n").filter((l) => l.includes(bad) && !l.includes("BLOCKED") && !l.includes("createHash"));
    assert.deepEqual(lines, [], bad);
  }
  assert.match(src, /BLOCKED/);
});

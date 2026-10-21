import { test } from "node:test";
import assert from "node:assert/strict";
import { sortRows, paginate, csvCell, toCsv } from "../lib/adminTable.js";

const rows = [
  { firstName: "Charu", username: "charu", orgRoleEffective: "MEMBER", status: "active", lastSignIn: "2026-10-20T10:00:00Z" },
  { firstName: "alan", username: "alan", orgRoleEffective: "ADMIN", status: "invited", lastSignIn: null },
  { firstName: "Bela", email: "bela@x.test", orgRoleEffective: "MEMBER", status: "active", lastSignIn: "2026-10-21T10:00:00Z" },
  { username: "dev", status: "disabled", lastSignIn: "2026-10-19T10:00:00Z", orgRoleEffective: "OWNER" },
];
const names = (r) => r.map((x) => x.firstName || x.username);

test("sorting: case-insensitive, both directions, stable, empty values last", () => {
  assert.deepEqual(names(sortRows(rows, { key: "name", dir: "asc" })), ["alan", "Bela", "Charu", "dev"]);
  assert.deepEqual(names(sortRows(rows, { key: "name", dir: "desc" })), ["dev", "Charu", "Bela", "alan"]);
  assert.deepEqual(names(sortRows(rows, { key: "lastSignIn", dir: "desc" })), ["Bela", "Charu", "dev", "alan"], "never-signed-in last");
  assert.deepEqual(names(sortRows(rows, { key: "lastSignIn", dir: "asc" })), ["dev", "Charu", "Bela", "alan"], "never-signed-in still last");
  assert.deepEqual(names(sortRows(rows, { key: "orgRole", dir: "asc" })), ["alan", "Charu", "Bela", "dev"], "ties keep their original order");
  assert.deepEqual(names(sortRows(rows, { key: "nonsense" })), ["alan", "Bela", "Charu", "dev"], "unknown key falls back to name");
  assert.equal(rows[0].firstName, "Charu", "input is not mutated");
});
test("paging: bounds, clamping, labels", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ i }));
  const p0 = paginate(many, 0, 25); assert.deepEqual([p0.from, p0.to, p0.total, p0.pages, p0.rows.length], [1, 25, 60, 3, 25]);
  const p2 = paginate(many, 2, 25); assert.deepEqual([p2.from, p2.to, p2.rows.length], [51, 60, 10]);
  assert.equal(paginate(many, 99, 25).page, 2, "page past the end clamps");
  assert.equal(paginate(many, -4, 25).page, 0);
  assert.equal(paginate(many, 0, 7).size, 25, "only the offered sizes");
  const e = paginate([], 0, 50); assert.deepEqual([e.from, e.to, e.pages, e.rows.length], [0, 0, 1, 0]);
});
test("CSV: quoting and formula-injection protection", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("=HYPERLINK(\"http://evil\")"), "\"'=HYPERLINK(\"\"http://evil\"\")\"");
  for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd"]) assert.ok(csvCell(bad).replace(/^"/, "").startsWith("'"), bad);
  assert.equal(csvCell("plain"), "plain");
  const out = toCsv([{ firstName: "Ann", lastName: "=cmd", username: "ann", appAccess: ["CRM", "Projects"], status: "active", orgRoleEffective: "ADMIN", loginKind: "username" }]);
  const lines = out.trim().split("\r\n");
  assert.equal(lines[0], "Name,Username,Email,Sign-in method,Organization role,Business profile,App access,Status,Last sign-in");
  assert.ok(lines[1].startsWith("\"'Ann =cmd\"") === false && lines[1].startsWith("Ann =cmd,ann,"), "only a leading formula character is neutralised");
  assert.ok(lines[1].includes("CRM; Projects"));
  assert.ok(!/password|hash|token|secret/i.test(out), "no secrets in the export");
});

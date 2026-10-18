import test from "node:test";
import assert from "node:assert/strict";
import { FLAGS, cleanFlags, resolveFlags, flagOn, flagChange } from "../lib/attendanceFlags.js";

test("everything is ON by default; Face + GPS is fixed OFF", () => {
  const f = resolveFlags({});
  assert.deepEqual(FLAGS.map((x) => f[x]), [true, true, true, true]);
  assert.equal(f.face_gps, false);
  assert.deepEqual(resolveFlags({ global: { face_gps: true }, org: { face_gps: true } }).face_gps, false); // can't be flipped on from a flag
});

test("only explicit booleans for known flags count: a damaged document can't switch anything off", () => {
  assert.deepEqual(cleanFlags({ verified: false, approvals: "no", allocation: 0, junk: false, smart_geofence: true }), { verified: false, smart_geofence: true });
  assert.deepEqual(cleanFlags(null), {});
  assert.deepEqual(cleanFlags("false"), {});
  assert.equal(resolveFlags({ global: { verified: "false" } }).verified, true);
});

test("global OFF wins everywhere; a company can only switch OFF, never back on", () => {
  const f = resolveFlags({ global: { smart_geofence: false }, org: { smart_geofence: true, verified: false } });
  assert.deepEqual([f.smart_geofence, f.verified, f.approvals], [false, false, true]);
  assert.deepEqual([f.source.smart_geofence, f.source.verified, f.source.approvals], ["global", "company", "default"]);
});

test("flagOn treats missing flags as on", () => {
  assert.equal(flagOn(null, "approvals"), true);
  assert.equal(flagOn({ approvals: false }, "approvals"), false);
});

test("a change request: scope, at least one capability, and a reason when switching OFF", () => {
  assert.equal(flagChange({ scope: "nope", values: { verified: false }, reason: "pilot issue" }).ok, false);
  assert.equal(flagChange({ scope: "global", values: {}, reason: "x" }).ok, false);
  assert.match(flagChange({ scope: "global", values: { verified: false }, reason: "" }).message, /reason/);
  const ok = flagChange({ scope: "company", values: { approvals: false, junk: true }, reason: "Customer asked to pause approvals" });
  assert.deepEqual([ok.ok, ok.patch], [true, { approvals: false }]);
  assert.equal(flagChange({ scope: "global", values: { verified: true }, reason: "" }).ok, true); // switching ON needs no reason
});

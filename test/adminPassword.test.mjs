import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordStrength } from "../lib/adminPassword.js";
test("strength meter", () => {
  assert.deepEqual(passwordStrength(""), { level: 0, label: "", ok: false });
  assert.equal(passwordStrength("short1").label, "Weak");
  assert.equal(passwordStrength("password").ok, false);
  assert.equal(passwordStrength("Abcdef12").ok, true);
  assert.equal(passwordStrength("Tr0ub4dor&3x!Long").label, "Strong");
  assert.equal(passwordStrength("aaaaaaaaaaaa").ok, false, "repeats are not strong");
});

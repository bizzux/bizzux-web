import { test } from "node:test";
import assert from "node:assert/strict";
import { discard, effective, hasChanges, isAdminLevelChange, isPastExpiry, localDay, stageValue } from "../lib/adminStaging.js";

const saved = { orgRole: "MEMBER", profile: "Manager" };

test("Save stays disabled until something really differs from the saved value", () => {
  let s = discard();
  assert.equal(hasChanges(s, saved), false, "nothing staged");
  s = stageValue(s, "orgRole", "VIEWER", saved.orgRole);
  assert.equal(hasChanges(s, saved), true, "a picked value enables Save");
  assert.equal(effective(s, "orgRole", saved.orgRole), "VIEWER");
  assert.equal(effective(s, "profile", saved.profile), "Manager", "an untouched field shows its saved value");
  s = stageValue(s, "orgRole", "MEMBER", saved.orgRole);
  assert.equal(hasChanges(s, saved), false, "picking the saved value again un-stages it");
  assert.deepEqual(s, {});
  assert.equal(hasChanges({ orgRole: "MEMBER" }, saved), false, "a stale staged value that now equals the saved one is not a change");
  assert.deepEqual(stageValue({ orgRole: "VIEWER" }, "orgRole", undefined, "MEMBER"), {}, "undefined clears a field (used after a partial save)");
});

test("Cancel discards everything staged and leaves the saved values alone", () => {
  let s = stageValue(stageValue({}, "orgRole", "ADMIN", saved.orgRole), "profile", "Viewer/Auditor", saved.profile);
  assert.equal(hasChanges(s, saved), true);
  s = discard();
  assert.deepEqual(s, {});
  assert.equal(hasChanges(s, saved), false);
  assert.equal(effective(s, "orgRole", saved.orgRole), "MEMBER");
  assert.equal(effective(s, "profile", saved.profile), "Manager");
  assert.deepEqual(saved, { orgRole: "MEMBER", profile: "Manager" }, "the saved values were never mutated");
  const before = {}; stageValue(before, "orgRole", "ADMIN", "MEMBER"); assert.deepEqual(before, {}, "stageValue returns a new object");
});

test("a past expiry date needs confirmation; today, the future and 'no expiry' do not", () => {
  const now = new Date(2026, 9, 28, 15, 30); // 28 Oct 2026, local time
  assert.equal(localDay(now), "2026-10-28");
  assert.equal(isPastExpiry("2026-10-27", now), true, "yesterday locks them out immediately");
  assert.equal(isPastExpiry("2020-01-01", now), true);
  assert.equal(isPastExpiry("2026-10-28", now), false, "today is allowed: they can sign in until the end of that day");
  assert.equal(isPastExpiry("2026-10-29", now), false);
  assert.equal(isPastExpiry("2027-01-01", now), false);
  assert.equal(isPastExpiry("", now), false, "Clear (no expiry) never needs confirming");
  assert.equal(isPastExpiry(null, now), false);
  assert.equal(localDay(new Date(2026, 0, 5, 0, 1)), "2026-01-05", "month and day are zero-padded");
  assert.equal(localDay(new Date(2026, 11, 31, 23, 59)), "2026-12-31", "local calendar day, not UTC");
});

test("Admin-level changes need confirmation (to or from Admin, by role or by profile); other changes do not", () => {
  const c = (o) => isAdminLevelChange({ curRole: "MEMBER", nextRole: "MEMBER", curProfile: "Manager", nextProfile: "Manager", ...o });
  assert.equal(c({}).any, false, "no change");
  assert.deepEqual([c({ nextRole: "ADMIN" }).toAdmin, c({ nextRole: "ADMIN" }).fromAdmin], [true, false], "Member -> Admin");
  assert.deepEqual([c({ curRole: "ADMIN", nextRole: "MEMBER" }).toAdmin, c({ curRole: "ADMIN", nextRole: "MEMBER" }).fromAdmin], [false, true], "Admin -> Member");
  assert.equal(c({ nextProfile: "Admin" }).toAdmin, true, "profile to Admin");
  assert.equal(c({ nextProfile: "Global Admin" }).toAdmin, true, "profile to Global Admin");
  assert.equal(c({ curProfile: "Admin", nextProfile: "Manager" }).fromAdmin, true, "profile away from Admin");
  assert.equal(c({ nextRole: "VIEWER" }).any, false, "Member -> Viewer is not Admin-level");
  assert.equal(c({ nextProfile: "Viewer/Auditor" }).any, false, "Manager -> Viewer/Auditor is not Admin-level");
  assert.equal(c({ curRole: "ADMIN", nextRole: "ADMIN", curProfile: "Admin", nextProfile: "Admin" }).any, false, "an unchanged Admin needs no confirmation");
  assert.equal(isAdminLevelChange({ curRole: "MEMBER", nextRole: "ADMIN" }).any, true, "role-only call (Users table) works without profile arguments");
});

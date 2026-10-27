import { test } from "node:test";
import assert from "node:assert/strict";
import { appAdminChanged, appChanges, discard, effective, hasChanges, isAdminLevelChange, isPastExpiry, localDay, savedApp, stageApp, stageValue } from "../lib/adminStaging.js";

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

const apps = [
  { appId: "bizzux-crm", access: true, appRole: "MEMBER", source: "assignment", reason: "" },
  { appId: "bizzux-chat", access: false, appRole: null, source: "denied", reason: "app_not_assigned" },
  { appId: "bizzux-files", access: true, appRole: "ADMIN", source: "assignment", reason: "" },
];

test("apps: the saved state of an app is access plus Admin; an app without access is never Admin", () => {
  assert.deepEqual(savedApp(apps[0]), { granted: true, admin: false });
  assert.deepEqual(savedApp(apps[1]), { granted: false, admin: false });
  assert.deepEqual(savedApp(apps[2]), { granted: true, admin: true });
  assert.deepEqual(savedApp({ access: false, appRole: "ADMIN" }), { granted: false, admin: false });
});

test("apps: ticking Admin also gives access, clearing access also clears Admin, and the saved value un-stages the app", () => {
  let s = stageApp({}, apps, "bizzux-chat", { admin: true });
  assert.deepEqual(s, { "bizzux-chat": { granted: true, admin: true } }, "Admin implies access");
  s = stageApp(s, apps, "bizzux-chat", { granted: false });
  assert.deepEqual(s, {}, "clearing access clears Admin and returns to the saved state, so nothing is staged");
  s = stageApp({}, apps, "bizzux-files", { granted: false });
  assert.deepEqual(s, { "bizzux-files": { granted: false, admin: false } });
  s = stageApp(s, apps, "bizzux-files", { granted: true, admin: true });
  assert.deepEqual(s, {}, "back to the saved Admin access: un-staged");
});

test("apps: Save is only for apps that really differ, and only an Admin change needs the by-name confirmation", () => {
  assert.deepEqual(appChanges(apps, {}), []);
  assert.deepEqual(appChanges(apps, { "bizzux-crm": { granted: true, admin: false } }), [], "a stale staged value equal to the saved one is not a change");
  const grant = appChanges(apps, { "bizzux-chat": { granted: true, admin: false } });
  assert.deepEqual(grant, [{ appId: "bizzux-chat", from: { granted: false, admin: false }, to: { granted: true, admin: false } }]);
  assert.equal(appAdminChanged(grant), false, "a plain grant needs no confirmation");
  const toAdmin = appChanges(apps, { "bizzux-crm": { granted: true, admin: true } });
  assert.equal(appAdminChanged(toAdmin), true, "making an app Admin is confirmed");
  const fromAdmin = appChanges(apps, { "bizzux-files": { granted: false, admin: false } });
  assert.equal(appAdminChanged(fromAdmin), true, "removing an app Admin is confirmed");
  assert.equal(appChanges(apps, {}).length === 0, true, "Cancel is simply an empty stage");
});

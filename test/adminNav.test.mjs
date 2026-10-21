import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV, findActive, breadcrumbOf, visibleChildren, hrefOf } from "../components/admin/adminNavConfig.js";

test("active item follows either host's path, and groups keep their child active", () => {
  assert.equal(findActive("/users").item.key, "active");
  assert.equal(findActive("/users").group.key, "users");
  assert.equal(findActive("/team").item.key, "active");
  assert.equal(findActive("/team/").item.key, "active", "trailing slash");
  assert.equal(findActive("/apps").item.key, "apps");
  assert.equal(findActive("/team/groups").item.key, "teams");
  assert.equal(findActive("/teams").item.key, "teams");
  assert.equal(findActive("/security").group, null);
  assert.equal(findActive("/nothing"), null);
});
test("Users group lists its four screens and each resolves on both hosts", () => {
  const kids = visibleChildren(NAV.find((g) => g.key === "users")).map((c) => c.key);
  assert.deepEqual(kids, ["active", "contacts", "guests", "deleted"]);
  assert.equal(findActive("/users/deleted").item.key, "deleted");
  assert.equal(findActive("/team/contacts").item.key, "contacts");
  assert.equal(findActive("/users/guests").group.key, "users");
});
test("hrefs use the admin spelling on the admin host and the legacy one elsewhere", () => {
  const apps = NAV.find((g) => g.key === "apps");
  assert.equal(hrefOf(apps, true), "/apps");
  assert.equal(hrefOf(apps, false), "/team/apps");
});
test("breadcrumb", () => {
  assert.deepEqual(breadcrumbOf(findActive("/users")), ["Admin Center", "Users", "Active users"]);
  assert.deepEqual(breadcrumbOf(findActive("/roles")), ["Admin Center", "Roles & permissions"]);
  assert.deepEqual(breadcrumbOf(null), ["Admin Center"]);
});

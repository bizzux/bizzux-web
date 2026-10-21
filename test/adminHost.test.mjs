import test from "node:test";
import assert from "node:assert/strict";
import { decide, ADMIN_PATHS, isAdminHost, safeAdminTarget, legacyToAdminPath } from "../lib/adminHost.js";

const cfg = { adminOrigin: "https://admin.bizzux.com", wwwOrigin: "https://www.bizzux.com", redirectLegacy: true };
const ADMIN = "admin.bizzux.com", WWW = "www.bizzux.com";

test("admin host maps friendly paths onto the existing pages without changing the URL", () => {
  for (const [a, legacy] of Object.entries(ADMIN_PATHS)) assert.deepEqual(decide({ host: ADMIN, pathname: a, search: "?x=1" }, cfg), { type: "rewrite", path: legacy + "?x=1" });
  assert.deepEqual(decide({ host: ADMIN, pathname: "/users/", search: "" }, cfg), { type: "rewrite", path: "/team" });
});
test("admin root goes to /users; old /team URLs on the admin host move to the new path on the SAME host", () => {
  assert.deepEqual(decide({ host: ADMIN, pathname: "/" }, cfg), { type: "redirect", url: "/users", status: 307 });
  assert.deepEqual(decide({ host: ADMIN, pathname: "/team/apps", search: "?a=b" }, cfg), { type: "redirect", url: "/apps?a=b", status: 307 });
});
test("admin host never serves the marketing/portal pages, but lets APIs, assets and the SSO landing through", () => {
  for (const p of ["/pricing", "/dashboard", "/admin", "/profile", "/random"]) assert.equal(decide({ host: ADMIN, pathname: p }, cfg).type, "notfound", p);
  for (const p of ["/api/team", "/api/me", "/_next/static/x.js", "/sso", "/favicon.ico", "/logo.png"]) assert.equal(decide({ host: ADMIN, pathname: p }, cfg).type, "next", p);
});
test("admin /sign-in hands over to www once, with a whitelisted target only", () => {
  const d = decide({ host: ADMIN, pathname: "/sign-in", search: "?to=/apps" }, cfg);
  assert.equal(d.url, "https://www.bizzux.com/open-admin?to=%2Fapps");
  assert.match(decide({ host: ADMIN, pathname: "/sign-in", search: "?to=https://evil.example" }, cfg).url, /to=%2Fusers$/);
  assert.equal(safeAdminTarget("//evil.example"), "/users");
  assert.equal(safeAdminTarget("/team"), "/users");
});
test("www /team redirects only when the rollout flag is on, and preserves the query", () => {
  assert.deepEqual(decide({ host: WWW, pathname: "/team", search: "?tab=1" }, cfg), { type: "redirect", url: "https://admin.bizzux.com/users?tab=1", status: 307 });
  assert.equal(decide({ host: WWW, pathname: "/team/groups" }, cfg).url, "https://admin.bizzux.com/teams");
  assert.equal(decide({ host: WWW, pathname: "/team" }, { ...cfg, redirectLegacy: false }).type, "next");
  assert.equal(decide({ host: WWW, pathname: "/accept-invite", search: "?invite=t" }, cfg).type, "next", "invite links stay on www");
  assert.equal(decide({ host: WWW, pathname: "/dashboard" }, cfg).type, "next");
  assert.equal(decide({ host: "localhost:3000", pathname: "/team" }, { ...cfg, redirectLegacy: false }).type, "next");
});
test("no redirect loop: following redirects from any start terminates within 2 hops and never bounces www<->admin for the same path", () => {
  const paths = ["/", "/team", "/team/apps", "/team/groups", "/team/security", "/users", "/apps", "/teams", "/security", "/sign-in", "/dashboard", "/accept-invite", "/team/unknown"];
  for (const startHost of [WWW, ADMIN]) for (const p0 of paths) {
    let host = startHost, path = p0, hops = 0;
    for (;;) {
      const d = decide({ host, pathname: path }, cfg);
      if (d.type !== "redirect") break;
      hops++; assert.ok(hops <= 2, `${startHost}${p0} looped`);
      const u = new URL(d.url, "https://" + host);
      host = u.host; path = u.pathname;
      // an open-admin hop lands on www at a page that is never redirected by this function
    }
  }
});
test("helpers", () => {
  assert.equal(isAdminHost("ADMIN.bizzux.com:443"), true);
  assert.equal(isAdminHost("www.bizzux.com"), false);
  assert.equal(isAdminHost("administrator.bizzux.com"), false);
  assert.equal(legacyToAdminPath("/team/"), "/users");
  assert.equal(legacyToAdminPath("/team/x"), null);
});

import { safeNext } from "../lib/safeNext.js";
test("sign-in next: only the hand-off page with a whitelisted target is honoured", () => {
  assert.equal(safeNext(encodeURIComponent("/open-admin?to=/users")), "/open-admin?to=/users");
  assert.equal(safeNext("/open-admin?to=/apps"), "/open-admin?to=/apps");
  for (const bad of ["https://evil.example", "//evil.example", "/dashboard", "/open-admin?to=https://evil.example", "/open-admin?to=/team", "/open-admin?to=/users&x=1", "javascript:alert(1)", "", null, "%E0%A4%A"]) assert.equal(safeNext(bad), null, String(bad));
});

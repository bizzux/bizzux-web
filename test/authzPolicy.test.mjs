import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../lib/authz/policy.js";

const sub = (o = {}) => ({ status: "ACTIVE", subscriptionType: "PAID", ...o });
const asg = (role = "MEMBER", status = "ACTIVE") => ({ status, role });
const NOW = Date.parse("2026-10-22T00:00:00Z");

test("organization role: legacy derivation until explicitly set; explicit wins both ways", () => {
  assert.equal(P.effectiveOrgRole({ isOwner: true }).role, "OWNER");
  assert.deepEqual(P.effectiveOrgRole({ profile: "Admin" }), { role: "ADMIN", source: "legacy-profile", active: true });
  assert.equal(P.effectiveOrgRole({ profile: "Global Admin" }).role, "ADMIN");
  assert.equal(P.effectiveOrgRole({ profile: "Manager" }).role, "MEMBER");
  assert.equal(P.effectiveOrgRole({ profile: "Staff/Shopkeeper" }).role, "MEMBER");
  assert.equal(P.effectiveOrgRole({ profile: "Viewer/Auditor" }).role, "VIEWER");
  // a canonical role WITHOUT roleSource explicit is ignored (it is only a backfilled classification)
  assert.equal(P.effectiveOrgRole({ profile: "Staff/Shopkeeper", canonical: { role: "ADMIN", status: "active" } }).role, "MEMBER");
  assert.equal(P.effectiveOrgRole({ profile: "Staff/Shopkeeper", canonical: { role: "ADMIN", roleSource: "explicit", status: "active" } }).role, "ADMIN");
  assert.equal(P.effectiveOrgRole({ profile: "Admin", canonical: { role: "MEMBER", roleSource: "explicit", status: "active" } }).role, "MEMBER", "explicit demotion beats a legacy Admin profile");
  assert.equal(P.effectiveOrgRole({ profile: "Admin", canonical: { role: "ADMIN", status: "suspended" } }).active, false, "suspended/removed members have no organization authority");
  assert.equal(P.effectiveOrgRole({ profile: "Staff/Shopkeeper", canonical: { role: "OWNER", roleSource: "explicit", status: "active" } }).role, "MEMBER", "OWNER can never be conferred through a membership record");
});

test("organization permissions: ADMIN administers, MEMBER/VIEWER do not; explicit grants only for ADMIN", () => {
  const s = (role, permissions = []) => ({ role, active: true, permissions });
  for (const p of ["users.create", "users.invite", "users.link", "apps.assign", "roles.assign_member"]) { assert.ok(P.orgCan(s("ADMIN"), p), p); assert.ok(!P.orgCan(s("MEMBER"), p), p); assert.ok(!P.orgCan(s("VIEWER"), p), p); }
  for (const p of ["org.billing", "org.transfer", "org.delete", "roles.assign_admin", "members.approve"]) { assert.ok(P.orgCan(s("OWNER"), p), p); assert.ok(!P.orgCan(s("ADMIN"), p), "admin must not have " + p); }
  assert.ok(P.orgCan(s("ADMIN", ["members.approve"]), "members.approve"));
  assert.ok(!P.orgCan(s("MEMBER", ["members.approve"]), "members.approve"), "explicit grants are ignored for non-admins");
  assert.ok(!P.orgCan(s("ADMIN", ["org.delete"]), "org.delete"), "only the grantable list can be handed out");
  assert.ok(!P.orgCan({ role: "ADMIN", active: false }, "users.view"), "inactive = nothing");
});

test("escalation rules for changing an organization role", () => {
  const admin = { role: "ADMIN", active: true }, owner = { role: "OWNER", active: true }, member = { role: "MEMBER", active: true }, other = { role: "ADMIN", active: true };
  const t = (o) => P.canChangeOrgRole({ actorUid: "a", targetUid: "t", ...o });
  assert.deepEqual(t({ actor: owner, target: member, newRole: "ADMIN" }), { ok: true, reason: "" });
  assert.equal(t({ actor: admin, target: member, newRole: "ADMIN" }).reason, "only_owner_changes_admins", "an Admin cannot mint Admins");
  assert.equal(t({ actor: admin, target: other, newRole: "MEMBER" }).reason, "only_owner_changes_admins", "an Admin cannot demote Admins");
  assert.equal(t({ actor: admin, target: member, newRole: "VIEWER" }).ok, true);
  assert.equal(t({ actor: member, target: member, newRole: "VIEWER" }).reason, "not_authorized");
  assert.equal(t({ actor: owner, actorUid: "x", targetUid: "x", target: member, newRole: "ADMIN" }).reason, "self_change");
  assert.equal(t({ actor: owner, target: { role: "OWNER", active: true }, newRole: "MEMBER" }).reason, "owner_is_fixed");
  assert.equal(t({ actor: owner, target: member, newRole: "OWNER" }).reason, "invalid_role");
  assert.equal(t({ actor: owner, target: { role: "MEMBER", active: false }, newRole: "ADMIN" }).reason, "target_not_active_member");
  assert.equal(t({ actor: member, actorIsPlatform: true, target: member, newRole: "ADMIN" }).ok, true, "a Platform Admin may act for the company");
});

test("SCENARIO F: promoting MEMBER to ADMIN changes organization permissions and nothing about application access", () => {
  const before = P.effectiveOrgRole({ profile: "Staff/Shopkeeper", canonical: { role: "MEMBER", roleSource: "explicit", status: "active" } });
  const after = P.effectiveOrgRole({ profile: "Staff/Shopkeeper", canonical: { role: "ADMIN", roleSource: "explicit", status: "active" } });
  assert.ok(!P.orgCan(before, "users.create") && P.orgCan(after, "users.create"));
  const app = (assignment) => P.appAccessDecision({ subscription: sub(), membership: { status: "active" }, assignment });
  assert.deepEqual(app(asg("MEMBER")), app(asg("MEMBER")), "same inputs, same app decision: the org role is not an input");
  assert.equal(app(null).allowed, false, "still no app access without an assignment");
  assert.equal(app(asg("MEMBER")).appRole, "MEMBER", "an org ADMIN is still only a MEMBER of the app");
  const ex = P.explainAccess({ orgSubject: after, apps: ["bizzux-crm"], subscriptions: { "bizzux-crm": sub() }, assignments: {} });
  assert.equal(ex.apps[0].access, false);
  assert.equal(ex.orgRole, "ADMIN");
});

test("app role is independent of organization role", () => {
  const d = (role) => P.appAccessDecision({ subscription: sub(), membership: { status: "active" }, assignment: asg(role) });
  assert.equal(d("ADMIN").appRole, "ADMIN"); assert.equal(d("MEMBER").appRole, "MEMBER"); assert.equal(d("weird").appRole, "MEMBER", "unknown values are least privilege");
  assert.ok(!P.orgCan({ role: "MEMBER", active: true }, "users.create"), "an app ADMIN gains no organization power");
});

// permission matrix: persona x policy mode
const personas = {
  platform: { isPlatform: true },
  owner: { isOwner: true },
  ownerNoSubRecord: { isOwner: true, subscription: null },
  admin: { subscription: sub(), membership: { status: "active" }, assignment: asg("ADMIN") },
  manager: { subscription: sub(), membership: { status: "active" }, assignment: asg("MEMBER") },
  member: { subscription: sub(), membership: { status: "active" }, assignment: asg("MEMBER") },
  viewerNoAssign: { subscription: sub(), membership: { status: "active" }, assignment: null },
  contractor: { subscription: sub(), membership: { status: "active" }, assignment: asg("MEMBER") },
  suspended: { subscription: sub(), membership: { status: "suspended" }, assignment: asg("MEMBER") },
  removed: { subscription: sub(), membership: { status: "removed" }, assignment: asg("MEMBER") },
  revokedAssignment: { subscription: sub(), membership: { status: "active" }, assignment: asg("MEMBER", "INACTIVE") },
  revokedSubscription: { subscription: sub({ status: "INACTIVE" }), membership: { status: "active" }, assignment: asg("MEMBER") },
  ownerRevokedSub: { isOwner: true, subscription: sub({ status: "INACTIVE" }) },
  trialExpired: { isOwner: true, subscription: sub({ subscriptionType: "TRIAL", expiresAt: new Date(NOW - 86400000).toISOString() }) },
  memberTrialExpired: { subscription: sub({ subscriptionType: "TRIAL", expiresAt: new Date(NOW - 86400000).toISOString() }), membership: { status: "active" }, assignment: asg("MEMBER") },
  noSubRecordMember: { subscription: null, membership: { status: "active" }, assignment: asg("MEMBER") },
  legacyNoMembership: { subscription: sub(), membership: null, assignment: asg("MEMBER") },
};
const expectBy = {
  //                       legacy                strict
  platform: ["ADMIN", "ADMIN"], owner: ["ADMIN", "app_not_licensed"], ownerNoSubRecord: ["ADMIN", "app_not_licensed"],
  admin: ["ADMIN", "ADMIN"], manager: ["MEMBER", "MEMBER"], member: ["MEMBER", "MEMBER"], viewerNoAssign: ["app_not_assigned", "app_not_assigned"], contractor: ["MEMBER", "MEMBER"],
  suspended: ["user_suspended", "user_suspended"], removed: ["user_suspended", "user_suspended"], revokedAssignment: ["app_not_assigned", "app_not_assigned"],
  revokedSubscription: ["app_not_enabled", "app_not_enabled"], ownerRevokedSub: ["app_not_enabled", "app_not_enabled"],
  trialExpired: ["ADMIN", "app_trial_expired"], memberTrialExpired: ["MEMBER", "app_trial_expired"], noSubRecordMember: ["app_not_assigned", "app_not_licensed"],
  legacyNoMembership: ["MEMBER", "MEMBER"],
};
test("entitlement matrix: every persona under legacy (today) and strict (proposed)", () => {
  const rows = [];
  for (const [name, input] of Object.entries(personas)) {
    for (const [i, mode] of ["legacy", "strict"].entries()) {
      const d = P.appAccessDecision({ ...input, policyMode: mode, now: NOW });
      const got = d.allowed ? d.appRole : d.code;
      rows.push(`${name.padEnd(20)} ${mode.padEnd(7)} ${got}`);
      assert.equal(got, expectBy[name][i], `${name} / ${mode}`);
    }
  }
  console.log(rows.join("\n"));
});

test("deny by default: empty or malformed input never allows", () => {
  assert.equal(P.appAccessDecision({}).allowed, false);
  assert.equal(P.appAccessDecision({ subscription: sub(), assignment: { status: "active" } }).allowed, false, "status must be exactly ACTIVE");
  assert.equal(P.appAccessDecision({ subscription: { status: "active" }, assignment: asg() }).allowed, false);
  assert.deepEqual(P.orgPermissionsOf(null), []);
  assert.equal(P.effectiveOrgRole({ profile: "" }).role, "MEMBER");
});

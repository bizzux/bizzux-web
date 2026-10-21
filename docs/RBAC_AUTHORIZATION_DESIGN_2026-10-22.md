# Layered central authorization (RBAC): design, schema and impact (2026-10-22)

Status: built and tested on local emulators. NOT deployed. Every behaviour change is either legacy-compatible by construction or behind an off-by-default switch.

## 1. The five layers (never merged into one)
| Layer | Where it lives | What it controls | What it must NOT do |
|---|---|---|---|
| Platform role | `platformAdmins/{uid}`, env super admin | Bizzux staff; bypasses company gates | Never granted by a company |
| Organization role | `organizationMemberships/{org}_{uid}.role` (`OWNER/ADMIN/MEMBER/VIEWER`), `roleSource` | Organization operations: users, invitations, links, role assignment, app assignment | Grant any application permission |
| Application role | `appAssignments/{org}_{uid}_{app}.role` (`ADMIN/MEMBER`) | Permissions inside ONE app | Grant organization permissions |
| Business relationship | person type / employment type (Employee, Contractor...) and the legacy business profile | Describes the person and drives the apps' existing in-app permissions | Grant or remove organization or application access |
| License entitlement | `organizationAppSubscriptions/{org}_{app}` (+ company trial/plan state) | Whether the company may use an app | Identify a person |

One pure module, `lib/authz/policy.js`, decides all of it (no I/O, deny by default, one company per decision). The portal imports it; each of the 8 split apps carries a byte-identical copy `lib/authzPolicy.js` produced by `scripts/sync-authz-policy.mjs` (`--check` reports drift). The apps' existing `entitlementDenial` is now a thin gatherer that calls `appAccessDecision`; it also returns `appRole`.

## 2. Authorization schema (additive, no migration needed)
- `organizationMemberships.roleSource`: absent or `"legacy"` = the stored role is only a classification and the effective organization role is derived from the business profile exactly as before; `"explicit"` = an administrator set it through the central service and it is authoritative in BOTH directions (promotion and demotion). A later profile sync never overwrites an explicit role.
- `organizationMemberships.roleUpdatedAt/By` for audit; `permissions[]` unchanged (only `members.approve` is grantable, only to ADMIN).
- `appAssignments.role` already existed (`ADMIN|MEMBER`); it is now the application role.
- No new collection. No Firestore rules change.

## 3. Organization permission matrix (enforced on the server)
| Permission | OWNER | ADMIN | MEMBER | VIEWER |
|---|---|---|---|---|
| users.view / create / invite / link / suspend / remove / reset_password | yes | yes | no | no |
| apps.assign | yes | yes | no | no |
| roles.assign_member (Member <-> Viewer) | yes | yes | no | no |
| roles.assign_admin (make or remove an Admin) | yes | no | no | no |
| members.approve | yes | only if granted | no | no |
| org.settings / billing / transfer / delete | yes | no | no | no |
Escalation rules (all server-side): nobody changes their own role or the Owner's; OWNER cannot be assigned; an Admin cannot create or demote Admins; a Platform Admin may act for a company; suspended or removed members have no organization authority.
Changing an organization role writes only `role/roleSource` (+audit). It never touches the business profile, app assignments or licences.

## 4. Application authorization
- Access to an app = license entitlement AND (owner OR active membership + ACTIVE assignment). Same decision in all 8 apps and the portal.
- Application role = `assignment.role`, exposed to every app as `acct.appRole`.
- Attendance consumes it: `assignment.role == ADMIN` makes someone an Attendance administrator ONLY when `APP_ROLE_ENFORCE=1` (default OFF). Existing assignments created through "Manage roles & app access" with the per-app Admin box ticked would become Attendance admins when switched on: review them before enabling.
- The other apps keep their in-app permission logic (business profile) until migrated; they already receive `appRole` for the next step.
- Existing business-profile permissions are unchanged everywhere.

## 5. Revocation, suspension and stale-session policy
- Organization authority is read live on every administrative request (no cache): a demotion or suspension applies to the next request even with a valid token.
- Application access: each app caches the decision per process for at most `REVOCATION_CACHE_MS` = 30 s. A revoked assignment, revoked subscription, suspension or role change reaches every app within 30 s, immediately in any fresh process.
- Suspension: Firebase user disabled (tokens rejected at once: tested) and membership status set; both are honoured.
- Deny by default: missing, malformed or non-`ACTIVE`-exact values never grant.

## 6. Subscription / entitlement audit (Owner bypass) and proposed policy
Current behaviour (identical in all 8 apps and the portal, confirmed by code and by the matrix test):
1. A subscription record that exists and is not ACTIVE blocks everyone, owner included.
2. A MISSING subscription record is tolerated for the Owner only (companies that pre-date the model).
3. Owner never needs an assignment (correct: ownership is not an app role).
4. Company trial or suspended state is gated separately (`canAccessApps`, HTTP 402) before the app decision.
5. A TRIAL-type subscription record with a past `expiresAt` is NOT checked at the app level today.
6. Platform admins bypass the company gates.
Proposed `ENTITLEMENT_POLICY=strict` (implemented, OFF): owners also need an ACTIVE subscription record (no missing-record bypass); TRIAL subscriptions past `expiresAt` are refused for everyone; everything else unchanged. Pure matrix tested for 17 personas under both modes.
Migration before it can be switched on: (a) read-only audit of every company: list companies whose subscription record is missing for an app they use (they would be locked out); (b) backfill ACTIVE records for those, approved per company; (c) confirm TRIAL records carry correct `expiresAt`; (d) switch the env in the portal and then in each app, one at a time, with `ENTITLEMENT_POLICY=legacy` as instant rollback. Needs approval and production reads; not run.

## 7. Cross-app impact assessment
| Component | Change | Risk | Compatibility |
|---|---|---|---|
| Portal `requireOrgManager`, `requireAccountAdmin`, `/api/me` | Admin-ness from the effective organization role | A legacy Admin whose canonical role is `suspended`/`removed` is now refused | Legacy profile still grants admin until a role is set explicitly |
| Portal `appEntitlementDenial` | Uses the shared policy | A non-owner with an assignment but no canonical membership is now tolerated (as the apps already did) | Same codes |
| `upsertOrganizationMembership` | Does not overwrite an explicit role | None | Additive |
| 8 apps `firebaseAdmin.js` | Entitlement via shared policy, `appRole` exposed | Texts identical; 30 s cache preserved | Matrix test: identical results in all 8 |
| Attendance `requireAttendance` | `appRole` honoured only behind `APP_ROLE_ENFORCE=1` | Off by default | Nothing changes until enabled |
| Users page | Organization role and App roles shown separately, with source | UI only | Legacy modal still works |
Go-live ordering when approved: portal first (it only reads/derives), then apps one by one (each is a self-contained file replacement), flags off.

## 8. Outstanding blockers before go-live
1. Approval for deployment and (separately) for any flag.
2. Entitlement strict-mode migration audit (needs production reads, not approved).
3. Decision whether to enable `APP_ROLE_ENFORCE` and review of existing assignments with role ADMIN.
4. In-app permission migration of the other 7 apps to `appRole` (their own profile logic remains).
5. Real-account smoke tests after deploy (none run).

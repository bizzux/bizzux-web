# Shared IAM service: cross-app impact assessment (2026-10-22)

## Findings that drive the design
- Portal already has a mature identity path: `/api/admin/username-users` (create, requestLink, linkUser, setApps, suspend, reset) with tenant check, entitlement check, seat limit, audit and canonical membership writes. Store: `usernames/{u}` + real Firebase Auth user.
- Attendance runs a SECOND username store (`attUsernames`, pseudo-uid `att_*`, own login route `/api/att/login`, own membership writes in `lib/attUsernameServer.js`). It is cross-checked for name clashes only. This is the duplicate identity service the brief forbids going forward.
- Split apps already call bizzux-web `/api/*` with a Bearer ID token (CORS allow-list in `middleware.js`), so the portal is the natural host of the shared service.

## Decisions
| Capability | Decision | Detail |
|---|---|---|
| Create username identity | EXTRACT | Move logic out of the admin route into `lib/iam/identityService.js`; admin route and new `/api/iam/*` both call it. |
| Link existing identity | EXTEND | Reuse `lib/linkRequests.js` (person accepts) and `linkUserToOrganization`; add exact-match lookup (no enumeration). |
| App grant / revoke | EXTRACT | `setApps` logic moves into the service; seat/entitlement check in one place. |
| Directory (Users table data) | NEW | `GET /api/iam/directory`: reads `organizationMemberships` (canonical), joins username/email, apps, status. Org-scoped; Platform Admin may pass organizationId. |
| Join by code / link / search | EXTEND | Existing `joinRequests`/`companyCode`; add shareable join link and name search returning only opt-in joinable orgs (name + code), never members. |
| Attendance Add Person: new username login | REUSE service | Attendance server calls `POST {PORTAL}/api/iam/identities` with the actor's Bearer token and stores the returned uid on the employee. No new writes to `attUsernames`. |
| Legacy `attUsernames` accounts | REUSE as is | Keep the login route so existing people still sign in. No migration without approval. |
| Admin Center `/users` | EXTEND | New page on the existing host routing; reads the directory API. |

## Cross-app impact
- Portal: new `lib/iam/*`, `app/api/iam/*`; admin route refactored (behaviour-identical, covered by tests); new Users page behind the existing flags.
- Attendance: employees route and sign-in call the service for NEW logins; legacy path unchanged. Needs `PORTAL_API_ORIGIN`.
- Other 7 apps: no code change. They resolve access via canonical memberships and `appAssignments`, which the service writes.
- Risks: Attendance sign-in for portal-store usernames uses the portal username-login endpoint (cross-origin, already allowed); cross-deploy dependency on portal availability; both must deploy together (flagged, not deployed here).
- Rollback: everything flag-gated; no data migration; branches unmerged.

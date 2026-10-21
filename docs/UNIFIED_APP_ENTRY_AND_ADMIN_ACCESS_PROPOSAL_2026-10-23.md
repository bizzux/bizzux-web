# Unified app entry, profile menu, Admin Center access and Add Employee: review and proposal (2026-10-23)

Status: REVIEW AND PROPOSAL ONLY. No code changed, nothing deployed. Approval needed before any build.

## 1. What exists today (evidence from the code)
| Area | Today | Where |
|---|---|---|
| App navigation | Attendance has its own rich shell (sidebar or top menu, People, Shifts, Locations, Administration group). The other 7 apps each have a small top bar. | `bizzux-attendance/components/Shell.js`, `SideNav.js`; `TopBar.js` / `Nav.js` in the others |
| Switch application | Seven apps ship a hard-coded `AppSwitcher.js` in THREE different versions (identical in files/notes/projects, different in chat, crm, finance, mail). Attendance has none. The list is fixed, not based on what the person is licensed or assigned. | `components/AppSwitcher.js` per app |
| Profile menu | Does not exist. Attendance has plain buttons (Full menu, Sign out); the other apps have a switcher icon and Sign out. | per app |
| Admin Center link | Only inside the portal (`Nav.tsx`). No app links to it. | portal |
| App to app sign-in | Portal `/api/app-sso?app=X` returns a URL containing a token. Production does NOT set `SSO_V2_SIGNING` or `SSO_TOKEN_IN_FRAGMENT`, so today the token travels in the URL QUERY string (v1: not audience-bound, not single-use). | `app/api/app-sso/route.js` |
| Portal to Admin Center sign-in | Audience-bound, single-use, 60-second HMAC token in the URL FRAGMENT (never sent to servers or Referer), exchanged on the admin host for a Firebase sign-in of the same person. No shared cookies. | `app/api/admin-center/handoff/route.js` |
| Add employee in Attendance | Own People page and a 5-step form. New username logins already go through the shared IAM service when `IAM_SERVICE_ORIGIN` is set (it is, in production). | `components/people/PersonForm.js` |
| Server checks | One shared policy (`authzPolicy.js`) already decides organization role, app role and licence in all apps. | all apps |

Findings that matter for this request: (1) the switcher is not entitlement-aware, so it can offer apps a person cannot open; (2) three divergent copies will drift; (3) app switching puts a token in the URL; (4) nothing links an app user to central administration.

## 2. Principle
The menu is a PRESENTATION of server decisions. One portal endpoint decides what a person sees, from the same shared policy the servers already use to enforce access, so a hidden link and a refused request always agree. Hiding is for tidiness; the backend refuses regardless.

## 3. Minimum reusable changes
| # | Change | Reuse or new | Notes |
|---|---|---|---|
| 1 | `GET /api/shell/menu` on the portal, Bearer token, CORS for `*.bizzux.com`. Returns: person, active company, apps the person can actually open (licensed + assigned + not suspended), `admin: { show, role }`, `addEmployee: { workforce: bool, central: bool }`. Built from `lib/authz/policy.js` and the existing membership/assignment records. | EXTEND (policy, canonical memberships) | One decision point for all 8 apps |
| 2 | One shared client component `BizzuxProfileMenu` (top-right avatar menu: Switch Bizzux application, Admin Center when allowed, Profile, Sign out) plus a tiny hook. Kept in the portal repo and copied byte-for-byte into each app by a sync script with a `--check` drift test, the same method already used for `authzPolicy.js`. Replaces the 3 AppSwitcher variants. | NEW component, REUSE sync method | No new package infrastructure |
| 3 | Each app mounts the menu in its OWN top bar and keeps its own navigation. Attendance keeps People, Shifts, Locations. | EXTEND per app (small) | Requirement 1 |
| 4 | Attendance sidebar gets an Administration group entry "Admin Center", shown only when the menu endpoint says `admin.show`. Attendance's own admin screens (Settings, Modes and licences) stay where they are. | EXTEND | Requirement 2 |
| 5 | Secure hand-off to `admin.bizzux.com` from any app: `POST /api/admin-center/handoff` with the person's token and a context `{ from, intent, returnTo }`; the server validates `from`/`returnTo` against an allow-list of Bizzux app origins and returns a one-time CODE (opaque, 30 seconds, single use, bound to the person, the admin audience and the context). The browser then submits it as a POST form to `admin.bizzux.com/sso`, never in a URL. The admin host verifies it server-side and signs the person in (own session, no shared cookie). | EXTEND existing handoff | Requirement 8 |
| 6 | Admin Center reads the signed context: preselects the company and the originating app, and shows "Back to {App}". When a task finishes it returns the person to the app with the result in the query-less POST-redirect state (a short result id, not data). | EXTEND wizard and shell | Requirements 7 and 10 |
| 7 | Attendance "Add employee" becomes a three-way choice: **Add existing user**, **Create new user** (both open the Admin Center wizard through the hand-off with intent `add-employee` and app `attendance`, then return), and **Add employee without login** (stays in Attendance, the existing form). On return with a new or existing identity, Attendance opens its employee form with the person already linked (it calls the existing `bindEmployee` path, which validates membership and licence on the server). | REUSE wizard and services, EXTEND Attendance | Requirements 5 and 6; no duplicated wizard |
| 8 | Roll the menu out to the other 7 apps in small steps, one commit each, using the sync script and a build check per app. | EXTEND | Requirement 11 |

Why hand-off instead of embedding the wizard inside each app: the apps are separate deployments on different origins; an embedded frame cannot share the Firebase session (browser storage is partitioned by origin) and copying the wizard would duplicate it eight times. The hand-off keeps one wizard and one set of services.

## 4. Secure shared sign-in (requirement 8)
- No cookies are shared across subdomains and nothing is assumed about browser sessions.
- The person is already signed in to the app (Firebase). The app asks the portal for a hand-off code using that session; the portal checks the person is an administrator of the active company (organization role from the central policy, read live).
- The code is bound to: person, audience `admin`, allowed destination, context, issue time; 30 seconds; single use (stored and consumed); audited (`admin_center.handoff`).
- It travels in a POST body to the admin host, so it never appears in a URL, browser history, server access logs or Referer headers.
- The same mechanism should replace the query-string token used when switching between apps (finding 3); that is the same change applied to `/api/app-sso` and is listed as a follow-up so the first release stays small.
- Anyone who is not a company administrator gets no menu entry, and the hand-off endpoint itself answers 403.

## 5. What each person sees
Organization role and application role are separate layers (see the RBAC design). "Attendance Admin" means the Attendance application role, not an organization role.

| | Employee | Manager | Attendance Admin | Organization Admin | Owner | Platform Admin |
|---|---|---|---|---|---|---|
| Typical roles | Org MEMBER; Attendance employee | Org MEMBER; Attendance manager (team scope) | Org MEMBER (or VIEWER) with Attendance admin | Org ADMIN | Org OWNER | Bizzux staff; not a company role |
| Entry points | Any licensed app directly | same | same | same | same | Platform portal; apps only inside an audited support session for one company |
| Attendance navigation | My attendance, My leave, My jobs | Day-to-day menu: team attendance, roster, approvals (own scope) | Everything: People, Shifts, Locations, Reports, plus the Administration group (Settings, Modes and licences) | Same as Attendance Admin (organization admins are Attendance administrators today) | Same | Not applicable |
| Profile menu | Switch Bizzux application (only apps they can open), Profile, Sign out | same | same | same + Admin Center | same + Admin Center | Support banner; Admin Center for the granted company only |
| "Administration" section in the app | Hidden | Hidden | Shown (Attendance administration only) | Shown, with Admin Center link | Shown, with Admin Center link | n/a |
| Admin Center link | Hidden; opening the URL directly is refused (403) | Hidden; refused | Hidden unless they are also an Organization Admin; refused | Visible | Visible | Via support session only |
| Add employee | Not offered | Only what Attendance already allows: Add employee without login, within their scope | Add employee without login. "Add existing user" and "Create new user" are not offered (shown as "ask your organization administrator" if they open the menu entry) | All three | All three | Through the support session only |
| Central user rights needed | none | none | none for workforce record; central creation needs `users.create` | `users.create`, `apps.assign`; cannot make or remove Admins | all, including Admin changes, billing, ownership | separate platform permission |
| Server enforcement | every API checks tenant, licence, app role | same | same; central creation refused without `users.create` | same | same | support grant checked and logged |
| Example denial | Admin Center API returns 403 | Central creation returns 403 | Central creation returns 403 | Making someone an Admin returns 403 | none | Missing or expired grant returns 403 |

## 6. Add Employee flow (central options)
1. Person with `addEmployee.central` selects Add employee, then picks one of the three options.
2. Add employee without login: the existing Attendance form, unchanged.
3. Add existing user or Create new user: Attendance requests a hand-off with context `{ app: attendance, intent: add-employee, returnTo: /people }`; Admin Center opens the wizard with the company and Attendance preselected, the sign-in method preset (Link existing, or Create new), and Attendance ticked in Apps & licences.
4. The server re-validates company, permission, licence and seats at Finish (client preselection is only a convenience).
5. Finish returns to Attendance with a result id; Attendance opens the employee form with the identity linked; saving binds them using the existing server-checked bind.
6. If any step is refused or abandoned, nothing half-made is left: the create call is already idempotent and never deletes an identity.

## 7. Standardizing across all apps
- Shared pieces: menu endpoint (portal), `BizzuxProfileMenu` (synced copy), hand-off flow, wizard (portal only), policy (already synced).
- Per app: replace its `AppSwitcher.js` with the shared menu and keep its own navigation; Attendance additionally gets the Administration entry and the three-way Add employee.
- A drift test (like `sync-authz-policy --check`) fails if any copy of the shared component differs.

## 8. Risks and dependencies
1. The menu endpoint is on the critical path of every app's header: it must be fast and cached briefly (about 30 seconds, the same revocation window the apps already use) and the apps must still render if it fails (show only Sign out and the current app).
2. Changing the app-to-app sign-in from URL tokens to POST codes touches every app's `/sso`; keep it as a separate step so the first release stays small.
3. The hand-off allow-list must include only Bizzux app origins; `returnTo` must be a path on the originating app (no open redirects).
4. Attendance currently treats Organization Admins as Attendance administrators through the legacy profile; the table above relies on that staying true until the app-role migration.
5. Seven apps plus Attendance mean eight small deployments; each needs its own build check and approval.

## 9. Decisions needed (recommendation first)
1. **Hand-off method:** POST one-time code (no tokens in any URL). The current Admin Center link uses a fragment token; this is stricter. (Recommended.)
2. **Add employee with central options:** hand off to the Admin Center wizard and return, instead of copying or embedding the wizard. (Recommended.)
3. **Shared menu delivery:** synced identical copy per app with a drift check, no new package system. (Recommended.)
4. **Attendance Admin without an organization role:** central options not offered, with an explanatory message. (Recommended.)
5. **App-to-app switching tokens:** move to the same POST-code method as a second step. (Recommended.)

## 10. Phased plan and acceptance
| Phase | Scope | Acceptance | Tests |
|---|---|---|---|
| A | `/api/shell/menu`, persona matrix | each persona gets exactly the entries in section 5; denied server calls still 403 | emulator persona tests |
| B | POST-code hand-off, admin-host `/sso` POST, context and return | code is single use, expires in 30 s, rejects other origins, token never in a URL, Back to app works | emulator and browser tests |
| C | Shared `BizzuxProfileMenu`, Attendance Administration entry | Attendance keeps its nav; employee sees no admin entries; admin sees Admin Center | browser tests per persona |
| D | Attendance three-way Add employee with return and link | identity created once, bound once, licence and permission enforced server-side | cross-app emulator test and browser |
| E | Roll the menu out to the other 7 apps | one commit and build per app; AppSwitcher variants gone | drift check, builds |
| F | App-to-app switching on POST codes | no token in any URL | tests |
Each phase ends with Implemented, Tested, then a separate deployment approval.

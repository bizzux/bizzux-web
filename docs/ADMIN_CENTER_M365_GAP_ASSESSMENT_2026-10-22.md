# Bizzux Admin Center vs Microsoft 365 Admin Center: gap assessment and plan (2026-10-22)

Status: ASSESSMENT ONLY. No redesign code has been written. Nothing here is deployed. Approval is needed before Phase 1.
Phase 0 security work (trusted-email rule, ownership fix, canonical reads, join requests) is complete and live, so nothing from Phase 0 blocks this redesign.

## 1. What the Microsoft 365 screenshots establish (reference behaviour)
- **Shell:** dark top bar (waffle, product name, search, copilot/notifications/settings/help, account), light grey left sidebar (about 230 px) with Home, Users, Copilot, Agents, Apps, Teams & groups, Marketplace, Billing, Setup, then "Customize navigation" and "Show all". Users expands inline to Active users, Contacts, Guest users, Deleted users; the child is marked with a left accent bar; parents show chevrons. Content has a breadcrumb (Home > Active users) and a large page title.
- **Active users:** a command bar (Add a user, User templates, Add multiple users, Multi-factor authentication, Delete a user, Refresh, Reset password, Export users, then Search and Change view), a filter-set row ("Commonly used" plus pill filters Licenses, Sign-in status, Domain, Location), a dense table with a header select-all checkbox, a row kebab menu and a "Choose columns" entry in the header.
- **Choose columns:** a right panel listing Display name (locked, always on), Username, Licenses (checked by default) and optional Guest, Sign-in status, Sync status, City, Country or region, Department, First name, Last name, Title, Office, State or province, Usage location. Save is disabled until something changes; Reset restores defaults.
- **Add a user:** a full-height right slide-over. Left vertical stepper (Basics, Product licenses, Optional settings, Finish) with filled dot for current and check for done. Basics: First name, Last name, Display name*, Username* @ domain, "Automatically create a password", Password with a live strength meter and message, "Require this user to change their password when they first sign in". Licenses: location*, "Assign user a product license" (with license rows and seat warning "You're out of licenses") or "Create user without product license (not recommended)" with consequence text, and a collapsible Apps (n) section. Sticky footer with Back, Next, Cancel.

## 2. What Bizzux has today (inventory)
| Area | Today | Where |
|---|---|---|
| Frame | Top horizontal tabs (Users, Teams, Apps, Roles, Organizations, Security) inside the portal | `components/AdminNav.jsx`, `AccountTabs.jsx` |
| Users page | One 1,376-line client page: join-requests panel, 4 action buttons, filter row, bulk bar, table, 6 modals | `app/(saas)/team/page.js` |
| Other pages | Teams, Apps, Roles, Organizations, Security exist as separate small pages | `app/(saas)/team/*/page.js` |
| Add user | Four separate modals: Create user (username), Invite (email/Google), Link existing, Bulk import | inside `team/page.js` |
| Table | 9 fixed columns, filters (search, sign-in type, status, app), select + bulk give/remove/disable. No sort, no pagination, no column chooser, no details drawer | `team/page.js` |
| Data | `GET /api/iam/directory` returns every member of one company in one call (about 4 reads per person) | `lib/iam/identityService.js` |
| Actions (APIs) | create, link request, app grant, org role, bind employee, reissue temp password (pending only), username reset/unlock/recovery codes/expiry/suspend, invite/resend/disable/enable/remove, set password, reset-by-email | `/api/iam/*`, `/api/admin/username-users`, `/api/team` |
| Roles | Central policy (organization role vs app role vs licence); Users table shows both with source | `lib/authz/policy.js` |
| Preferences | Only browser localStorage; no per-administrator server preference | none |

## 3. Screen-by-screen gap matrix
Legend: REUSE (as is), EXTEND (add to existing), EXTRACT (pull out of the 1,376-line page into a shared component), NEW.
| # | Microsoft pattern | Bizzux today | Gap | Decision |
|---|---|---|---|---|
| 1 | Left sidebar with expandable Users group, accent on active child, collapse to icons | Top tabs | Whole navigation model | NEW `AdminShell` + `SideNav` (config-driven) |
| 2 | Breadcrumb + page title | Page H1 only | Missing | NEW `PageHeader` |
| 3 | Command bar | Four loose buttons | Missing grouping, Export, Refresh, Reset password, Templates | NEW `CommandBar`; wire only supported actions |
| 4 | Filter set + pills | 4 dropdowns | Add organization, licence, role, department, location pills and a saved "Commonly used" set | EXTEND |
| 5 | Table with sort, select, kebab, column header menu | Static table | Sorting, pagination, sticky header, row open | EXTRACT `DataTable` from `team/page.js` |
| 6 | Choose columns panel | none | Whole feature + persistence | NEW `ColumnChooser`, NEW `/api/iam/prefs` |
| 7 | Click a row opens a details panel | Nothing opens | Whole feature | NEW `Drawer` + `UserDetails` |
| 8 | Add a user slide-over, 4-stage stepper | 4 modals | Unify into one wizard | NEW `Wizard` + `Stepper`; REUSE existing create/invite/link APIs |
| 9 | Password strength meter, auto-password, require change | Auto-password and "must change" exist in the form, no meter | Meter and reveal | EXTEND |
| 10 | Licence step with seats and consequences text | App ticks only | Seat counts per app do not exist in the data model | NEW read model (see risks) |
| 11 | Reset password drawer | Row-menu items that fire immediately; reissue for pending only | Drawer, confirmation, rules for Google accounts | NEW `ResetPasswordDrawer`; REUSE `reissue`/`resetPassword` |
| 12 | Contacts | No such record type | New data type | NEW `orgContacts` (non-login) |
| 13 | Guest users | Project collaborators live only inside Projects | No cross-app list | NEW read-only aggregate (phase 6, limited) |
| 14 | Deleted users (restore) | "Remove" HARD-DELETES (see risk 1) | Soft delete and restore | EXTEND lifecycle (membership status) |
| 15 | Export users | none | Missing | NEW `GET /api/iam/export` (CSV, same authorization as the list) |
| 16 | User templates | none | Not supported | Show as "Not available" or hide (decision below) |
| 17 | MFA status | Security page has admin MFA settings (opt-in) | Per-user status column only | EXTEND (read-only status) |

## 4. Target navigation
```
Home                               (overview: pending join requests, licences used, recent activity)
Users  v                           (expands/collapses; stays open when a child is chosen)
   Active users                    (default landing)
   Contacts
   Guest users
   Deleted users
Organizations                      (existing /organizations; multi-company switcher in the top bar)
Applications                       (existing /apps: which apps the company holds, per-app assignment)
Roles & permissions                (existing /roles, shows the 5 layers)
Licences & subscriptions           (NEW read-only view first: holdings, seats where known)
Teams                              (existing /teams)
Security                           (existing /security: password policy, MFA, session)
Settings                           (company profile, join settings)
```
Behaviour: expanded/collapsed (icon rail) state and open groups stored per administrator; the active item derives from the URL so reload and back/forward are correct; arrow keys move between items, Enter opens, Left/Right collapses/expands a group; below 768 px the sidebar becomes an overlay opened from a menu button.

## 5. Active users screen (layout)
```
[Bizzux Admin Center]  [search ........................]     [company v] [bell] [?] [RB]
+-----------+-------------------------------------------------------------------------+
| Home      | Home > Users > Active users                                             |
| Users  ^  | Active users                                                            |
|  Active*  | [+ Add a user] [Add multiple] [Reset password] [Delete] [Export] [Refresh] [Search...] |
|  Contacts | Filters: [Commonly used v] [Organization][Licence][Sign-in][Status][Role][Department][Location] |
|  Guests   | +--+--------------+----------+--------+---------+---------------+---------+---+
|  Deleted  | |[]| Display name | Username | Org    | Org role| App access    | Status  | : |
| Orgs      | |[]| Asha Owner   | asha     | Acme   | OWNER   | CRM·Admin ... | Active  | : |
| Apps      | +--+--------------+----------+--------+---------+---------------+---------+---+
| Roles     |  1-50 of 212   [< 1 2 3 >]   [Choose columns]                           |
+-----------+-------------------------------------------------------------------------+
```
Selecting rows shows a contextual command bar ("3 selected: Give access, Remove access, Disable, Reset password (one user only), Clear"). Clicking a name (not the checkbox) opens the details drawer over the right side; the list stays visible.

## 6. Choose columns
- **Panel:** right side panel with checkboxes; Display name is locked on; Save enabled only after a change; Reset to default; Cancel.
- **Catalogue (default on in bold):** **Display name**, **Username / email**, **Organization role**, **App access**, **Status**, **Last sign-in**, Sign-in method, Organization, Licence status, Created date, Job title, Department, Branch, Employee ID, Mobile.
- **Excluded on purpose:** password state details, recovery-code status, tokens, any hash or secret, IP addresses.
- **Persistence:** `users/{adminUid}.adminPrefs.activeUsers { columns, order, pageSize, filterSet }`, read and written only by `GET/PUT /api/iam/prefs` (server-validated against the catalogue, never trusting client column names). Falls back to defaults if missing.
- Search and sort operate on the visible columns plus name/username/email, so a hidden column never silently changes results.

## 7. Add a user wizard (slide-over)
Frame: right drawer about 70% width, header "Add a user", left vertical stepper, scrollable form, sticky footer (Back, Next, Cancel; "Finish adding" on the last step). The Active users page stays visible behind a dimmed overlay. Esc/Cancel asks to confirm if anything was typed.
1. **Basics.** First name, Last name, Display name* (auto-filled), Sign-in method (radio): **Bizzux username and password** (default), **Google or email invitation**, **Link an existing Bizzux user**. Username* with `name.companycode` suggestion and live availability (existing check API); for the username method: automatic password (default) or custom temporary password with strength meter, "Require password change at first sign-in" (on). For invitation: email* (never invented). For link: exact username or email, handled as a request they must accept. Organization (company switcher; administrators see only their own).
2. **Apps & licences.** Company holdings with state (active, not held), available/used seats where the data exists, tick apps to assign; "Create user without app access (not recommended)" with the consequence text ("They can sign in but can open no Bizzux application"). Apps the company does not hold are shown disabled with the reason.
3. **Optional settings.** Accordion A **Roles and permissions**: Organization role (Member default; Admin offered only to an Owner; Owner never) with info tooltips, and per-app role (Member or Admin) shown under each chosen app. Accordion B **Profile information**: Job title, Department, Branch, Office, Office phone, Mobile, Employee ID, Reporting manager, Street, City, State, Postal code, Country, Work location, and an Attendance section (shift) only when Attendance is chosen. All optional unless an existing company rule requires them. Workforce fields stay in Attendance profiles linked to the identity.
4. **Review and finish.** Summary with an Edit link per stage; password shown only as "Automatic" or "Custom"; a final server-side validation call (dry run) before create. Success screen: identity, assigned access, credentials shown once with copy, instructions to share, link "Manage this user".
Partial failures: the create call is idempotent by key (already built); an identity created without its app grants is re-run with the same key; the success screen lists exactly what succeeded and what to retry. No identity is deleted automatically.
Rules preserved: globally unique usernames, no fake emails, no merging of Google and password identities, Owner-only Admin assignment, entitlement and seat checks on the server.

## 8. Reset password drawer
Select exactly one user. Drawer shows name, username, sign-in method, last sign-in. Allowed only for Bizzux username accounts homed in this company (pending or active). For Google or email-and-password identities it shows "Managed by the person's Google / email account" with a "Send reset email" action where supported and no reset button. Options: generate secure temporary password (default) or custom, "Require change at next sign-in" (on). Confirm dialog states that the person is signed out everywhere. Success shows the password once with copy. Audit event written (exists). Server checks the organization permission `users.reset_password`, home company, never the Owner or yourself.

## 9. User details drawer
Tabs: **Overview** (name, username/email, status, last sign-in, quick actions), **Account** (sign-in method, expiry, unlock, recovery-code regeneration), **Organizations** (memberships with role and status; multi-company users show each), **Apps & licences** (effective access per app with source and app role, grant/revoke), **Roles** (organization role with source; change subject to escalation rules), **Activity** (last 20 audit events for this person, scoped to this company). Data comes from one new aggregator endpoint so the drawer opens in one round trip. Actions are shown only if the administrator holds the permission.

## 10. Contacts, Guest users, Deleted users
| View | What it is | Data | Supported behaviour |
|---|---|---|---|
| Active users | People with a Bizzux identity and an active membership | `organizationMemberships` (active) | full |
| Contacts | People with no login (suppliers, external staff) | NEW `customers/{org}/contacts` | create, edit, delete, convert to user (later) |
| Guest users | External collaborators | Projects collaborators live per project in Projects | Phase 6: read-only list pulled from Projects with a link; no cross-app write |
| Deleted users | Removed members | membership `status: removed` | restore within retention; permanent purge Platform-only |
Firebase Auth has no guest or recycle-bin concept, so these are modelled in Bizzux data, not assumed from Auth.

## 11. Shared component architecture
Location: `components/admin/` (portal). Because the apps are separate deployments, nothing is shared by package today; the Admin Center is portal-only, and the other apps keep their own shells until a shared package is approved (not part of this plan).
| Component | Purpose | Source |
|---|---|---|
| `AdminShell` | top bar, sidebar, breadcrumb slot, content frame, responsive behaviour | NEW |
| `SideNav` | config-driven tree, expand/collapse, URL-derived active state, keyboard support | NEW (config reuses `ADMIN_NAV` in `lib/adminLinks.js`) |
| `PageHeader`, `CommandBar` | title, breadcrumb, toolbar with selection-aware actions | NEW |
| `DataTable` | columns, sort, select, sticky header, pagination, empty/loading/error | EXTRACT from `team/page.js` |
| `ColumnChooser`, `FilterBar` | column panel, filter pills and saved set | NEW |
| `Drawer` | slide-over with focus trap, Esc, sticky footer | NEW |
| `Wizard`, `Stepper`, `Accordion`, `Field` (validation, info tip, strength meter) | forms | NEW |
| `ConfirmDialog`, `Toast` | consistency | NEW (replace `window.confirm`) |
| Existing modals (create, link, invite, bulk, manage roles) | kept until the wizard reaches parity, then retired | REUSE then EXTRACT logic into the wizard |
Styling: the existing Bizzux theme variables with a Fluent-like density (14 px base, 8 px grid, 1 px dividers, subtle hover) so it can switch with existing light/dark support.

## 12. API and data changes (all additive)
- `GET /api/iam/directory` gains `limit, cursor, sort, q, filters` (server-side), keeping the current response shape for the existing page.
- NEW `GET/PUT /api/iam/prefs`, `GET /api/iam/users/{uid}` (details aggregator), `POST /api/iam/identities {kind:"validate"}` (dry run), `GET /api/iam/export` (CSV, formula-injection-safe), `POST /api/iam/identities {kind:"restore"}`, contacts CRUD.
- Lifecycle change: "Remove from company" sets membership `removed` (soft) and no longer deletes the Firebase identity.
- No Firestore rules change is required (all new data is server-only).

## 13. Risks and dependencies
1. **Existing "Remove" hard-deletes the Firebase identity** (`adminAuth().deleteUser`) even if the person belongs to other companies. A company admin can therefore destroy a shared identity. Must be fixed first (membership-only removal) before a Deleted users view exists. Behaviour change for production.
2. **Seats per app do not exist** as data (only company-level `allowedUsers`, and Attendance's own licence model). "Available and consumed seats" per app needs a decision: show company seats only, or add per-app seat limits.
3. **Reads:** the directory costs about 4 reads per person per load; pagination alone does not reduce this without server-side paging and a short cache. Budget before large companies.
4. **Scale of the Users page:** the 1,376-line file is being split; regressions are likely without the existing emulator suite plus new browser tests.
5. **Cross-host sessions:** the admin host uses a hand-off session; any new route must work behind `decide()` (add entries to `ADMIN_PATHS`).
6. **Accessibility and responsive** are not currently tested at all.
7. **Dependencies:** RBAC enforcement of app roles in the other apps is separate and not required here.

## 14. Decisions needed from you (recommendation first)
1. **Seats per app:** show company seats (existing) and a read-only "apps held" licence view now; add per-app seat limits later. (Recommended.)
2. **User templates:** hide in the first release (not supported). (Recommended.)
3. **Guest users:** read-only list from Projects in phase 6. (Recommended.)
4. **Soft delete:** change "Remove" to membership-only removal and add Deleted users with restore. (Recommended; it fixes risk 1.)
5. **Look:** Fluent-like density and layout in the Bizzux colour theme and logo (not Microsoft branding). (Recommended.)

## 15. Phased plan with acceptance criteria
| Phase | Scope | Acceptance criteria | Reuse of tests |
|---|---|---|---|
| 1 Shell | `AdminShell`, `SideNav`, `PageHeader`, route map for new paths, existing pages rendered inside | sidebar expands/collapses, parent stays open when a child is chosen, active item follows URL, keyboard works, mobile overlay; old pages still work | `adminHost` tests plus new browser checks |
| 2 Active users | `DataTable`, `CommandBar`, `FilterBar`, server paging/sort/search, selection actions | sort, search, filter, paging correct on 200+ synthetic users; bulk actions authorized; reads per page measured and reported | `iamService`, `authzOrg` suites |
| 3 Columns and prefs | `ColumnChooser`, `/api/iam/prefs` | persists per administrator, reset works, cannot choose forbidden columns, other admin unaffected | new emulator test |
| 4 Add user wizard | `Drawer`, `Wizard`, validate endpoint, three sign-in methods, licences step, roles/profile step, review | no duplicate on retry, Owner-only Admin, entitlement refusal, back/next keeps values, success screen | existing create/link/idempotency tests plus new |
| 5 Details and reset | `UserDetails` drawer, `ResetPasswordDrawer`, aggregator | tabs show only permitted data; Google accounts cannot be reset; audit written; tenant isolation | `authzOrg`, reissue tests |
| 6 Lifecycle views | Contacts, Guest users (read-only), Deleted users, soft-delete change, export | removal never deletes a shared identity; restore works; export respects permissions | new |
| 7 Hardening | accessibility, responsive, dark mode, empty/error states, performance | keyboard-only pass, 375/768/1280 px checks, read budget report | browser checklist |
Each phase ends with: implemented, tested (evidence), then a separate deployment approval. One deployment per phase at most.

## 16. Reporting format to be used
`| Phase | Feature | Existing | Proposed/Changed | Test Evidence | Deployment Status |` with the status words Implemented, Tested, Deployed and Verified kept separate.

# IAM data drift: non-destructive reconciliation plan (DRY RUN, nothing applied)

Source: `_backups/iam-audit-2026-10-21` (read-only audit, 1,161 reads, ids are salted hashes `u#…` / `org#…`). No production reads were made for this plan.
Real ids and names need a targeted, read-only lookup that is NOT yet approved (estimate at the end).

## 1. Seven employees linked to a Firebase user that does not exist
`EMPLOYEE_USER_NOT_IN_AUTH`, idKind `firebase_uid`, status active, all in `org#e3f0f62a`:
`u#af918b8c`, `u#5f596ee8`, `u#e951775d`, `u#e83e5cd0`, `u#3c2dfe92`, `u#dd1c9e89`, and `u#e3f0f62a` (the company's own owner id).
(The audit counted 8; the eighth, `u#15431a7c` in `org#9f8b0dc6`, is an `att_` username login that has not been activated yet. Its Firebase user is created at first sign-in, so it is NOT drift and needs no action.)

| Item | Detail |
|---|---|
| Suspected root cause | The Firebase user was deleted (or the login was re-created with a new uid) after the employee was bound; the binding in `attEmployees.userId` kept the old uid. The person then signs in as a new uid that nothing links to, and the old binding never clears. For `u#e3f0f62a` the owner's own account (uid = company id) is gone while the company record remains. |
| Proposed action | Per person, an administrator uses the existing, audited `relinkLogin` action (Attendance, `lib/attRelink.js`): it rebinds ONLY when the old login is confirmed gone and the new login's email is verified and equal to the employee's login email. No bulk script. For the owner record: a Platform Admin decides whether the company is abandoned (see section 5) before any rebind. |
| Validation before | For each employee: confirm `userId` absent from Auth; find any Auth user with the employee's login email; confirm exactly one match and `email_verified`. |
| Validation after | Employee `userId` equals the new uid; `rebindHistory` entry written; person can sign in and sees only their own data; no duplicate employee or membership created (count of `attEmployees` and `organizationMemberships` unchanged). |
| Risks | Rebinding to the wrong person gives them someone's history: mitigated by verified-email-only rule and one-at-a-time admin action. People with no matching Auth user must sign in once first (or be re-invited). |
| Rollback | `rebindHistory` holds `from`/`to`; set `userId` back to the previous value (single-field write per employee). |

## 2. Six employees without an Attendance assignment
`EMPLOYEE_NO_ATTENDANCE_ASSIGNMENT`: `u#af918b8c`, `u#5f596ee8`, `u#e951775d`, `u#e83e5cd0`, `u#3c2dfe92`, `u#dd1c9e89` (the same six as in section 1, excluding the owner id).
- Root cause: the employees were created before app assignments were written at creation, or their login was deleted before the assignment was created. Because they are also bound to missing users, an assignment for the OLD uid would be useless.
- Action: do NOT create assignments for the old uids. After each relink (section 1), grant Attendance through the shared IAM service (`POST /api/iam/identities {kind:"apps"}`), which checks the company's licence and writes the audit event.
- Validation: `appAssignments/{org}_{uid}_bizzux-attendance` ACTIVE for the new uid and `canAccessApp` true; the company holds an ACTIVE Attendance subscription.
- Risk: seat or licence limit reached (the service refuses; nothing is half-written). Rollback: set the assignment to INACTIVE (reversible, audited).

## 3. Two assignments without a subscription
`ASSIGNMENT_NO_ACTIVE_SUBSCRIPTION` for `bizzux-attendance`: `u#48fa7464`, `u#b9e73629` in `org#e0993960`.
- Root cause: `org#e0993960` does not exist as a company (see section 4); its subscriptions were removed or never created while assignments remained.
- Action: none to the assignments until the company question in section 4 is answered. They grant nothing today because the entitlement check requires an active subscription. Proposal: mark INACTIVE only after the decision.
- Rollback: set status back to ACTIVE (stored value known from the audit).

## 4. Three memberships pointing at missing companies
`ORG_MEMBERSHIP_UNKNOWN_ORG` (all `status=active`, `role=MEMBER`): `org#e0993960` with `u#48fa7464`, `u#b9e73629`; `org#6bf0b0ba` with `u#4dea6a4c`.
- Suspected root cause: companies deleted by the closed-account purge or created by a failed provisioning, leaving canonical membership rows behind.
- Action options (decision needed from you): (a) set the three rows to `status: "removed"` (reversible, keeps history); (b) if the company records can be recovered from the 60-day recovery window, restore them instead. Recommendation: (a), after confirming with a targeted read that no `customers/{org}` doc exists and the three users have another valid company.
- Validation: after the change the users still resolve a valid company (their own or another); `/api/me` returns no error for them; directory shows no row for the missing company.
- Rollback: set `status` back to `active` (value recorded in this plan and in the journal the repair script would write).

## 5. Related findings (not in your list, same cause family)
- 13 canonical memberships with no legacy counterpart in `org#9f8b0dc6` and others (mostly `removed`/`invited`): informational; one `active` (`u#a466c2e9`) deserves a look.
- 3 users in two organizations without `multiOrg` set (`u#e48dd91b`, `u#5ee322bb`, `u#83ed9e9f`): the canonical fallback handles access, but the switcher flag is missing. Proposed: set `multiOrg: true` on each (idempotent, reversible).
- 7 orphan Auth users (no company/membership/employee): no action; may be abandoned sign-ups.

## 6. Execution rules if approved later
Order: section 4 decision, then 1, then 2, then 3, then 5. Every step is a dry run first with a printed plan, applied only after your explicit yes, writes a journal (before values), and can be reversed from the journal. Estimated cost of the lookup that resolves the hashed ids: about 60 Firestore reads (customers/{org} x3, attEmployees x7, memberships x10, assignments x8, subscriptions x3) plus about 15 Auth lookups, 0 writes. APPROVAL REQUIRED before running it.

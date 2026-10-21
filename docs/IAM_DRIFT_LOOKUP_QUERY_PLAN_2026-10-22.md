# Targeted production lookup: exact read-only query plan (NOT EXECUTED)

Purpose: turn the hashed ids in `_backups/iam-audit-2026-10-21` into real record ids for the 7 + 6 + 2 + 3 drift items. Cap: 60 Firestore document reads. Stop before exceeding it and report the actual count.

## Step 0: no extra reads needed
The audit hashes are salted. If the salt/runner config from 2026-10-21 is still available, hashes are resolved locally by re-hashing candidate ids, which costs 0 reads. Only if it is not, use the queries below.

## Queries (every one is a single-document get or a bounded query with `.limit()`)
| # | Query | Max reads | Purpose |
|---|---|---|---|
| 1 | `customers/{org}` get x 3 orgs (`org#e3f0f62a`, `org#e0993960`, `org#6bf0b0ba`) | 3 | Does the company exist; name, status |
| 2 | `customers/{e3f0f62a-org}/attEmployees` where `userId` in the 7 candidate uids, `limit(7)` | 7 | Real employee ids and login emails for item 1 |
| 3 | `organizationMemberships` where `organizationId == e0993960-org`, `limit(5)` | 5 | The 2 dangling memberships |
| 4 | `organizationMemberships` where `organizationId == 6bf0b0ba-org`, `limit(3)` | 3 | The third dangling membership |
| 5 | `appAssignments` where `organizationId == e3f0f62a-org` and `appId == bizzux-attendance`, `limit(10)` | 10 | Confirms the 6 missing Attendance assignments |
| 6 | `appAssignments` where `organizationId == e0993960-org`, `limit(5)` | 5 | The 2 assignments without a subscription |
| 7 | `organizationAppSubscriptions` get `{org}_bizzux-attendance` x 2 | 2 | Subscription state |
| 8 | `memberships/{uid}` get for the 3 users with dangling memberships | 3 | Whether they have another valid company |
Worst case total: 38 reads. Firebase Auth lookups (`getUsers` by uid, one batched call of <= 10, and `getUserByEmail` for up to 7 emails) are Auth API calls, not Firestore reads: 0 Firestore reads.

## Proof that nothing is written
- The script wraps the Admin SDK in a guard that throws on `set`, `update`, `delete`, `create`, `batch`, `runTransaction`, and `createUser/updateUser/deleteUser/setCustomUserClaims` before any call is made (the same runtime write block used by the 2026-10-21 audit runner).
- A read counter increments on every `get()`; it aborts at 55 so the cap cannot be exceeded.
- Output is a local file with ids hashed in the report and plain ids only in a local, git-ignored file; nothing is sent anywhere.
- I will print the read counter and the "writes attempted: 0" line at the end.

## Status
Plan only. Not run, because it needs production credentials and your go-ahead on this exact plan. Reply "run the lookup" to execute it.

# Migrating career-application data to the shared Firebase project

Before deploying the merged app, run this once to copy bizzux.com's existing
`careerApplications` Firestore data and resume files from the old
`bizzux-proj` Firebase project into `bizzux-apps` (the project the whole
merged codebase now runs on).

1. In the Firebase Console, open the **bizzux-proj** project → Project
   settings → Service accounts → **Generate new private key**. Save the
   downloaded JSON somewhere private (not inside this repo).
2. Create `scripts/migrate.env` (already gitignored) with:

   ```
   SOURCE_SERVICE_ACCOUNT='<paste the bizzux-proj JSON from step 1, on one line>'
   SOURCE_STORAGE_BUCKET=bizzux-proj.appspot.com
   TARGET_SERVICE_ACCOUNT='<paste the same value already in .env.local's FIREBASE_SERVICE_ACCOUNT>'
   TARGET_STORAGE_BUCKET=bizzux-apps.firebasestorage.app
   ```

3. Dry run first (writes nothing, just reports what it would do):

   ```
   node scripts/migrate-career-data.js
   ```

4. If that looks right, actually copy the data:

   ```
   node scripts/migrate-career-data.js --apply
   ```

The script skips anything that already exists in the target (safe to
re-run); pass `--overwrite` if you deliberately want to replace it.

Once you've confirmed the data is there (check the Super Admin → Career
Applications tab shows everything), you can retire the old `bizzux-proj`
Firebase project's use for this data — it's no longer read by the app.

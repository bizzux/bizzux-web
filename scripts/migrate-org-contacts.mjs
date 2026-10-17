// Migrates existing organizations to the requester / business owner / primary
// admin model. DRY RUN by default: reads only, prints the report, writes nothing.
//
//   emulator (safe):  firebase emulators:exec --only auth,firestore --project demo-bizzux "tsx scripts/migrate-org-contacts.mjs --apply"
//   production dry run:  tsx scripts/migrate-org-contacts.mjs            (reads real data; needs credentials)
//   production apply:    tsx scripts/migrate-org-contacts.mjs --apply --production-approved
//
// Applying to production additionally requires --production-approved, which
// must only be passed after the owner has approved the run. Safe to rerun:
// already-migrated organizations are skipped.
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (apply && !onEmulator && !args.has("--production-approved")) {
  console.error("Refusing to write to a non-emulator database without --production-approved.");
  process.exit(2);
}
const { migrateAll } = await import("../lib/orgContactsMigration.js");
let after = null;
const total = { apply, inspected: 0, migrated: 0, skipped: 0, needsReview: 0, failed: 0, missingAdminMapping: [], failures: [] };
for (;;) {
  const r = await migrateAll({ apply, after, limit: 200 });
  for (const k of ["inspected", "migrated", "skipped", "needsReview", "failed"]) total[k] += r[k];
  total.missingAdminMapping.push(...r.missingAdminMapping);
  total.failures.push(...r.failures);
  if (r.done) break;
  after = r.lastId;
}
console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY RUN", target: onEmulator ? "emulator" : "configured database", ...total }, null, 2));
process.exit(total.failed ? 1 : 0);

#!/usr/bin/env node
/**
 * One-time migration: copies bizzux.com's `careerApplications` Firestore
 * collection + associated resume files in Storage from the OLD Firebase
 * project ("bizzux-proj", used only for the contact form / career tool)
 * into the SAME Firebase project apps.bizzux.com already runs on
 * ("bizzux-apps") — the project the merged codebase now uses everywhere.
 *
 * Run this LOCALLY, with your own credentials for both projects — it never
 * needs to leave your machine. It defaults to a dry run (reports what it
 * would do, changes nothing); pass --apply to actually write.
 *
 * Setup — create a file called `migrate.env` next to this script (NOT
 * committed, NOT the app's own .env.local) with:
 *
 *   SOURCE_SERVICE_ACCOUNT='{...paste the full bizzux-proj service-account JSON...}'
 *   SOURCE_STORAGE_BUCKET=bizzux-proj.appspot.com
 *   TARGET_SERVICE_ACCOUNT='{...paste the full bizzux-apps service-account JSON, same as FIREBASE_SERVICE_ACCOUNT in .env.local...}'
 *   TARGET_STORAGE_BUCKET=bizzux-apps.firebasestorage.app
 *
 * Get the bizzux-proj service-account JSON from Firebase Console ->
 * bizzux-proj project -> Project settings -> Service accounts -> Generate
 * new private key (or reconstruct it from the old FIREBASE_PROJECT_ID /
 * FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY values you already have).
 *
 * Usage:
 *   node scripts/migrate-career-data.js            # dry run — report only
 *   node scripts/migrate-career-data.js --apply     # actually copy
 *
 * Safe to re-run: existing docs/files in the target are left untouched
 * (never overwritten) unless you pass --overwrite too.
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith("'") && val.endsWith("'")) ||
      (val.startsWith('"') && val.endsWith('"'))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const envFile = path.join(__dirname, "migrate.env");
const env = { ...loadEnvFile(envFile), ...process.env };

const APPLY = process.argv.includes("--apply");
const OVERWRITE = process.argv.includes("--overwrite");

function requireEnv(key) {
  const v = env[key];
  if (!v) {
    console.error(`Missing ${key}. Add it to scripts/migrate.env — see the comment at the top of this script.`);
    process.exit(1);
  }
  return v;
}

function parseServiceAccount(key) {
  const raw = requireEnv(key);
  try {
    const creds = JSON.parse(raw);
    if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    return creds;
  } catch (e) {
    console.error(`Couldn't parse ${key} as JSON: ${e.message}`);
    process.exit(1);
  }
}

async function main() {
  const sourceCreds = parseServiceAccount("SOURCE_SERVICE_ACCOUNT");
  const targetCreds = parseServiceAccount("TARGET_SERVICE_ACCOUNT");
  const sourceBucketName = requireEnv("SOURCE_STORAGE_BUCKET");
  const targetBucketName = requireEnv("TARGET_STORAGE_BUCKET");

  const sourceApp = admin.initializeApp(
    { credential: admin.credential.cert(sourceCreds), storageBucket: sourceBucketName },
    "source"
  );
  const targetApp = admin.initializeApp(
    { credential: admin.credential.cert(targetCreds), storageBucket: targetBucketName },
    "target"
  );

  const sourceDb = sourceApp.firestore();
  const targetDb = targetApp.firestore();
  const sourceBucket = sourceApp.storage().bucket();
  const targetBucket = targetApp.storage().bucket();

  console.log(`Mode: ${APPLY ? "APPLY (writing changes)" : "DRY RUN (no changes will be made — pass --apply to write)"}`);
  console.log(`Source project: ${sourceCreds.project_id}  ->  Target project: ${targetCreds.project_id}\n`);

  const snap = await sourceDb.collection("careerApplications").get();
  console.log(`Found ${snap.size} career application(s) in source.\n`);

  let copiedDocs = 0, skippedDocs = 0, copiedFiles = 0, skippedFiles = 0, failedFiles = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const targetRef = targetDb.collection("careerApplications").doc(doc.id);
    const existing = await targetRef.get();

    if (existing.exists && !OVERWRITE) {
      console.log(`SKIP  doc ${doc.id} (${data.email || "no email"}) — already exists in target. Pass --overwrite to replace.`);
      skippedDocs++;
    } else {
      console.log(`${APPLY ? "COPY " : "WOULD COPY"} doc ${doc.id} (${data.email || "no email"})`);
      if (APPLY) {
        await targetRef.set(data, { merge: false });
      }
      copiedDocs++;
    }

    if (data.resumeUrl) {
      const srcFile = sourceBucket.file(data.resumeUrl);
      const [exists] = await srcFile.exists();
      if (!exists) {
        console.log(`   ! resume file ${data.resumeUrl} not found in source bucket — skipping file copy`);
        failedFiles++;
        continue;
      }
      const dstFile = targetBucket.file(data.resumeUrl);
      const [dstExists] = await dstFile.exists();
      if (dstExists && !OVERWRITE) {
        console.log(`   SKIP resume file ${data.resumeUrl} — already exists in target`);
        skippedFiles++;
        continue;
      }
      console.log(`   ${APPLY ? "COPY " : "WOULD COPY"} resume file ${data.resumeUrl}`);
      if (APPLY) {
        try {
          const [buffer] = await srcFile.download();
          const [metadata] = await srcFile.getMetadata();
          await dstFile.save(buffer, { contentType: metadata.contentType });
          copiedFiles++;
        } catch (e) {
          console.log(`   ! failed to copy resume file ${data.resumeUrl}: ${e.message}`);
          failedFiles++;
        }
      } else {
        copiedFiles++;
      }
    }
  }

  console.log(`\nDone. Docs: ${copiedDocs} ${APPLY ? "copied" : "would copy"}, ${skippedDocs} skipped. ` +
    `Resume files: ${copiedFiles} ${APPLY ? "copied" : "would copy"}, ${skippedFiles} skipped, ${failedFiles} failed.`);
  if (!APPLY) {
    console.log("\nThis was a dry run — nothing was written. Re-run with --apply once this looks right.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

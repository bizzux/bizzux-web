// Runs as the "prebuild" step (see package.json) before every `next build`.
// Product version (MAJOR.MINOR.PATCH) lives in package.json and is bumped
// by hand when someone actually ships a release — this script only owns
// the BUILD number and release date, per the versioning scheme:
//   Version 0.4.0 | Build 23 | 19-Sep-2026
//
// The build number is a real persistent counter in Firestore
// (buildInfo/{appKey}), not derived from git history — Vercel's checkout
// is often shallow, so `git rev-list --count` isn't trustworthy as a
// stable sequential number. Only increments for an actual PRODUCTION
// build (VERCEL_ENV === "production"); a preview/local build just reads
// the current count without bumping it, so opening a PR doesn't burn
// build numbers that were never really released.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fs from "fs";

const APP_KEY = "bizzux-web";

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatDate(d) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${day}-${month}-${d.getFullYear()}`;
}

async function main() {
  const isProduction = process.env.VERCEL_ENV === "production";
  const creds = loadServiceAccount();

  let build = "dev";
  let releaseDate = formatDate(new Date());

  if (creds) {
    if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    const app = initializeApp({ credential: cert(creds) }, "bump-build-" + Date.now());
    const db = getFirestore(app);
    const ref = db.collection("buildInfo").doc(APP_KEY);

    if (isProduction) {
      const now = new Date();
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const next = (snap.exists ? Number(snap.data().build) || 0 : 0) + 1;
        tx.set(ref, { build: next, releaseDate: FieldValue.serverTimestamp() }, { merge: true });
        return next;
      });
      build = String(result);
      releaseDate = formatDate(now);
    } else {
      const snap = await ref.get();
      build = snap.exists ? String(snap.data().build || 0) : "dev";
    }
  } else {
    console.warn("[bump-build] FIREBASE_SERVICE_ACCOUNT not set — using placeholder build info");
  }

  const envContent = `NEXT_PUBLIC_BUILD_NUMBER=${build}\nNEXT_PUBLIC_RELEASE_DATE=${releaseDate}\n`;
  fs.writeFileSync(".env.production.local", envContent);
  console.log(`[bump-build] ${APP_KEY} build ${build} (${isProduction ? "production" : "non-production"}), release date ${releaseDate}`);
}

main().catch((e) => {
  // Never fail the build over version bookkeeping — worst case, the
  // version display falls back to "dev"/today's date.
  console.error("[bump-build] failed, continuing without it:", e.message);
});

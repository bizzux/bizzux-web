import { NextResponse } from "next/server";
import { APP_VERSION, BUILD_NUMBER, RELEASE_DATE } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel injects these into both the build AND the running serverless
// function (they're "System Environment Variables", not build-time-only),
// so this always reflects whichever deployment is actually serving the
// request right now — no separate build step needed to stamp a version.
// VERCEL_DEPLOYMENT_ID is the fallback for `vercel dev`/local runs where
// the git vars aren't set, and "dev" covers a plain local `next dev`.
//
// `version` here stays the deployment identifier (git SHA) — UpdateToast.tsx
// already polls this specifically to detect "a new deploy went out, offer a
// refresh" and must keep seeing a value that changes on every deploy, not a
// human-managed semver that might not change between deploys. The Bizzux
// product version/build/release-date (lib/version.js) are separate fields.
const VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  "dev";

export async function GET() {
  return NextResponse.json(
    { version: VERSION, appVersion: APP_VERSION, build: BUILD_NUMBER, releaseDate: RELEASE_DATE },
    { headers: { "Cache-Control": "no-store" } }
  );
}

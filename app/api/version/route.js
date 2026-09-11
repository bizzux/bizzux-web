import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel injects these into both the build AND the running serverless
// function (they're "System Environment Variables", not build-time-only),
// so this always reflects whichever deployment is actually serving the
// request right now — no separate build step needed to stamp a version.
// VERCEL_DEPLOYMENT_ID is the fallback for `vercel dev`/local runs where
// the git vars aren't set, and "dev" covers a plain local `next dev`.
const VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  "dev";

export async function GET() {
  return NextResponse.json(
    { version: VERSION },
    { headers: { "Cache-Control": "no-store" } }
  );
}

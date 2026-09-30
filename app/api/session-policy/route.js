import { NextResponse } from "next/server";
import { readPolicy, policyForApp } from "@/lib/sessionPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, read-only: every Bizzux app (different origins) fetches its
// timeout numbers from here — see components/SessionTimeout.jsx. Contains
// no secrets, so CORS is open. Cached briefly at the edge; a change in
// Super Admin reaches all apps within ~5 minutes (plus each tab's own
// 10-minute cache).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function GET(req) {
  const app = new URL(req.url).searchParams.get("app") || "portal";
  const policy = await readPolicy();
  return NextResponse.json(policyForApp(policy, app), {
    headers: { ...CORS, "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

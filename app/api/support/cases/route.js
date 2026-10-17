import { NextResponse } from "next/server";
import { requireUser, resolveAccount } from "@/lib/firebaseAdmin";
import { CORS_HEADERS_WRITE, corsPreflightWrite } from "@/lib/cors";
import { createCase, listMyCases, getMyCase, replyToCase, CUSTOMER_STATUS, CASE_CATEGORIES, MAX_ATTACHMENTS } from "@/lib/supportCases";
import { supportBlob } from "@/lib/supportBlob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Customer-side support cases, called from inside the Bizzux apps (Attendance
// first) with the signed-in user's Firebase ID token. Cross-origin by design
// (Bearer token, no cookies), same as /api/session-activity. See lib/supportCases.js
// for the isolation rules.
const H = { headers: { ...CORS_HEADERS_WRITE, "Cache-Control": "no-store" } };

export function OPTIONS() { return corsPreflightWrite(); }

async function me(req) {
  const user = await requireUser(req);
  const acct = await resolveAccount(user.uid);
  return { user, acct };
}

export async function GET(req) {
  try {
    const { user } = await me(req);
    const id = new URL(req.url).searchParams.get("id");
    if (id) return NextResponse.json(await getMyCase({ user, id }), H);
    return NextResponse.json({ ...(await listMyCases({ user })), statuses: CUSTOMER_STATUS, categories: CASE_CATEGORIES, maxAttachments: MAX_ATTACHMENTS }, H);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500, headers: CORS_HEADERS_WRITE });
  }
}

export async function POST(req) {
  try {
    const { user, acct } = await me(req);
    const body = await req.json();
    if (body.action === "create") return NextResponse.json({ ok: true, case: await createCase({ user, acct, body, blob: supportBlob }) }, H);
    if (body.action === "reply") return NextResponse.json(await replyToCase({ user, id: body.id, body: body.body }), H);
    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500, headers: CORS_HEADERS_WRITE });
  }
}

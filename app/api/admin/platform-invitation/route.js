import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebaseAdmin";
import { inspectInvitation, acceptInvitation } from "@/lib/platformAdminAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (e) =>
  NextResponse.json({ error: e.message || "Failed", ...(e.code ? { code: e.code } : {}) }, { status: e.status || 500 });

// Public: tells the invitation page whether a link is usable and for which
// email/role. Reveals nothing for an unknown token.
export async function GET(req) {
  try {
    const token = new URL(req.url).searchParams.get("token");
    return NextResponse.json(await inspectInvitation(token));
  } catch (e) {
    return fail(e);
  }
}

// The signed-in invitee accepts. Email match, verified email and enrolled
// two-step verification are all enforced in acceptInvitation.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const { token } = await req.json();
    return NextResponse.json({ ok: true, ...(await acceptInvitation({ c, token })) });
  } catch (e) {
    return fail(e);
  }
}

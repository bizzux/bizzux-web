import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebaseAdmin";
import { listMyLinkRequests, answerLinkRequest } from "@/lib/linkRequests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The signed-in person's own pending "join this company" requests (see lib/linkRequests.js), and their answer.
// Only ever about the caller: the request must name the caller's uid.
export async function GET(req) {
  try {
    const c = await requireUser(req);
    return NextResponse.json({ requests: await listMyLinkRequests(c.uid) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requireUser(req);
    const body = await req.json();
    return NextResponse.json(await answerLinkRequest({ uid: c.uid, id: body.id, accept: body.accept === true }));
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

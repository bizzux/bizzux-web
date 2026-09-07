import { NextResponse } from "next/server";
import { requireAccountWithAppsAccess } from "@/lib/firebaseAdmin";
import { mintDeepgramToken } from "@/lib/deepgram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    await requireAccountWithAppsAccess(req);
    // ?fresh=1 skips the server-side key cache — the client sends it when
    // retrying after a failed handshake, in case the cached key went stale.
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    const token = await mintDeepgramToken({ fresh });
    return NextResponse.json(token);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

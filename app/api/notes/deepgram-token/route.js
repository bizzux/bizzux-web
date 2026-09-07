import { NextResponse } from "next/server";
import { requireUser, resolveAccount, adminDb } from "@/lib/firebaseAdmin";
import { canAccessApps } from "@/lib/trial";
import { mintDeepgramToken } from "@/lib/deepgram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const c = await requireUser(req);
    const acct = await resolveAccount(c.uid);
    const customer = acct.isOwner
      ? acct.customer
      : (await adminDb().doc("customers/" + acct.accountId).get()).data();
    if (!canAccessApps(customer)) {
      throw { status: 402, message: "Your trial has ended. Choose a plan to keep using Bizzux apps." };
    }
    // ?fresh=1 skips the server-side key cache — the client sends it when
    // retrying after a failed handshake, in case the cached key went stale.
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    const token = await mintDeepgramToken({ fresh });
    return NextResponse.json(token);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

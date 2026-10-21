import { NextResponse } from "next/server";
import { requireUser, resolveAccount } from "@/lib/firebaseAdmin";
import { requestToJoin, listPending, myRequests, decide, setApproverPermission } from "@/lib/joinRequests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET            -> pending requests for the caller's active company (only if they may decide them), plus their own request statuses
// POST request   -> ask to join by company code (always the same answer, so codes cannot be probed)
// POST approve / reject / grant -> decisions; every rule is enforced server-side in lib/joinRequests.js
export async function GET(req) {
  try {
    const c = await requireUser(req);
    const mine = await myRequests(c.uid);
    let pending = { requests: [], canApprove: false, assignable: [] };
    try { pending = await listPending({ ...(await resolveAccount(c.uid)), uid: c.uid }); } catch { /* no company yet: nothing to approve */ }
    return NextResponse.json({ ...pending, mine });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requireUser(req);
    const b = await req.json();
    if (b.action === "request") return NextResponse.json(await requestToJoin({ actor: c, code: b.code, message: b.message }));
    const acct = { ...(await resolveAccount(c.uid)), uid: c.uid };
    const actor = { ...c, accountId: acct.accountId };
    if (b.action === "approve" || b.action === "reject") return NextResponse.json(await decide({ actor, acct, id: b.id, decision: b.action, profile: b.profile, apps: b.apps, note: b.note }));
    if (b.action === "grant" || b.action === "revoke") return NextResponse.json(await setApproverPermission({ actor, acct, userId: String(b.userId || ""), permission: b.permission, grant: b.action === "grant" }));
    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

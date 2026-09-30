import { NextResponse } from "next/server";
import { adminDb, requireUser } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-app activity for the session timeout (components/SessionTimeout.jsx).
// Each Bizzux app keeps its own sign-in, so without this, working in Notes
// for an hour would leave bizzux.com looking idle and sign you out there.
// Apps POST a heartbeat while the user is active, and GET the latest before
// signing anyone out for inactivity: you're only timed out when you've been
// idle in EVERY app. Only apps on this Firebase project can post (the
// token is verified here); Shop, on its own project, times out on its own.
// Stores nothing but a timestamp per user.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function doc(uid) {
  return adminDb().doc("sessionActivity/" + uid);
}

export async function GET(req) {
  try {
    const { uid } = await requireUser(req);
    const snap = await doc(uid).get();
    return NextResponse.json({ lastActive: snap.exists ? snap.data().lastActive || 0 : 0 }, { headers: CORS });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 401, headers: CORS });
  }
}

export async function POST(req) {
  try {
    const { uid } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    // Never trust a client clock into the future; cap at server time.
    const now = Date.now();
    const at = Math.min(now, Number(body.at) || now);
    await doc(uid).set({ lastActive: at, app: String(body.app || "").slice(0, 20), updatedAt: new Date(now) }, { merge: true });
    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 401, headers: CORS });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

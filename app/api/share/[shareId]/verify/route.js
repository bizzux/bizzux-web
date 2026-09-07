import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { verifyPassword, signGuestToken, isShareLive } from "@/lib/shareLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUBLIC — no Firebase auth. This is the front door for someone with no
// Bizzux account at all: they have a link and (separately, out of band) a
// password. Deliberately returns the same "Incorrect password, or this
// link has expired" message whether the share doesn't exist, is expired/
// revoked, or the password is simply wrong — an anonymous prober shouldn't
// be able to tell a dead link from a live one with a wrong password.
export async function POST(req, { params }) {
  try {
    const body = await req.json();
    const password = String(body.password || "");
    const snap = await adminDb().doc("shareLinks/" + params.shareId).get();
    const share = snap.exists ? snap.data() : null;

    if (!share || !isShareLive(share) || !verifyPassword(password, share.passwordHash)) {
      throw { status: 401, message: "Incorrect password, or this link has expired." };
    }

    return NextResponse.json({
      guestToken: signGuestToken(params.shareId),
      mode: share.mode,
      targetType: share.targetType,
      targetName: share.targetName,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

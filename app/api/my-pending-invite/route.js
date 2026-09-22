import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lets a signed-in user who isn't part of any organization yet (see
// NoOrganizationDashboard in app/(saas)/dashboard/page.js) discover a
// pending invite addressed to their own email WITHOUT needing to find the
// invite email first — covers the common confusion where someone signs in
// directly (e.g. via Google) before ever clicking the invite link, lands on
// the generic "create an org or check your email" screen, and has no way
// to act on the invite that's actually already waiting for them.
//
// invites/{token} docs are looked up by email (both sides already
// lowercased — see app/api/team/route.js's invite-creation lowercasing and
// requireUser()'s in lib/firebaseAdmin.js) rather than needing the token,
// which the invitee doesn't have unless they've opened the email.
export async function GET(req) {
  try {
    const c = await requireUser(req);
    const snap = await adminDb()
      .collection("invites")
      .where("email", "==", c.email)
      .where("used", "==", false)
      .get();

    const now = Date.now();
    const valid = snap.docs
      .map((d) => ({ token: d.id, ...d.data() }))
      .filter((inv) => !inv.expiresAt || inv.expiresAt.toMillis() > now)
      .sort((a, b) => (b.invitedAt?.toMillis?.() || 0) - (a.invitedAt?.toMillis?.() || 0));

    if (valid.length === 0) return NextResponse.json({ invite: null });

    const inv = valid[0];
    const orgSnap = await adminDb().doc("customers/" + inv.accountId).get();
    const org = orgSnap.data();
    const orgName = org?.organizationName || org?.companyName || "a Bizzux organization";

    return NextResponse.json({ invite: { token: inv.token, orgName } });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

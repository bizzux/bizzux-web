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
//
// When nothing is valid it also reports WHY the person ended up with no
// company (`stale`): their latest invite expired, or was already used but
// they no longer belong to that company. Without that, an invited employee
// whose link lapsed saw only "create a workspace" and had no clue to ask
// their admin to resend it.
export async function GET(req) {
  try {
    const c = await requireUser(req);
    // Invites are matched by address, which is an authorisation decision: only an address proven by Google or a verified email/password login (lib/trustedEmail.js).
    if (!c.trustedEmail) return NextResponse.json({ invite: null, stale: null });
    const snap = await adminDb().collection("invites").where("email", "==", c.trustedEmail).get();

    const now = Date.now();
    const all = snap.docs
      .map((d) => ({ token: d.id, ...d.data() }))
      .sort((a, b) => (b.invitedAt?.toMillis?.() || 0) - (a.invitedAt?.toMillis?.() || 0));
    const valid = all.filter((inv) => !inv.used && (!inv.expiresAt || inv.expiresAt.toMillis() > now));

    const orgNameOf = async (accountId) => {
      const org = (await adminDb().doc("customers/" + accountId).get()).data();
      return org?.organizationName || org?.companyName || "a Bizzux organization";
    };

    if (valid.length > 0) {
      const inv = valid[0];
      return NextResponse.json({ invite: { token: inv.token, orgName: await orgNameOf(inv.accountId) }, stale: null });
    }

    if (all.length > 0) {
      const latest = all[0];
      return NextResponse.json({
        invite: null,
        stale: { orgName: await orgNameOf(latest.accountId), reason: latest.used ? "used" : "expired" },
      });
    }

    return NextResponse.json({ invite: null, stale: null });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

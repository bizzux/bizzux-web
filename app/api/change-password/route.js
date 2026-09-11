import { NextResponse } from "next/server";
import { requireUser, resolveAccount, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clears the "must change password" flag once the person has actually set
// their own new one — called from /change-password right after the client
// SDK's own updatePassword() succeeds. Doesn't touch the password itself
// (that's the client SDK's job, since it already holds a fresh, valid
// session); this just clears the flag on whichever doc represents this
// person's own record — customers/{uid} for an account owner,
// memberships/{uid} for a team member (see resolveAccount).
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const acct = await resolveAccount(c.uid).catch(() => null);
    if (acct?.customer) {
      await adminDb().doc("customers/" + c.uid).set({ mustChangePassword: false }, { merge: true });
    } else if (acct?.membership) {
      await adminDb().doc("memberships/" + c.uid).set({ mustChangePassword: false }, { merge: true });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

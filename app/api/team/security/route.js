import { NextResponse } from "next/server";
import { requireAccountAdmin, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { DEFAULT_PASSWORD_POLICY, getPasswordPolicy } from "@/lib/passwordPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Org-level password policy, stored on customers/{accountId}.passwordPolicy
// — deliberately small (just what's realistic to enforce at Bizzux's scale:
// how the "credentials" invite path in app/api/team/route.js validates a
// password an admin sets directly for a teammate — see lib/passwordPolicy.js).
export async function GET(req) {
  try {
    const acct = await requireAccountAdmin(req);
    const policy = await getPasswordPolicy(acct.accountId);
    return NextResponse.json({ policy });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const acct = await requireAccountAdmin(req);
    const body = await req.json();
    const minLength = Math.min(64, Math.max(6, Number(body.minLength) || DEFAULT_PASSWORD_POLICY.minLength));
    const policy = {
      minLength,
      requireMixedCase: !!body.requireMixedCase,
      requireNumber: !!body.requireNumber,
    };
    await adminDb().doc("customers/" + acct.accountId).set(
      { passwordPolicy: policy, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return NextResponse.json({ ok: true, policy });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

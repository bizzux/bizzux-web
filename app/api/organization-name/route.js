import { NextResponse } from "next/server";
import { requireAccountAdmin, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { CORS_HEADERS_WRITE, corsPreflightWrite } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return corsPreflightWrite();
}

// Renames the org after onboarding — the "Getting Started" wizard
// (api/onboarding) only ever fires once, so an account that skipped it, or
// just wants to change the name later, had no way back in. Deliberately
// narrow: writes only companyName/organizationName, leaving the wizard's
// other fields (employeeCount, timezone, currency, businessType) untouched,
// unlike posting back to /api/onboarding which would reset them to
// defaults for anything not resent.
export async function POST(req) {
  try {
    const acct = await requireAccountAdmin(req);
    const body = await req.json();
    const companyName = String(body.companyName || "").trim().slice(0, 120);
    if (!companyName) throw { status: 400, message: "Company name is required" };

    await adminDb().doc("customers/" + acct.accountId).set(
      { companyName, organizationName: companyName, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return NextResponse.json({ ok: true, companyName }, { headers: CORS_HEADERS_WRITE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500, headers: CORS_HEADERS_WRITE });
  }
}

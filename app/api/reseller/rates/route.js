import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { DEFAULT_RESELLER_DISCOUNT_PERCENT, DEFAULT_RESELLER_COMMISSION_PERCENT } from "@/lib/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, read-only, no auth required — lets the Partners marketing page
// (app/(marketing)/partners) show the current live discount/commission
// percentages in its own copy instead of a number that could drift out of
// sync with whatever Super Admin has actually configured (see
// app/api/admin/resellers/route.js's "saveSettings" action). Neither value
// is sensitive on its own.
export async function GET() {
  try {
    const snap = await adminDb().doc("portalSettings/config").get();
    const data = snap.exists ? snap.data() : {};
    return NextResponse.json({
      resellerDiscountPercent: data.resellerDiscountPercent ?? DEFAULT_RESELLER_DISCOUNT_PERCENT,
      resellerCommissionPercent: data.resellerCommissionPercent ?? DEFAULT_RESELLER_COMMISSION_PERCENT,
    });
  } catch (e) {
    return NextResponse.json(
      { resellerDiscountPercent: DEFAULT_RESELLER_DISCOUNT_PERCENT, resellerCommissionPercent: DEFAULT_RESELLER_COMMISSION_PERCENT },
      { status: 200 }
    );
  }
}

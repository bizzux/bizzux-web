import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { getPricingConfig } from "@/lib/pricing";
import { computeQuote, applyDiscount } from "@/lib/pricingMath";
import { resolveCode } from "@/lib/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side price for a basket (plan, app, cycle, users), plus an optional
// offer/partner code preview. Checkout recomputes the same thing from
// scratch, so this is only ever a preview.
export async function POST(req) {
  try {
    const body = await req.json();
    const config = await getPricingConfig();
    const quote = computeQuote(config, body);
    if (!quote.ok) return NextResponse.json({ ok: false, error: quote.error }, { status: 400 });

    const code = String(body.couponCode || "").trim();
    if (!code) return NextResponse.json({ ...quote });

    if (quote.billingCycle === "year") {
      return NextResponse.json({ ...quote, coupon: { valid: false, error: "Promo codes apply to monthly billing only." } });
    }
    let c;
    try {
      c = await requireUser(req);
    } catch {
      return NextResponse.json({ ...quote, coupon: { valid: false, error: "Sign in first, then apply your code." } });
    }
    const custSnap = await adminDb().doc("customers/" + c.uid).get();
    const paymentCount = custSnap.exists ? Number(custSnap.data().paymentCount) || 0 : 0;
    const resolved = await resolveCode(code, { id: quote.planCode, appKey: quote.appKey }, { uid: c.uid, paymentCount });
    if (!resolved.valid) return NextResponse.json({ ...quote, coupon: { valid: false, error: resolved.error } });

    const discountedUnitPrice = applyDiscount(quote.unitPrice, resolved.discountType, resolved.discountValue);
    return NextResponse.json({
      ...quote,
      coupon: {
        valid: true,
        code: resolved.code,
        discountType: resolved.discountType,
        discountValue: resolved.discountValue,
        duration: resolved.duration,
        cyclesCount: resolved.cyclesCount,
        discountedUnitPrice,
        discountedTotal: discountedUnitPrice * quote.quantity,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

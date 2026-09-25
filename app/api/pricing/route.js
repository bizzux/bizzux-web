import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { getPricingConfig, publicPricing } from "@/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, read-only published pricing for the pricing page, marketplace and
// in-app upgrade screens. Everything comes from Firestore (lib/pricing.js);
// nothing here or in the UI carries a price of its own. trialDays comes
// from Platform Configuration (portalSettings/config).
export async function GET() {
  try {
    const [config, settingsSnap] = await Promise.all([
      getPricingConfig(),
      adminDb().doc("portalSettings/config").get(),
    ]);
    const trialDays = Number((settingsSnap.exists ? settingsSnap.data().trialDays : null) ?? 30) || 30;
    return NextResponse.json({ ...publicPricing(config), trialDays }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

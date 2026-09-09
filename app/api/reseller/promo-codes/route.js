import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { generatePromoCode, resolvePartnerRates } from "@/lib/referral";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

async function requireApprovedReseller(uid) {
  const snap = await adminDb().doc("resellers/" + uid).get();
  if (!snap.exists) throw { status: 404, message: "You're not registered as a Sales Partner yet." };
  const reseller = snap.data();
  if (reseller.status !== "approved") throw { status: 403, message: "Your Partner application isn't approved yet." };
  return { snap, reseller };
}

// Lists the CALLER's own one-time promo codes (see lib/referral.js's
// generatePromoCode) — separate from the legacy single persistent
// referralCode (app/api/reseller/me), which every partner still has and
// keeps working unchanged alongside these.
export async function GET(req) {
  try {
    const c = await requireUser(req);
    const { reseller } = await requireApprovedReseller(c.uid);

    const [codesSnap, commissionsSnap, payoutsSnap] = await Promise.all([
      adminDb().collection("promoCodes").where("resellerId", "==", c.uid).orderBy("createdAt", "desc").get(),
      adminDb().collection("resellerCommissions").where("resellerId", "==", c.uid).orderBy("createdAt", "desc").get(),
      adminDb().collection("resellerPayouts").where("resellerId", "==", c.uid).orderBy("createdAt", "desc").get(),
    ]);

    const codes = codesSnap.docs.map((d) => {
      const data = d.data();
      return {
        code: d.id,
        discountPercent: data.discountPercent,
        used: data.used === true,
        createdAt: toIso(data.createdAt),
        usedAt: toIso(data.usedAt),
      };
    });

    const sales = commissionsSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        promoCode: data.promoCode || null,
        saleAmount: data.saleAmount,
        commissionPercent: data.commissionPercent,
        commissionAmount: data.commissionAmount,
        status: data.status,
        createdAt: toIso(data.createdAt),
      };
    });

    const payouts = payoutsSnap.docs.map((d) => ({ id: d.id, amount: d.data().amount, createdAt: toIso(d.data().createdAt) }));

    const rates = await resolvePartnerRates(c.uid);

    return NextResponse.json({
      codes,
      codesGenerated: codes.length,
      codesUsed: codes.filter((x) => x.used).length,
      codesUnused: codes.filter((x) => !x.used).length,
      sales,
      successfulSales: sales.length,
      totalSaleAmount: sales.reduce((s, x) => s + Number(x.saleAmount || 0), 0),
      payouts,
      commissionPercent: rates.commissionPercent,
      customerDiscountPercent: rates.customerDiscountPercent,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requireUser(req);
    const body = await req.json();

    if (body.action === "generate") {
      const { reseller } = await requireApprovedReseller(c.uid);
      const rates = await resolvePartnerRates(c.uid);
      const code = await generatePromoCode({
        resellerId: c.uid,
        partnerName: reseller.businessName || reseller.fullName,
        discountPercent: rates.customerDiscountPercent,
      });

      await adminDb().doc("promoCodes/" + code).set({
        resellerId: c.uid,
        discountPercent: rates.customerDiscountPercent,
        active: true,
        used: false,
        usedAt: null,
        usedByUid: null,
        subscriptionId: null,
        createdAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({ ok: true, code, discountPercent: rates.customerDiscountPercent });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

import { NextResponse } from "next/server";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";
import { deriveVerificationSettings } from "@/lib/verification";
import { DEFAULT_RESELLER_DISCOUNT_PERCENT, DEFAULT_RESELLER_COMMISSION_PERCENT } from "@/lib/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    await requireSuperAdmin(req);
    const snap = await adminDb().doc("portalSettings/config").get();
    const data = snap.exists ? snap.data() : {};
    const trialDays = data.trialDays;
    const { verifyEmail, verifyMobile } = deriveVerificationSettings(data);
    const resellerDiscountPercent = data.resellerDiscountPercent ?? DEFAULT_RESELLER_DISCOUNT_PERCENT;
    const resellerCommissionPercent = data.resellerCommissionPercent ?? DEFAULT_RESELLER_COMMISSION_PERCENT;
    return NextResponse.json({
      trialDays: trialDays ?? 14,
      verifyEmail,
      verifyMobile,
      resellerDiscountPercent,
      resellerCommissionPercent,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

// Accepts any of these fields on its own so Trial settings and the
// verification method checkboxes can each save independently, or together.
export async function POST(req) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const update = {};

    if (body.trialDays !== undefined) {
      const n = Number(body.trialDays);
      if (!Number.isFinite(n) || n < 1) {
        throw { status: 400, message: "Trial length must be a positive number of days" };
      }
      update.trialDays = n;
    }

    if (body.verifyEmail !== undefined || body.verifyMobile !== undefined) {
      const snap = await adminDb().doc("portalSettings/config").get();
      const current = deriveVerificationSettings(snap.exists ? snap.data() : {});
      const verifyEmail = body.verifyEmail !== undefined ? !!body.verifyEmail : current.verifyEmail;
      const verifyMobile = body.verifyMobile !== undefined ? !!body.verifyMobile : current.verifyMobile;
      if (!verifyEmail && !verifyMobile) {
        throw { status: 400, message: "At least one verification method must stay enabled" };
      }
      update.verifyEmail = verifyEmail;
      update.verifyMobile = verifyMobile;
    }

    if (body.resellerDiscountPercent !== undefined) {
      const n = Number(body.resellerDiscountPercent);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        throw { status: 400, message: "Partner discount must be a percent between 1 and 100" };
      }
      update.resellerDiscountPercent = n;
    }

    if (body.resellerCommissionPercent !== undefined) {
      const n = Number(body.resellerCommissionPercent);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        throw { status: 400, message: "Partner commission must be a percent between 1 and 100" };
      }
      update.resellerCommissionPercent = n;
    }

    if (Object.keys(update).length === 0) {
      throw { status: 400, message: "Nothing to save" };
    }

    await adminDb().doc("portalSettings/config").set(update, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

// SERVER ONLY — shared code-resolution helper for the coupon field used
// both at checkout (app/api/checkout/route.js) and its preview endpoint
// (app/api/offers/validate/route.js).
//
// A code entered there can be one of two things:
//   - An admin-authored Offer (offers/{CODE}) — its own discount, set per
//     code, see app/api/admin/offers/route.js.
//   - A Partner's referral code (referralCodes/{CODE}) — every referral
//     code shares the SAME discount percentage, one number Super Admin
//     controls for all of them at once (portalSettings/config.
//     resellerDiscountPercent), rather than being configured per code.
//
// Both return the same shape here so the rest of checkout doesn't need to
// know which kind it resolved. Referral codes always resolve to a
// percent-off discount that applies once, to the customer's first payment
// only — see the "Reseller / Partner program" comment in
// app/api/checkout/route.js for why.
import { adminDb } from "./firebaseAdmin";

export const DEFAULT_RESELLER_DISCOUNT_PERCENT = 10;
export const DEFAULT_RESELLER_COMMISSION_PERCENT = 20;

// `requester` carries the two things needed to enforce the Partner-program
// guardrails, both optional so admin Offer codes (which don't need them)
// still resolve fine without a caller passing anything:
//   - uid: blocks a Partner from applying their own referral code to their
//     own account (resellers/{resellerId} IS the partner's own uid, see
//     app/api/reseller/apply/route.js, so this is a direct comparison).
//   - paymentCount: blocks a referral code on anything but a genuinely
//     first-time paid signup — an existing paying customer switching plans
//     or renewing isn't a new referral, so the discount (and the
//     commission it would trigger) shouldn't apply there.
export async function resolveCode(code, planId, requester = {}) {
  const upper = String(code || "").trim().toUpperCase();
  if (!upper) return { valid: false, error: "Missing code" };

  const offerSnap = await adminDb().doc("offers/" + upper).get();
  if (offerSnap.exists) {
    const offer = offerSnap.data();
    if (offer.active === false) return { valid: false, error: "That code isn't active anymore." };
    if (offer.planId !== planId) return { valid: false, error: "That code isn't valid for this plan." };
    if (offer.expiresAt && new Date(offer.expiresAt).getTime() < Date.now()) {
      return { valid: false, error: "That code has expired." };
    }
    if (offer.maxRedemptions && (offer.redemptionCount || 0) >= offer.maxRedemptions) {
      return { valid: false, error: "That code has already been fully redeemed." };
    }
    return {
      valid: true,
      kind: "offer",
      code: offerSnap.id,
      ref: offerSnap.ref,
      discountType: offer.discountType,
      discountValue: offer.discountValue,
      duration: offer.duration,
      cyclesCount: offer.cyclesCount || null,
      razorpayPlanId: offer.razorpayPlanId || "",
      stripePriceId: offer.stripePriceId || "",
      resellerId: null,
    };
  }

  const referralSnap = await adminDb().doc("referralCodes/" + upper).get();
  if (referralSnap.exists) {
    const referral = referralSnap.data();
    if (referral.active === false) return { valid: false, error: "That code isn't valid." };

    const resellerSnap = await adminDb().doc("resellers/" + referral.resellerId).get();
    if (!resellerSnap.exists || resellerSnap.data().status !== "approved") {
      return { valid: false, error: "That code isn't valid." };
    }

    if (requester.uid && requester.uid === referral.resellerId) {
      return { valid: false, error: "You can't use your own referral code." };
    }
    if (Number(requester.paymentCount || 0) > 0) {
      return { valid: false, error: "Referral codes only apply to your first paid plan." };
    }

    const settingsSnap = await adminDb().doc("portalSettings/config").get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    const discountPercent = Number(settings.resellerDiscountPercent ?? DEFAULT_RESELLER_DISCOUNT_PERCENT);

    return {
      valid: true,
      kind: "referral",
      code: referralSnap.id,
      ref: referralSnap.ref,
      discountType: "percent",
      discountValue: discountPercent,
      duration: "once", // first payment only — matches the one-time referral commission
      cyclesCount: null,
      razorpayPlanId: referral.razorpayPlanId || "",
      stripePriceId: referral.stripePriceId || "",
      resellerId: referral.resellerId,
    };
  }

  return { valid: false, error: "That code isn't valid." };
}

// Builds a short, shareable, on-brand referral code: always "BIZZ" followed
// by 6 random characters, retrying on collision against
// referralCodes/{CODE}. Every Partner's code reads as a Bizzux code at a
// glance (e.g. BIZZ7K3PQR) rather than being based on their own name.
export async function generateReferralCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I, avoids look-alike codes
  for (let attempt = 0; attempt < 8; attempt++) {
    let suffix = "";
    for (let i = 0; i < 6; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    const code = `BIZZ${suffix}`;
    const snap = await adminDb().doc("referralCodes/" + code).get();
    if (!snap.exists) return code;
  }
  throw { status: 500, message: "Couldn't generate a unique referral code. Please try again." };
}

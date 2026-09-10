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
// `plan` is the plan actually being purchased — {id, appKey, ...} — needed
// (rather than just its id) so an Offer scoped to "one app" or "all apps"
// can be checked against it, not just an exact single-plan match.
export async function resolveCode(code, plan, requester = {}) {
  const upper = String(code || "").trim().toUpperCase();
  if (!upper) return { valid: false, error: "Missing code" };

  const offerSnap = await adminDb().doc("offers/" + upper).get();
  if (offerSnap.exists) {
    const offer = offerSnap.data();
    if (offer.active === false) return { valid: false, error: "That code isn't active anymore." };
    // Missing `scope` (offers created before per-app pricing existed)
    // defaults to "plan" so they keep behaving exactly as before.
    const scope = offer.scope || "plan";
    if (scope === "plan" && offer.planId !== plan.id) {
      return { valid: false, error: "That code isn't valid for this plan." };
    }
    if (scope === "app" && offer.appKey !== plan.appKey) {
      return { valid: false, error: "That code isn't valid for this app." };
    }
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
      // Keyed per underlying plan id, not one shared id — an "app" or "all"
      // scoped code can be redeemed against several different-priced plans
      // (e.g. Essential vs Premium), each needing its own discounted
      // gateway plan/price. See resolveOfferForCheckout in
      // app/api/checkout/route.js for where this gets read/written.
      discountedPlans: offer.discountedPlans || {},
      resellerId: null,
    };
  }

  // One-time Sales Partner promo codes (see generatePromoCode below) — a
  // partner-branded, single-use code carrying its OWN discount percent
  // (set by admin per partner, baked in at generation time), distinct from
  // the legacy referralCodes/{CODE} below (one persistent, reusable code
  // per partner sharing one global discount). Both kinds credit the same
  // partner the same way once payment succeeds — see resolvePartnerRates.
  const promoSnap = await adminDb().doc("promoCodes/" + upper).get();
  if (promoSnap.exists) {
    const promo = promoSnap.data();
    if (promo.active === false) return { valid: false, error: "That code isn't valid." };
    if (promo.used) return { valid: false, error: "That code has already been used." };

    const resellerSnap = await adminDb().doc("resellers/" + promo.resellerId).get();
    if (!resellerSnap.exists || resellerSnap.data().status !== "approved") {
      return { valid: false, error: "That code isn't valid." };
    }
    if (requester.uid && requester.uid === promo.resellerId) {
      return { valid: false, error: "You can't use your own promo code." };
    }
    if (Number(requester.paymentCount || 0) > 0) {
      return { valid: false, error: "Promo codes only apply to your first paid plan." };
    }

    return {
      valid: true,
      kind: "promo",
      code: promoSnap.id,
      ref: promoSnap.ref,
      discountType: "percent",
      discountValue: Number(promo.discountPercent),
      duration: "once", // first payment only — matches the one-time commission
      cyclesCount: null,
      discountedPlans: promo.discountedPlans || {},
      resellerId: promo.resellerId,
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
      discountedPlans: referral.discountedPlans || {},
      resellerId: referral.resellerId,
    };
  }

  return { valid: false, error: "That code isn't valid." };
}

// Resolves the effective commission%/discount% for one Sales Partner:
// their own per-partner override (resellers/{id}.commissionPercent /
// .customerDiscountPercent) if Admin has set one, else the same global
// defaults every legacy referral code already shares. Used both when
// generating a new promo code (bakes discountPercent into the code) and
// when crediting commission on payment (webhooks) — kept as one function
// so those two can never read different numbers for the same partner.
export async function resolvePartnerRates(resellerId) {
  const [resellerSnap, settingsSnap] = await Promise.all([
    adminDb().doc("resellers/" + resellerId).get(),
    adminDb().doc("portalSettings/config").get(),
  ]);
  const reseller = resellerSnap.exists ? resellerSnap.data() : {};
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  const commissionPercent = Number(
    reseller.commissionPercent ?? settings.resellerCommissionPercent ?? DEFAULT_RESELLER_COMMISSION_PERCENT
  );
  const customerDiscountPercent = Number(
    reseller.customerDiscountPercent ?? settings.resellerDiscountPercent ?? DEFAULT_RESELLER_DISCOUNT_PERCENT
  );
  return { commissionPercent, customerDiscountPercent };
}

// Builds a one-time Sales Partner promo code: PARTNERNAME + discount% +
// "-" + a random 4-character suffix, e.g. RAJTHILAK30-AB12 — identifies
// the partner and the discount at a glance, unlike the anonymous
// BIZZ+random legacy referral code below. partnerName is sanitized down
// to A-Z only (spaces/punctuation stripped) and capped at 15 characters so
// a long business name can't produce an unreasonably long code. Retries
// on collision against promoCodes/{CODE}.
export async function generatePromoCode({ resellerId, partnerName, discountPercent }) {
  const base = String(partnerName || "PARTNER")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 15) || "PARTNER";
  const discountPart = String(Math.round(Number(discountPercent) || 0));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I, avoids look-alike codes
  for (let attempt = 0; attempt < 8; attempt++) {
    let suffix = "";
    for (let i = 0; i < 4; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    const code = `${base}${discountPart}-${suffix}`;
    const snap = await adminDb().doc("promoCodes/" + code).get();
    if (!snap.exists) return code;
  }
  throw { status: 500, message: "Couldn't generate a unique promo code. Please try again." };
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

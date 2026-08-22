"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, orderBy, doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { CTAButton } from "@/components/Section";
import { IconCheck } from "@/components/Icons";

const USD_RATE = 83; // approximate INR -> USD conversion rate; estimated only

type Plan = {
  id: string;
  name: string;
  price: number;
  strikePrice?: number | null;
  billingPeriod?: string;
  description?: string;
  features?: string[];
  popular?: boolean;
  active?: boolean;
  sortOrder?: number;
  razorpayPlanId?: string;
  stripePriceId?: string;
};

declare global {
  interface Window {
    Razorpay?: any;
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function formatPrice(priceINR: number, currency: "INR" | "USD") {
  if (currency === "INR") return `₹${priceINR.toLocaleString("en-IN")}`;
  const usd = priceINR / USD_RATE;
  return `$${usd.toFixed(usd < 10 ? 2 : 0)}`;
}

// Live version of this page's plan grid — pulls the same `plans` Firestore
// collection apps.bizzux.com's Super Admin panel manages (see
// components/SuperAdminPanel.jsx), so pricing shown here always matches
// what's configured there instead of being hand-maintained twice.
type CouponResult = { valid: boolean; discountedPrice?: number; error?: string };

type ActiveOffer = {
  code: string;
  planId: string;
  planName: string;
  discountType: "percent" | "flat";
  discountValue: number;
  duration: "forever" | "cycles" | "once";
  cyclesCount?: number | null;
};

function offerHeadline(o: ActiveOffer) {
  const amount = o.discountType === "flat" ? `₹${o.discountValue}` : `${o.discountValue}%`;
  const when =
    o.duration === "once" ? "on your first payment" : o.duration === "cycles" ? `for your first ${o.cyclesCount} billing cycle${o.cyclesCount === 1 ? "" : "s"}` : "for as long as you stay subscribed";
  return `Use code ${o.code} to get ${amount} off the ${o.planName} plan, ${when}.`;
}

// Ranks offers by actual rupee value against the plan they apply to, so
// "best" means the largest real discount rather than just whichever has
// the bigger raw number (a flat ₹300 off a ₹499 plan can easily beat a 10%
// off a ₹1999 plan). Falls back to 0 if the plan can't be found (e.g. it
// was deactivated after the offer was created).
function offerValue(o: ActiveOffer, plans: Plan[] | null) {
  const plan = plans?.find((p) => p.id === o.planId);
  const price = plan?.price ?? 0;
  return o.discountType === "flat" ? o.discountValue : (o.discountValue / 100) * price;
}

export default function PricingPlans() {
  const router = useRouter();
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [plans, setPlans] = useState<Plan[] | null>(null); // null = loading
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState<string | null>(null); // the code actually applied
  const [couponResults, setCouponResults] = useState<Record<string, CouponResult> | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [activeOffers, setActiveOffers] = useState<ActiveOffer[] | null>(null); // null = loading
  const [trialExpired, setTrialExpired] = useState(false);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null); // the plan this person is actively paying for, if any
  const [topBannerTarget, setTopBannerTarget] = useState<HTMLElement | null>(null);
  const [showOffersModal, setShowOffersModal] = useState(false);
  const refCodeRef = useRef<string | null>(null); // a Partner's ?ref= code from their share link, if any
  const refAppliedRef = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  // A Partner's share link (see app/(marketing)/partners) points here as
  // /pricing?ref=CODE. Read via window.location directly, rather than
  // Next's useSearchParams hook, so this component doesn't need a Suspense
  // boundary just for this. Prefills the same coupon box used for admin
  // Offer codes above — referral codes go through the exact same
  // apply/checkout flow, see lib/referral.js.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) {
      refCodeRef.current = ref.toUpperCase();
      setCouponInput(refCodeRef.current);
    }
  }, []);

  // The trial/offer banners below are portaled into #pricing-top-banner
  // (see app/(marketing)/pricing/page.tsx), a marker sitting right under
  // the main nav, so they appear at the very top of the page instead of
  // further down where this component itself renders. Falls back to
  // rendering inline, right here, if that marker isn't found for any
  // reason (e.g. this component gets reused somewhere without it).
  useEffect(() => {
    setTopBannerTarget(document.getElementById("pricing-top-banner"));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "plans"), orderBy("sortOrder", "asc")));
        setPlans(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Plan, "id">) }))
            .filter((p) => p.active !== false)
        );
      } catch {
        setPlans([]);
      }
    })();
  }, []);

  // Publicly lists currently-live promo codes (see app/api/offers/active) so
  // the pricing page can advertise them itself, instead of relying on a
  // visitor already knowing a code to type into the box below.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/offers/active");
        const data = await res.json();
        setActiveOffers(Array.isArray(data.offers) ? data.offers : []);
      } catch {
        setActiveOffers([]);
      }
    })();
  }, []);

  // If this person is signed in, checks two things off their own customer
  // doc: whether their free trial has run out with no plan chosen yet
  // (surfaced as a banner below), and — once they've actually paid for a
  // plan — which one, so that plan's card can show "Your current plan"
  // instead of "Choose this plan" and every trial-only message here stays
  // gone for as long as the subscription is active.
  useEffect(() => {
    if (!user) { setTrialExpired(false); setCurrentPlanId(null); return; }
    (async () => {
      try {
        const token = await user.getIdToken();
        const meRes = await fetch("/api/me", { headers: { Authorization: "Bearer " + token } });
        const me = await meRes.json();
        const snap = await getDoc(doc(db, "customers", me.accountId || user.uid));
        if (!snap.exists()) return;
        const c = snap.data() as { status?: string; trialEndDate?: any; planId?: string };
        const status = c.status || "trial";

        if (status === "active" && c.planId) {
          setCurrentPlanId(c.planId);
        } else {
          setCurrentPlanId(null);
        }

        if (status !== "trial" || !c.trialEndDate) { setTrialExpired(false); return; }
        const end = c.trialEndDate.toDate ? c.trialEndDate.toDate() : new Date(c.trialEndDate);
        setTrialExpired(end.getTime() <= Date.now());
      } catch {
        // Not signed in to a real account yet, or no customer doc — nothing to show.
      }
    })();
  }, [user]);

  // Once both a signed-in user and the plans list are ready, auto-apply a
  // referral code that arrived via ?ref= so a Partner's link works without
  // the visitor needing to also click "Apply" themselves. Only ever fires
  // once per page load.
  useEffect(() => {
    if (!refCodeRef.current || refAppliedRef.current) return;
    if (!user || !plans) return;
    refAppliedRef.current = true;
    applyCoupon(refCodeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, plans]);

  // Checks a promo code against every visible plan at once (there are only
  // ever a handful) since a code is scoped to one specific plan — see
  // app/api/admin/offers/route.js — but this page doesn't know in advance
  // which plan the person will pick. Whichever plan(s) it's valid for get
  // a discounted-price preview on their card; checkout re-validates the
  // code from scratch server-side regardless, so this preview is purely UX.
  async function applyCoupon(codeOverride?: string) {
    const code = (codeOverride ?? couponInput).trim();
    if (!code || !plans) return;
    setCouponInput(code);
    if (!user) {
      setCouponMsg("Sign in first, then apply your code.");
      return;
    }
    setCouponChecking(true);
    setCouponMsg(null);
    try {
      const token = await user.getIdToken();
      const results = await Promise.all(
        plans.map(async (p) => {
          const res = await fetch("/api/offers/validate", {
            method: "POST",
            headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
            body: JSON.stringify({ code, planId: p.id }),
          });
          const data = await res.json();
          return [p.id, data] as const;
        })
      );
      const map: Record<string, CouponResult> = {};
      let anyValid = false;
      let firstError = "That code isn't valid.";
      for (const [planId, data] of results) {
        map[planId] = data;
        if (data.valid) anyValid = true;
        else if (data.error) firstError = data.error;
      }
      setCouponResults(map);
      setCouponCode(anyValid ? code.toUpperCase() : null);
      setCouponMsg(anyValid ? null : firstError);
    } catch {
      setCouponMsg("Couldn't check that code right now. Please try again.");
    }
    setCouponChecking(false);
  }

  // Starts a real recurring-subscription checkout: INR plans go through
  // Razorpay Checkout.js (opened inline, right here), USD plans redirect to
  // a hosted Stripe Checkout page. Both hit the same /api/checkout route,
  // which picks the gateway based on the `gateway` param below. See
  // app/api/checkout/route.js for the server side of this.
  async function choosePlan(planId: string) {
    if (!user) {
      router.push("/sign-in?mode=signup");
      return;
    }
    setCheckoutError(null);
    setPickingId(planId);
    const gateway = currency === "INR" ? "razorpay" : "stripe";
    try {
      const token = await user.getIdToken();
      const appliesHere = couponCode && couponResults?.[planId]?.valid;
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ planId, gateway, couponCode: appliesHere ? couponCode : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start checkout. Please try again.");

      if (data.gateway === "stripe") {
        window.location.href = data.url;
        return;
      }

      // Razorpay: open Checkout.js inline instead of redirecting away.
      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) {
        throw new Error("Couldn't load Razorpay checkout. Please check your connection and try again.");
      }

      const rzp = new window.Razorpay({
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: "Bizzux",
        description: data.planName ? `${data.planName} plan subscription` : "Subscription",
        theme: { color: "#12a695" },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_subscription_id: string;
          razorpay_signature: string;
        }) => {
          try {
            await fetch("/api/checkout/verify", {
              method: "POST",
              headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
              body: JSON.stringify(response),
            });
          } finally {
            router.push("/dashboard?checkout=success");
          }
        },
        modal: {
          ondismiss: () => setPickingId(null),
        },
      });
      rzp.on("payment.failed", () => {
        setCheckoutError("Payment failed. Please try again or use a different card.");
        setPickingId(null);
      });
      rzp.open();
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : "Couldn't start checkout. Please try again.");
      setPickingId(null);
    }
  }

  if (plans === null) {
    return <p className="text-center text-slate-400">Loading plans…</p>;
  }

  if (plans.length === 0) {
    return (
      <p className="text-center text-slate-400">
        We&apos;re putting the finishing touches on pricing. <a href="/contact" className="text-brand-blue font-semibold hover:underline">Contact us</a> in the meantime.
      </p>
    );
  }

  // When there are multiple live offers, only the single best-value one
  // (by actual rupee savings, see offerValue() above) gets the prominent
  // banner treatment — the rest are one click away via "more offers
  // available", instead of stacking every code as its own banner.
  const bestOffer =
    activeOffers && activeOffers.length > 0
      ? [...activeOffers].sort((a, b) => offerValue(b, plans) - offerValue(a, plans))[0]
      : null;

  const topBannerContent =
    trialExpired || bestOffer ? (
      <div className="max-w-5xl mx-auto px-6 pt-3 space-y-2">
        {trialExpired && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-center">
            <p className="text-red-700 font-semibold text-sm">
              Your free trial has ended. Choose a plan below to keep using Bizzux without any interruption.
            </p>
          </div>
        )}
        {bestOffer && (
          <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl bg-brand-gradient-soft border border-brand-teal/20 px-5 py-3 text-center">
            <span className="text-sm text-ink">
              🎉 <span className="font-semibold">{offerHeadline(bestOffer)}</span>
            </span>
            <button
              onClick={() => applyCoupon(bestOffer.code)}
              disabled={couponChecking}
              className="rounded-full bg-brand-gradient text-white text-xs font-bold px-4 py-1.5 whitespace-nowrap disabled:opacity-60"
            >
              Use this code
            </button>
            {activeOffers && activeOffers.length > 1 && (
              <button
                onClick={() => setShowOffersModal(true)}
                className="text-xs font-semibold text-brand-blue hover:underline whitespace-nowrap"
              >
                +{activeOffers.length - 1} more offer{activeOffers.length - 1 === 1 ? "" : "s"} available
              </button>
            )}
          </div>
        )}
      </div>
    ) : null;

  return (
    <div>
      {topBannerContent && (topBannerTarget ? createPortal(topBannerContent, topBannerTarget) : topBannerContent)}

      <div className="flex justify-center mb-4">
        <div className="inline-flex rounded-full border border-slate-200 p-1 bg-white">
          {(["INR", "USD"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
                currency === c ? "bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white" : "text-slate-600 hover:text-ink"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 mb-10">
        <div className="flex flex-wrap items-center justify-center gap-3 w-full max-w-md">
          <div className="relative flex-1 min-w-[180px]">
            <input
              type="text"
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
              placeholder="Have a promo code?"
              className="w-full rounded-full border border-slate-200 pl-5 pr-10 py-3 text-sm focus:outline-none focus:border-brand-blue"
            />
            {(couponInput || couponCode) && (
              <button
                type="button"
                onClick={() => {
                  setCouponInput("");
                  setCouponCode(null);
                  setCouponResults(null);
                  setCouponMsg(null);
                }}
                aria-label="Clear promo code"
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                ×
              </button>
            )}
          </div>
          <button
            onClick={() => applyCoupon()}
            disabled={couponChecking || !couponInput.trim()}
            className="h-10 rounded-full border border-slate-200 px-6 text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            {couponChecking ? "Checking…" : "Apply"}
          </button>
          {activeOffers && activeOffers.length > 0 && (
            <button
              type="button"
              onClick={() => setShowOffersModal(true)}
              className="text-xs font-semibold text-brand-blue hover:underline whitespace-nowrap"
            >
              Check available offers
            </button>
          )}
        </div>
        {couponCode && !couponMsg && (
          <p className="text-xs text-brand-teal font-semibold">Code "{couponCode}" applied, discount shown below.</p>
        )}
        {couponMsg && <p className="text-xs text-red-600">{couponMsg}</p>}
      </div>

      {showOffersModal && activeOffers && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
          onClick={() => setShowOffersModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Available offers</h3>
              <button
                onClick={() => setShowOffersModal(false)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="space-y-3">
              {activeOffers.map((o) => (
                <button
                  key={o.code}
                  onClick={() => {
                    applyCoupon(o.code);
                    setShowOffersModal(false);
                  }}
                  className="w-full text-left rounded-xl border border-slate-200 hover:border-brand-blue hover:bg-brand-gradient-soft transition-colors p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-brand-blue">{o.code}</span>
                    <span className="text-xs font-semibold text-white bg-brand-gradient rounded-full px-3 py-1 whitespace-nowrap">
                      Apply
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mt-1">{offerHeadline(o)}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6 items-start">
        {plans.map((p) => (
          <div
            key={p.id}
            className={`rounded-2xl p-8 border relative ${
              p.popular ? "border-brand-blue shadow-lg scale-[1.02] bg-white" : "border-slate-100 bg-white shadow-sm"
            }`}
          >
            {p.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white text-xs font-semibold px-4 py-1">
                Most popular
              </div>
            )}
            <h3 className="font-semibold text-lg mb-1">{p.name}</h3>
            {couponResults?.[p.id]?.valid ? (
              <div className="mb-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-[#FF4D00] line-through decoration-2">{formatPrice(p.price, currency)}</span>
                  <span className="text-3xl font-extrabold text-brand-teal">
                    {formatPrice(couponResults[p.id].discountedPrice ?? p.price, currency)}
                  </span>
                  <span className="text-slate-500 text-sm">/{p.billingPeriod || "month"}</span>
                </div>
                <span className="inline-block mt-1 text-xs font-semibold text-brand-teal">Promo code applied</span>
              </div>
            ) : p.strikePrice && p.strikePrice > p.price ? (
              <div className="mb-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-[#FF4D00] line-through decoration-2">{formatPrice(p.strikePrice, currency)}</span>
                  <span className="text-3xl font-extrabold">{formatPrice(p.price, currency)}</span>
                  <span className="text-slate-500 text-sm">/{p.billingPeriod || "month"}</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="inline-block rounded-full bg-brand-gradient text-white text-[11px] font-bold px-3 py-1 tracking-wide uppercase">
                    ⚡ Limited offer
                  </span>
                  <span className="text-xs font-semibold text-[#FF4D00]">
                    Save {formatPrice(p.strikePrice - p.price, currency)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-3xl font-extrabold">{formatPrice(p.price, currency)}</span>
                <span className="text-slate-500 text-sm">/{p.billingPeriod || "month"}</span>
              </div>
            )}
            {p.description && <p className="text-sm text-slate-600 mb-6">{p.description}</p>}
            {Array.isArray(p.features) && p.features.length > 0 && (
              <ul className="space-y-3 mb-8">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                    <IconCheck className="w-4 h-4 mt-0.5 text-brand-teal shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}
            {currentPlanId === p.id ? (
              <div
                className="w-full h-10 flex items-center justify-center gap-2 rounded-full text-sm font-semibold px-5 bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white cursor-default select-none"
                aria-current="true"
              >
                <IconCheck className="w-4 h-4" />
                Your current plan
              </div>
            ) : (
              <button
                onClick={() => choosePlan(p.id)}
                disabled={pickingId === p.id}
                className={`w-full h-10 text-center rounded-full text-sm font-semibold px-5 transition-opacity disabled:opacity-60 ${
                  p.popular
                    ? "bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white hover:opacity-90"
                    : "border border-slate-200 text-ink hover:bg-slate-50"
                }`}
              >
                {pickingId === p.id ? "Selecting…" : user ? "Choose this plan" : "Start free trial"}
              </button>
            )}
          </div>
        ))}
      </div>

      {checkoutError && (
        <p className="text-center text-sm text-red-600 mt-6">{checkoutError}</p>
      )}

      {currency === "USD" && (
        <p className="text-center text-xs text-slate-400 mt-6">
          USD prices are estimated and may change based on exchange-rate movement. Indian customers are charged in INR by default.
        </p>
      )}

      <p className="text-center text-sm text-slate-500 mt-8">
        Prefer to talk it through first?{" "}
        <CTAButton href="/contact" variant="secondary">Request a demo</CTAButton>
      </p>
    </div>
  );
}

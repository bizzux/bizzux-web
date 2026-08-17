"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { CTAButton } from "@/components/Section";
import { IconCheck } from "@/components/Icons";

const USD_RATE = 83; // approximate INR -> USD conversion rate; estimated only

type Plan = {
  id: string;
  name: string;
  price: number;
  billingPeriod?: string;
  description?: string;
  features?: string[];
  popular?: boolean;
  active?: boolean;
  sortOrder?: number;
};

function formatPrice(priceINR: number, currency: "INR" | "USD") {
  if (currency === "INR") return `₹${priceINR.toLocaleString("en-IN")}`;
  const usd = priceINR / USD_RATE;
  return `$${usd.toFixed(usd < 10 ? 2 : 0)}`;
}

// Live version of this page's plan grid — pulls the same `plans` Firestore
// collection apps.bizzux.com's Super Admin panel manages (see
// components/SuperAdminPanel.jsx), so pricing shown here always matches
// what's configured there instead of being hand-maintained twice.
export default function PricingPlans() {
  const router = useRouter();
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [plans, setPlans] = useState<Plan[] | null>(null); // null = loading
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [pickingId, setPickingId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
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

  async function choosePlan(planId: string) {
    if (!user) {
      router.push("/sign-in?mode=signup");
      return;
    }
    setPickingId(planId);
    try {
      const token = await user.getIdToken();
      await fetch("/api/select-plan", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      router.push("/dashboard");
    } catch {
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

  return (
    <div>
      <div className="flex justify-center mb-12">
        <div className="inline-flex rounded-full border border-slate-200 p-1 bg-white">
          {(["INR", "USD"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
                currency === c ? "bg-gradient-to-r from-brand-teal to-brand-blue text-white" : "text-slate-600 hover:text-ink"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6 items-start">
        {plans.map((p) => (
          <div
            key={p.id}
            className={`rounded-2xl p-8 border relative ${
              p.popular ? "border-brand-blue shadow-lg scale-[1.02] bg-white" : "border-slate-100 bg-white shadow-sm"
            }`}
          >
            {p.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-teal to-brand-blue text-white text-xs font-semibold px-4 py-1">
                Most popular
              </div>
            )}
            <h3 className="font-semibold text-lg mb-1">{p.name}</h3>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="text-3xl font-extrabold">{formatPrice(p.price, currency)}</span>
              <span className="text-slate-500 text-sm">/{p.billingPeriod || "month"}</span>
            </div>
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
            <button
              onClick={() => choosePlan(p.id)}
              disabled={pickingId === p.id}
              className={`w-full text-center rounded-full text-sm font-semibold px-5 py-3 transition-opacity disabled:opacity-60 ${
                p.popular
                  ? "bg-gradient-to-r from-brand-teal to-brand-blue text-white hover:opacity-90"
                  : "border border-slate-200 text-ink hover:bg-slate-50"
              }`}
            >
              {pickingId === p.id ? "Selecting…" : user ? "Choose this plan" : "Start free trial"}
            </button>
          </div>
        ))}
      </div>

      {currency === "USD" && (
        <p className="text-center text-xs text-slate-400 mt-6">
          USD prices are estimated and may change based on exchange-rate movement. Indian customers are charged in INR by default.
        </p>
      )}

      <p className="text-center text-sm text-slate-500 mt-10">
        Prefer to talk it through first?{" "}
        <CTAButton href="/contact" variant="secondary">Request a demo</CTAButton>
      </p>
    </div>
  );
}

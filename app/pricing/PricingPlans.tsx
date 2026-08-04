"use client";

import { useState } from "react";
import { CTAButton } from "@/components/Section";
import { IconCheck } from "@/components/Icons";

const USD_RATE = 83; // approximate INR -> USD conversion rate; estimated only

const plans = [
  {
    name: "Starter",
    priceINR: 999,
    desc: "For businesses starting with sales and a digital menu.",
    features: ["Sales and payment tracking", "Digital menu", "Basic reports", "Owner and shopkeeper access"],
    highlight: false,
  },
  {
    name: "Growth",
    priceINR: 1499,
    desc: "For complete day-to-day business management.",
    features: ["Self-ordering and online payment", "Purchases and inventory", "Expenses, profit and analytics", "Customers, vendors and backup"],
    highlight: true,
  },
  {
    name: "Multi-Shop",
    priceINR: 2499,
    desc: "For owners managing multiple branches.",
    features: ["Everything in Growth", "Multiple shops", "Branch-wise business visibility", "Priority support"],
    highlight: false,
  },
];

function formatPrice(priceINR: number, currency: "INR" | "USD") {
  if (currency === "INR") return `₹${priceINR.toLocaleString("en-IN")}`;
  const usd = priceINR / USD_RATE;
  return `$${usd.toFixed(usd < 10 ? 2 : 0)}`;
}

export default function PricingPlans() {
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");

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
            key={p.name}
            className={`rounded-2xl p-8 border relative ${
              p.highlight ? "border-brand-blue shadow-lg scale-[1.02] bg-white" : "border-slate-100 bg-white shadow-sm"
            }`}
          >
            {p.highlight && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-teal to-brand-blue text-white text-xs font-semibold px-4 py-1">
                Most popular
              </div>
            )}
            <h3 className="font-semibold text-lg mb-1">{p.name}</h3>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="text-3xl font-extrabold">{formatPrice(p.priceINR, currency)}</span>
              <span className="text-slate-500 text-sm">/month</span>
            </div>
            <p className="text-sm text-slate-600 mb-6">{p.desc}</p>
            <ul className="space-y-3 mb-8">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                  <IconCheck className="w-4 h-4 mt-0.5 text-brand-teal shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <CTAButton href="/contact" variant={p.highlight ? "primary" : "secondary"}>
              Request a demo
            </CTAButton>
          </div>
        ))}
      </div>

      {currency === "USD" && (
        <p className="text-center text-xs text-slate-400 mt-6">
          USD prices are estimated and may change based on exchange-rate movement. Indian customers are charged in INR by default.
        </p>
      )}
    </div>
  );
}

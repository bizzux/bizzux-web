import { Container, Eyebrow, CTAButton } from "@/components/Section";
import { IconCheck } from "@/components/Icons";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Bizzux",
  description: "Simple plans that grow with your business. Starter, Growth and Multi-Shop plans from Bizzux.",
};

const plans = [
  {
    name: "Starter",
    price: "₹999",
    period: "/month",
    desc: "For businesses starting with sales and a digital menu.",
    features: ["Sales and payment tracking", "Digital menu", "Basic reports", "Owner and shopkeeper access"],
    highlight: false,
  },
  {
    name: "Growth",
    price: "₹1,499",
    period: "/month",
    desc: "For complete day-to-day business management.",
    features: ["Self-ordering and online payment", "Purchases and inventory", "Expenses, profit and analytics", "Customers, vendors and backup"],
    highlight: true,
  },
  {
    name: "Multi-Shop",
    price: "₹2,499",
    period: "/month",
    desc: "For owners managing multiple branches.",
    features: ["Everything in Growth", "Multiple shops", "Branch-wise business visibility", "Priority support"],
    highlight: false,
  },
];

export default function PricingPage() {
  return (
    <>
      <section className="pt-20 pb-16 text-center bg-gradient-to-b from-teal-50/60 to-white">
        <Container>
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6">
            Simple plans that grow with your business.
          </h1>
        </Container>
      </section>

      <section className="py-16 border-t border-slate-100">
        <Container>
          <div className="grid md:grid-cols-3 gap-6 items-start">
            {plans.map((p) => (
              <div
                key={p.name}
                className={`rounded-2xl p-8 border ${
                  p.highlight
                    ? "border-brand-blue shadow-lg scale-[1.02] bg-white relative"
                    : "border-slate-100 bg-white shadow-sm"
                }`}
              >
                {p.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-teal to-brand-blue text-white text-xs font-semibold px-4 py-1">
                    Most popular
                  </div>
                )}
                <h3 className="font-semibold text-lg mb-1">{p.name}</h3>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-3xl font-extrabold">{p.price}</span>
                  <span className="text-slate-500 text-sm">{p.period}</span>
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
          <div className="mt-12 text-center text-sm text-slate-500 space-y-1 max-w-xl mx-auto">
            <p>Annual plans available. Setup starts from ₹5,000 based on menu, data and training needs.</p>
            <p>Customer-specific domains, payment-gateway charges and custom development are quoted separately.</p>
          </div>
        </Container>
      </section>
    </>
  );
}

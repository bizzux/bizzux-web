import Link from "next/link";
import { Container } from "@/components/Section";
import PricingPlans from "./PricingPlans";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing | Bizzux",
  description: "Simple plans that grow with your business. Starter, Growth and Multi-Shop plans from Bizzux.",
};

export default function PricingPage() {
  return (
    <>
      {/* PricingPlans portals its trial/offer banners in here — see
          #pricing-top-banner in PricingPlans.tsx — so they render right
          below the main nav instead of further down the page. */}
      <div id="pricing-top-banner" />

      <section className="pt-8 pb-5 md:pt-10 md:pb-6 text-center bg-gradient-to-b from-teal-50/60 to-white">
        <Container>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-0">
            Simple plans that grow with your business.
          </h1>
        </Container>
      </section>

      <section className="pt-2 pb-12 border-t border-slate-100">
        <Container>
          <PricingPlans />
          <div className="mt-10 text-center text-sm text-slate-500 space-y-1 max-w-xl mx-auto">
            <p>Annual plans available. Setup starts from ₹5,000 based on menu, data and training needs.</p>
            <p>Customer-specific domains, payment-gateway charges and custom development are quoted separately.</p>
          </div>
        </Container>
      </section>

      <section className="py-12 pb-24 bg-slate-50 text-center">
        <Container className="max-w-xl">
          <h2 className="text-xl font-bold mb-3">Looking for professional email?</h2>
          <p className="text-slate-600 mb-6">
            Professional email and productivity plan pricing is India-specific and shown separately in INR.
          </p>
          <Link href="/custom-solutions" className="text-brand-blue font-semibold hover:underline">
            See professional email pricing →
          </Link>
        </Container>
      </section>
    </>
  );
}

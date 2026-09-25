import Link from "next/link";
import { Container } from "@/components/Section";
import PricingPlans from "./PricingPlans";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing | Bizzux",
  description: "Simple per-user pricing: pick one Bizzux App, or get the complete Bizzux Suite of business apps. Monthly or annual billing.",
};

export default function PricingPage() {
  return (
    <>
      <section className="pt-8 pb-5 md:pt-10 md:pb-6 text-center bg-gradient-to-b from-teal-50/60 to-white">
        <Container>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-0">
            One app or the whole suite. Simple per-user pricing.
          </h1>
        </Container>
      </section>

      <section className="pt-2 pb-12 border-t border-slate-100">
        <Container>
          <PricingPlans />
          <div className="mt-10 text-center text-sm text-slate-500 space-y-1 max-w-xl mx-auto">
            <p>Optional onboarding and setup (menu, data import, training) is quoted separately based on your needs.</p>
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

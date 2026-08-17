import Link from "next/link";
import { Container, Eyebrow } from "@/components/Section";
import PricingPlans from "./PricingPlans";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Bizzux",
  description: "Simple plans that grow with your business. Starter, Growth and Multi-Shop plans from Bizzux.",
};

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
          <PricingPlans />
          <div className="mt-12 text-center text-sm text-slate-500 space-y-1 max-w-xl mx-auto">
            <p>Annual plans available. Setup starts from ₹5,000 based on menu, data and training needs.</p>
            <p>Customer-specific domains, payment-gateway charges and custom development are quoted separately.</p>
          </div>
        </Container>
      </section>

      <section className="py-16 bg-slate-50 text-center">
        <Container className="max-w-xl">
          <h2 className="text-xl font-bold mb-3">Looking for professional email and Microsoft 365?</h2>
          <p className="text-slate-600 mb-6">
            Microsoft 365 pricing is India-specific and shown separately in INR.
          </p>
          <Link href="/microsoft-365" className="text-brand-blue font-semibold hover:underline">
            See Microsoft 365 pricing →
          </Link>
        </Container>
      </section>
    </>
  );
}

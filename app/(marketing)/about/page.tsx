import Image from "next/image";
import { Container, Eyebrow, CTAButton } from "@/components/Section";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About | Bizzux",
  description: "We build cloud and AI-enabled solutions for growing businesses.",
};

const beliefs = [
  "Technology should simplify work, not add complexity.",
  "Small businesses deserve professional digital tools.",
  "AI should solve real problems and improve decisions.",
  "Security, ownership and scalability should be built in from the beginning.",
];

export default function AboutPage() {
  return (
    <>
      <section className="pt-14 pb-14 bg-navy text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30" style={{
          background: "radial-gradient(60% 60% at 50% 0%, rgba(18,166,149,0.3) 0%, transparent 70%)"
        }} />
        <Container className="relative text-center max-w-3xl">
          <Eyebrow light>About Bizzux</Eyebrow>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-6">
            We build cloud and AI-enabled solutions for growing businesses.
          </h1>
          <p className="text-lg text-slate-300 mb-4">
            Bizzux is a cloud software and AI solutions company focused on helping businesses run better today
            and build for tomorrow.
          </p>
          <p className="text-slate-400">
            We offer a ready-to-use business management platform for sales, inventory, expenses and profit. We
            also design custom software, AI-enabled applications, e-commerce websites and secure cloud solutions
            for businesses with unique requirements.
          </p>
          <div className="mt-8 flex justify-center">
            <Image src="/logo-transparent.png" alt="Bizzux" width={200} height={82} className="h-12 w-auto" />
          </div>
        </Container>
      </section>

      <section className="py-14 border-b border-slate-100">
        <Container className="text-center max-w-xl">
          <h2 className="text-2xl font-bold mb-4">Our approach is simple</h2>
          <p className="text-xl font-semibold bg-gradient-to-r from-brand-tealDark via-brand-cyanDark to-brand-blueDark bg-clip-text text-transparent">
            Understand the business. Build the right solution. Make growth visible.
          </p>
        </Container>
      </section>

      <section className="py-14 bg-slate-50">
        <Container>
          <h2 className="text-2xl font-bold mb-8 text-center">What we believe</h2>
          <div className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {beliefs.map((b) => (
              <div key={b} className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <p className="text-slate-700">{b}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-14 pb-24 text-center">
        <Container>
          <h2 className="text-2xl font-bold mb-6">Want to see it for your business?</h2>
          <CTAButton href="/contact">Book a demo</CTAButton>
        </Container>
      </section>
    </>
  );
}

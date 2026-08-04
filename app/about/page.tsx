import Image from "next/image";
import { Container, Eyebrow, CTAButton } from "@/components/Section";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — Bizzux",
  description: "Bizzux exists to help small-business owners move from guesswork to clarity.",
};

export default function AboutPage() {
  return (
    <>
      <section className="pt-20 pb-24 bg-navy text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30" style={{
          background: "radial-gradient(60% 60% at 50% 0%, rgba(20,184,166,0.3) 0%, transparent 70%)"
        }} />
        <Container className="relative text-center max-w-3xl">
          <Eyebrow light>About Bizzux</Eyebrow>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-8">
            Built to make local businesses more visible.
          </h1>
          <p className="text-lg text-slate-300 mb-4">
            Bizzux exists to help small-business owners move from guesswork to clarity.
          </p>
          <p className="text-slate-400">
            We believe every owner should be able to see their sales, stock, expenses and profit without
            complicated software or manual records.
          </p>
          <div className="mt-12 flex justify-center">
            <Image src="/logo-transparent.png" alt="Bizzux" width={200} height={82} className="h-12 w-auto" />
          </div>
          <p className="mt-6 text-2xl font-semibold bg-gradient-to-r from-brand-teal via-brand-cyan to-brand-blue bg-clip-text text-transparent">
            Bizzux — Business made visible.
          </p>
        </Container>
      </section>

      <section className="py-20 text-center">
        <Container>
          <h2 className="text-2xl font-bold mb-6">Want to see it for your business?</h2>
          <CTAButton href="/contact">Book a demo</CTAButton>
        </Container>
      </section>
    </>
  );
}

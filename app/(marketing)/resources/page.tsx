import { Container, Eyebrow, CTAButton } from "@/components/Section";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resources | Bizzux",
  description: "Guides and updates from Bizzux, coming soon.",
};

export default function ResourcesPage() {
  return (
    <section className="py-24 text-center">
      <Container className="max-w-xl">
        <Eyebrow>Resources</Eyebrow>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">Guides and resources are on the way.</h1>
        <p className="text-slate-600 mb-8">
          We&apos;re putting together how-to guides on running your shop with Bizzux. In the meantime, book a demo
          and we&apos;ll walk you through it directly.
        </p>
        <CTAButton href="/contact">Book a demo</CTAButton>
      </Container>
    </section>
  );
}

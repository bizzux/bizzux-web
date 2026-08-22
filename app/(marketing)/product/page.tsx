import { Container, Eyebrow, CTAButton } from "@/components/Section";
import { IconPOS, IconWallet, IconBox, IconChart } from "@/components/Icons";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Product | Bizzux",
  description: "From sale to insight, automatically. See how Bizzux connects every part of your daily business.",
};

const steps = [
  { icon: IconPOS, title: "Record a sale", desc: "Counter sale or customer self-order." },
  { icon: IconWallet, title: "Capture payment", desc: "Cash, UPI QR or online payment." },
  { icon: IconBox, title: "Update operations", desc: "Record purchases, expenses and stock movement." },
  { icon: IconChart, title: "Act on insight", desc: "See profit, inventory alerts, top items and busy hours." },
];

export default function ProductPage() {
  return (
    <>
      <section className="pt-12 pb-10 bg-gradient-to-b from-teal-50/60 to-white text-center">
        <Container>
          <Eyebrow>Product</Eyebrow>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
            From sale to insight, automatically.
          </h1>
        </Container>
      </section>

      <section className="py-14 border-t border-slate-100">
        <Container>
          <div className="grid md:grid-cols-4 gap-6">
            {steps.map((s, i) => (
              <div key={s.title} className="relative rounded-2xl p-6 bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-xs font-semibold text-brand-blue mb-3">STEP {i + 1}</div>
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-tealDark to-brand-blueDark text-white flex items-center justify-center mb-4">
                  <s.icon className="w-6 h-6" />
                </div>
                <h3 className="font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-slate-600">{s.desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-14 bg-navy text-white text-center">
        <Container className="max-w-2xl">
          <h2 className="text-3xl font-bold mb-4">Designed for owners, not accountants.</h2>
          <p className="text-slate-300">
            Bizzux keeps daily work simple for staff while giving owners the visibility needed to make better
            business decisions.
          </p>
          <div className="mt-8">
            <CTAButton href="/contact">Book a demo</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}

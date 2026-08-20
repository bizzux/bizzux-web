import { Container, Eyebrow, CTAButton } from "@/components/Section";
import { IconPOS, IconMenu, IconBox, IconWallet, IconUsers, IconChart, IconLayers } from "@/components/Icons";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bizzux Platform | Cloud POS, Inventory, Expense & Profit Software",
  description:
    "Cloud-based POS, Inventory, Expense & Profit Management Software for shops, cafés, restaurants, bakeries, retail stores and growing local businesses.",
};

const features = [
  { icon: IconPOS, title: "Point of sale and payment tracking", desc: "Record sales, accept cash, UPI and online payments, and track every transaction." },
  { icon: IconMenu, title: "Digital menu and customer self-ordering", desc: "Let customers browse your menu and place self-orders directly." },
  { icon: IconBox, title: "Inventory, purchases, expiry and low-stock alerts", desc: "Stay ahead of stockouts and spoilage with real-time inventory tracking." },
  { icon: IconWallet, title: "OpEx, CapEx and profit tracking", desc: "Separate operating costs from capital investments and see real profit." },
  { icon: IconUsers, title: "Customer and vendor management", desc: "Track customer dues, vendor balances and purchase history in one place." },
  { icon: IconChart, title: "Sales reports and business analytics", desc: "Best-selling items, busy hours, payment split and sales trends at a glance." },
  { icon: IconLayers, title: "Multi-shop and staff access", desc: "Manage multiple branches and give staff the right level of access." },
];

export default function PlatformPage() {
  return (
    <>
      <section className="pt-12 pb-10 bg-navy text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-40" style={{
          background: "radial-gradient(60% 50% at 20% 20%, rgba(20,184,166,0.35) 0%, transparent 60%)"
        }} />
        <Container className="relative text-center">
          <Eyebrow light>Bizzux Business Platform</Eyebrow>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
            Cloud-based POS, Inventory, Expense &amp; Profit Management Software
          </h1>
          <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-8">
            A simple system for shops, cafés, restaurants, bakeries, retail stores and growing local businesses.
          </p>
          <CTAButton href="/contact">Book a demo</CTAButton>
        </Container>
      </section>

      <section className="py-14">
        <Container>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div key={f.title} className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-brand-teal to-brand-blue text-white flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-slate-600">{f.desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-14 pb-24 bg-slate-50 text-center">
        <Container>
          <h2 className="text-3xl font-bold mb-4">See it running for your business.</h2>
          <div className="flex flex-wrap gap-4 justify-center">
            <CTAButton href="/apps">Explore Bizzux Platform</CTAButton>
            <CTAButton href="/pricing">See pricing</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}

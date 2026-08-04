import Image from "next/image";
import { Container, Eyebrow, CTAButton, Pill } from "@/components/Section";
import { IconPOS, IconMenu, IconBox, IconWallet, IconUsers, IconChart } from "@/components/Icons";

const pillars = [
  {
    title: "Sell better",
    desc: "POS, digital menu, self-orders, cash, UPI and online payments",
  },
  {
    title: "Control stock",
    desc: "Purchases, stock, expiry and low-stock alerts",
  },
  {
    title: "Track money",
    desc: "OpEx, CapEx, customer dues and vendor balances",
  },
  {
    title: "Grow with clarity",
    desc: "Reports, top-selling items, busy hours and multi-shop view",
  },
];

const features = [
  {
    icon: IconPOS,
    title: "Sales and Point of Sale",
    desc: "Record counter sales quickly. Accept cash, UPI and online payments. Track every sale by date, item and payment type.",
  },
  {
    icon: IconMenu,
    title: "Digital Menu and Self-Ordering",
    desc: "Show your products or menu online. Let customers browse, place self-orders and pay through your preferred method.",
  },
  {
    icon: IconBox,
    title: "Inventory and Purchases",
    desc: "Record purchases, track stock by quantity, receive low-stock alerts and manage expiry dates before they become a loss.",
  },
  {
    icon: IconWallet,
    title: "Expenses and Profit Tracking",
    desc: "Separate purchases from expenses. Track operating costs and capital investments. See the numbers that matter for your business.",
  },
  {
    icon: IconUsers,
    title: "Customers and Vendors",
    desc: "Keep customer and supplier details in one place. Track outstanding amounts, credit periods, purchase history and quick-contact details.",
  },
  {
    icon: IconChart,
    title: "Business Analytics",
    desc: "Know your best-selling items, busiest hours, payment split, sales trend and performance across one or more shops.",
  },
];

const useCases = ["Juice shops", "Tea shops", "Cafés", "Restaurants", "Bakeries", "Retail stores", "Local businesses"];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy">
        <div className="absolute inset-0 opacity-40" style={{
          background: "radial-gradient(60% 50% at 20% 20%, rgba(20,184,166,0.35) 0%, transparent 60%), radial-gradient(50% 50% at 85% 30%, rgba(37,99,235,0.35) 0%, transparent 60%)"
        }} />
        <Container className="relative pt-20 pb-16 text-center">
          <div className="flex justify-center mb-8">
            <Image src="/logo-transparent.png" alt="Bizzux" width={220} height={90} priority className="h-14 w-auto" />
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight max-w-3xl mx-auto text-white">
            Run your business smarter, every day.
          </h1>
          <p className="mt-6 text-lg text-slate-300 max-w-2xl mx-auto">
            Bizzux is cloud-based POS, inventory, expense and profit management software for small and growing businesses.
          </p>
          <p className="mt-3 text-slate-400 max-w-2xl mx-auto">
            Manage sales, payments, stock, purchases, expenses, customers and business insights in one simple system.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 justify-center">
            <CTAButton href="/contact">Book a demo</CTAButton>
            <CTAButton href="/contact" variant="ghost-light">Start free</CTAButton>
          </div>
        </Container>
        <div className="relative border-t border-white/10 bg-black/20">
          <Container className="py-6">
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-slate-300">
              {useCases.map((u, i) => (
                <span key={u} className="flex items-center gap-8">
                  <span>{u}</span>
                  {i < useCases.length - 1 && <span className="text-brand-lime">•</span>}
                </span>
              ))}
            </div>
          </Container>
        </div>
      </section>

      {/* One system section */}
      <section className="py-20 border-b border-slate-100">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-14">
            <Eyebrow>Why Bizzux</Eyebrow>
            <h2 className="text-3xl font-bold mb-4">One system. Clearer business decisions.</h2>
            <p className="text-slate-600">
              Stop switching between notebooks, WhatsApp, spreadsheets and separate billing apps. With Bizzux, every
              sale, purchase and expense is connected — so you can understand stock, cash flow and profit with
              confidence.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {pillars.map((p) => (
              <div key={p.title} className="rounded-2xl p-6 bg-brand-gradient-soft border border-slate-100">
                <h3 className="font-semibold mb-2">{p.title}</h3>
                <p className="text-sm text-slate-600">{p.desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Feature grid */}
      <section className="py-20 bg-slate-50">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-14">
            <Eyebrow>Platform</Eyebrow>
            <h2 className="text-3xl font-bold mb-4">Everything your business needs</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div key={f.title} className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
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

      {/* CTA */}
      <section className="py-20 bg-navy text-white text-center">
        <Container>
          <h2 className="text-3xl font-bold mb-4">See Bizzux running your business.</h2>
          <p className="text-slate-300 max-w-xl mx-auto mb-10">
            Book a free demo and we&apos;ll show you how Bizzux fits your shop, menu and daily workflow.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <CTAButton href="/contact">Book a demo</CTAButton>
            <CTAButton href="/pricing" variant="ghost-light">See pricing</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}

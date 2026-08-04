import { Container, Eyebrow, CTAButton } from "@/components/Section";
import { IconJuice, IconBakery, IconRestaurant, IconStore } from "@/components/Icons";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Solutions — Bizzux",
  description: "Bizzux adapts to your business — juice and beverage shops, cafés, restaurants, and retail stores.",
};

const solutions = [
  {
    icon: IconJuice,
    title: "For juice and beverage shops",
    desc: "Manage fresh juices, tea, coffee, shakes, add-ons, stock and self-orders.",
  },
  {
    icon: IconBakery,
    title: "For cafés, bakeries and snack shops",
    desc: "Run counter billing, menu management, ingredient purchases, stock alerts and daily sales reporting.",
  },
  {
    icon: IconRestaurant,
    title: "For restaurants and fast-food outlets",
    desc: "Create a digital menu, receive self-orders, track payments and understand your top-performing items.",
  },
  {
    icon: IconStore,
    title: "For retail and provision stores",
    desc: "Manage products, inventory, purchases, expenses, customers and vendor records from one system.",
  },
];

export default function SolutionsPage() {
  return (
    <>
      <section className="pt-20 pb-16 bg-navy text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-40" style={{
          background: "radial-gradient(50% 50% at 80% 20%, rgba(163,230,53,0.2) 0%, transparent 60%)"
        }} />
        <Container className="relative text-center">
          <Eyebrow light>Solutions</Eyebrow>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6">
            Built for businesses that sell every day.
          </h1>
          <p className="text-lg text-slate-300 max-w-2xl mx-auto">
            Bizzux adapts to your business. Create your own categories, items, units, prices, taxes and stock rules.
          </p>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div className="grid md:grid-cols-2 gap-6">
            {solutions.map((s) => (
              <div key={s.title} className="rounded-2xl p-8 border border-slate-100 bg-white shadow-sm hover:shadow-md transition-shadow">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-teal to-brand-blue text-white flex items-center justify-center mb-5">
                  <s.icon className="w-7 h-7" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{s.title}</h3>
                <p className="text-slate-600">{s.desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 bg-slate-50 text-center">
        <Container>
          <h2 className="text-3xl font-bold mb-4">Not sure which fits your shop?</h2>
          <p className="text-slate-600 mb-8">Tell us about your business and we&apos;ll configure Bizzux around it.</p>
          <CTAButton href="/contact">Book a demo</CTAButton>
        </Container>
      </section>
    </>
  );
}

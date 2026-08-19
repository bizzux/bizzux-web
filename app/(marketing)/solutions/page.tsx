import Link from "next/link";
import { Container, Eyebrow, CTAButton } from "@/components/Section";
import { IconJuice, IconBakery, IconRestaurant, IconStore, IconLayers, IconSpark, IconBox, IconCloud, IconDatabase, IconTeam, IconMail } from "@/components/Icons";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Solutions | Bizzux",
  description: "Bizzux Platform solutions by business type, plus custom technology solutions for growing businesses.",
};

const platformSolutions = [
  { icon: IconJuice, title: "For juice and beverage shops", href: "/platform" },
  { icon: IconBakery, title: "For tea shops and cafés", href: "/platform" },
  { icon: IconRestaurant, title: "For restaurants and fast-food outlets", href: "/platform" },
  { icon: IconBakery, title: "For bakeries and snack shops", href: "/platform" },
  { icon: IconStore, title: "For retail and provision stores", href: "/platform" },
  { icon: IconLayers, title: "For multi-branch businesses", href: "/platform" },
];

const customSolutions = [
  { icon: IconLayers, title: "Custom business applications", href: "/custom-solutions" },
  { icon: IconSpark, title: "AI-enabled workflow automation", href: "/custom-solutions" },
  { icon: IconSpark, title: "Agentic AI solutions", href: "/custom-solutions" },
  { icon: IconBox, title: "E-commerce websites", href: "/custom-solutions" },
  { icon: IconCloud, title: "Cloud migration and hosting", href: "/custom-solutions" },
  { icon: IconDatabase, title: "On-premise and self-hosted solutions", href: "/custom-solutions" },
  { icon: IconMail, title: "Microsoft 365 setup and integration", href: "/microsoft-365" },
  { icon: IconTeam, title: "Teams, SharePoint and OneDrive solutions", href: "/microsoft-365" },
  { icon: IconDatabase, title: "API and business-system integrations", href: "/custom-solutions" },
];

function SolutionCard({ icon: Icon, title, href }: { icon: any; title: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-xl border border-slate-100 bg-white p-5 shadow-sm hover:shadow-md hover:border-brand-blue/30 transition-all"
    >
      <div className="w-11 h-11 shrink-0 rounded-lg bg-gradient-to-br from-brand-teal to-brand-blue text-white flex items-center justify-center">
        <Icon className="w-5 h-5" />
      </div>
      <span className="font-medium text-sm text-ink">{title}</span>
    </Link>
  );
}

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
          <h2 className="text-2xl font-bold mb-8">Bizzux Platform Solutions</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-20">
            {platformSolutions.map((s) => <SolutionCard key={s.title} {...s} />)}
          </div>

          <h2 className="text-2xl font-bold mb-8">Custom Technology Solutions</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {customSolutions.map((s) => <SolutionCard key={s.title} {...s} />)}
          </div>
        </Container>
      </section>

      <section className="py-20 bg-slate-50 text-center">
        <Container>
          <h2 className="text-3xl font-bold mb-4">Not sure which fits your business?</h2>
          <p className="text-slate-600 mb-8">Tell us about your business and we&apos;ll configure the right solution.</p>
          <CTAButton href="/contact">Book a demo</CTAButton>
        </Container>
      </section>
    </>
  );
}

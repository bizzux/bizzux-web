import { Container, Eyebrow, CTAButton } from "@/components/Section";
import HeroShowcase from "@/components/HeroShowcase";
import FeaturedAppsGrid from "@/components/FeaturedAppsGrid";
import SuperAdminHomeRedirect from "@/components/SuperAdminHomeRedirect";
import {
  IconPOS,
  IconLayers, IconSpark, IconCloud, IconShield, IconCheck,
  IconArrowRight, IconUsers,
} from "@/components/Icons";
import CustomerMarquee from "@/components/CustomerMarquee";
import { getCustomerLogos } from "@/lib/companyData";

const platformFeatures = [
  "Point of sale and payment tracking",
  "Digital menu and customer self-ordering",
  "Inventory, purchases, expiry and low-stock alerts",
  "OpEx, CapEx and profit tracking",
  "Customer and vendor management",
  "Sales reports and business analytics",
  "Multi-shop and staff access",
];

const customFeatures = [
  "Custom business web applications",
  "E-commerce websites and ordering platforms",
  "AI-enabled automation and intelligent workflows",
  "Agentic AI solutions for repetitive business processes",
  "Dashboard, reporting and analytics solutions",
  "API and third-party integrations",
  "Cloud-hosted or self-hosted deployments",
];

const whyPillars = [
  { icon: IconCloud, title: "Cloud-first", desc: "Access your business from anywhere" },
  { icon: IconSpark, title: "AI-ready", desc: "AI-enabled automation and agentic workflows where valuable" },
  { icon: IconShield, title: "Secure by design", desc: "Custom domains, SSL/TLS and controlled access" },
  { icon: IconLayers, title: "Built around you", desc: "Ready-to-use platform or custom-built software" },
];

const secureItems = [
  "Custom business domain, such as you@yourbusiness.com",
  "SSL/TLS-secured websites and applications",
  "Secure cloud hosting",
  "Role-based user access",
  "Backups and restore options",
  "Custom cloud deployment",
  "Self-hosted / on-premise deployment for eligible custom solutions",
  "Integration with your existing business tools",
];

// The customer-logo strip is managed from /admin → Customers; the admin API
// revalidates "/" after every change, this is the fallback.
export const revalidate = 60;

export default async function Home() {
  const customerLogos = await getCustomerLogos();
  return (
    <>
      <SuperAdminHomeRedirect />
      {/* Hero — animated showcase (rotating app orbit around the photo) */}
      <HeroShowcase />

      {/* Featured apps — right under the hero, no scroll needed to reach it */}
      <div className="px-6 relative z-10">
        <Container className="!px-0 !max-w-7xl">
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-6 md:p-7">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-5">
              <span className="text-sm font-bold tracking-wide uppercase text-slate-500">Featured apps</span>
              <a
                href="/apps"
                className="inline-flex items-center gap-1.5 h-10 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold px-5 hover:opacity-90 transition-opacity whitespace-nowrap"
                style={{ color: "#ffffff" }}
              >
                Explore all apps <IconArrowRight className="w-4 h-4" />
              </a>
            </div>
            <FeaturedAppsGrid />
          </div>
        </Container>
      </div>

      <CustomerMarquee logos={customerLogos} />

      {/* Two core offerings */}
      <section className="pt-10 pb-12 md:pt-14 md:pb-14 border-b border-slate-100">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-10">
            <Eyebrow>Two ways to work with us</Eyebrow>
            <h2 className="text-3xl font-bold">Everything you need, or exactly what you need.</h2>
          </div>
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-8 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-tealDark to-brand-cyanDark text-white flex items-center justify-center mb-5">
                <IconPOS className="w-6 h-6" />
              </div>
              <div className="text-xs font-semibold text-brand-teal uppercase tracking-wide mb-1">01 · Bizzux Business Platform</div>
              <h3 className="text-xl font-bold mb-2">Cloud-based POS, Inventory, Expense &amp; Profit Management Software</h3>
              <p className="text-slate-600 mb-6">
                A simple system for shops, cafés, restaurants, bakeries, retail stores and growing local businesses.
              </p>
              <ul className="space-y-2.5 mb-8 flex-1">
                {platformFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                    <IconCheck className="w-4 h-4 mt-0.5 text-brand-teal shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <CTAButton href="/apps">Explore Bizzux Platform</CTAButton>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-8 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-tealDark to-brand-cyanDark text-white flex items-center justify-center mb-5">
                <IconSpark className="w-6 h-6" />
              </div>
              <div className="text-xs font-semibold text-brand-teal uppercase tracking-wide mb-1">02 · Custom Cloud &amp; AI Solutions</div>
              <h3 className="text-xl font-bold mb-2">Software built around the way your business works.</h3>
              <p className="text-slate-600 mb-6">
                When standard software is not enough, Bizzux designs and builds custom web applications,
                e-commerce platforms, AI-enabled workflows and secure cloud solutions.
              </p>
              <ul className="space-y-2.5 mb-8 flex-1">
                {customFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                    <IconCheck className="w-4 h-4 mt-0.5 text-brand-teal shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <CTAButton href="/custom-solutions">Discuss Your Requirement</CTAButton>
            </div>
          </div>
        </Container>
      </section>

      {/* Why Bizzux */}
      <section className="py-12 md:py-14 bg-slate-50">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-8 md:mb-10">
            <Eyebrow>Why Bizzux</Eyebrow>
            <h2 className="text-3xl font-bold mb-4">Modern business software, built for what comes next.</h2>
            <p className="text-slate-600">
              Bizzux combines cloud technology, AI-enabled capabilities and practical business design to help
              businesses operate professionally and grow with confidence. We do not believe business software
              should be old, complex or difficult to use. Our solutions are designed to be simple for teams,
              useful for owners and ready for future AI-driven workflows.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {whyPillars.map((p) => (
              <div key={p.title} className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
                <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-brand-tealDark to-brand-blueDark text-white flex items-center justify-center mb-4">
                  <p.icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold mb-2">{p.title}</h3>
                <p className="text-sm text-slate-600">{p.desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Secure solutions */}
      <section className="py-12 md:py-14">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-8 md:mb-10">
            <Eyebrow>Secure by design</Eyebrow>
            <h2 className="text-3xl font-bold">Your business deserves a professional and secure digital foundation.</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {secureItems.map((item) => (
              <div key={item} className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm flex gap-3">
                <IconShield className="w-5 h-5 text-brand-blue shrink-0 mt-0.5" />
                <span className="text-sm text-slate-700">{item}</span>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-slate-500 mt-8 max-w-xl mx-auto">
            Self-hosted and on-premise solutions are evaluated based on architecture, security and support
            requirements.
          </p>
        </Container>
      </section>

      {/* CTA */}
      <section className="py-10 md:py-12 bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white text-center">
        <Container>
          <h2 className="text-3xl font-bold mb-3">Let&apos;s build what your business needs.</h2>
          <p className="text-teal-50 max-w-xl mx-auto">
            Whether it&apos;s daily business management, a custom AI-enabled application, or a professional
            email setup, our team can help.
          </p>
        </Container>
      </section>
    </>
  );
}

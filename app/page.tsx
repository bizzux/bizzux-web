import Image from "next/image";
import { Container, Eyebrow, CTAButton } from "@/components/Section";
import {
  IconPOS, IconMenu, IconBox, IconWallet, IconUsers, IconChart,
  IconLayers, IconSpark, IconCloud, IconShield, IconWhatsApp, IconCheck,
} from "@/components/Icons";

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
            Run Your Business. Build What&apos;s Next. All Under One Roof.
          </h1>
          <p className="mt-6 text-lg text-slate-300 max-w-2xl mx-auto">
            Bizzux gives growing businesses two ways to win: a ready-to-use business management platform for today,
            and custom AI-enabled software for the workflows off-the-shelf tools cannot handle.
          </p>
          <p className="mt-3 text-slate-400 max-w-2xl mx-auto">
            Manage sales, inventory, expenses and profit with Bizzux. Build custom cloud, AI and business solutions
            when your business needs something more.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 justify-center">
            <CTAButton href="/platform">Explore Bizzux Platform</CTAButton>
            <CTAButton href="/custom-solutions" variant="ghost-light">Build a Custom Solution</CTAButton>
          </div>
          <div className="mt-5 flex justify-center">
            <a
              href="https://wa.me/919591222422"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-green-400 hover:text-green-300 transition-colors"
            >
              <IconWhatsApp className="w-4 h-4" />
              Chat on WhatsApp
            </a>
          </div>
        </Container>
      </section>

      {/* Two core offerings */}
      <section className="py-20 border-b border-slate-100">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-14">
            <Eyebrow>Two ways to work with us</Eyebrow>
            <h2 className="text-3xl font-bold">Everything you need, or exactly what you need.</h2>
          </div>
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-8 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-teal to-brand-cyan text-white flex items-center justify-center mb-5">
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
              <CTAButton href="/platform">Explore Bizzux Platform</CTAButton>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-navy text-white shadow-sm p-8 flex flex-col relative overflow-hidden">
              <div className="absolute inset-0 opacity-30" style={{
                background: "radial-gradient(60% 60% at 90% 10%, rgba(163,230,53,0.25) 0%, transparent 60%)"
              }} />
              <div className="relative flex flex-col h-full">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-blue to-brand-deep text-white flex items-center justify-center mb-5">
                  <IconSpark className="w-6 h-6" />
                </div>
                <div className="text-xs font-semibold text-brand-lime uppercase tracking-wide mb-1">02 · Custom Cloud &amp; AI Solutions</div>
                <h3 className="text-xl font-bold mb-2">Software built around the way your business works.</h3>
                <p className="text-slate-300 mb-6">
                  When standard software is not enough, Bizzux designs and builds custom web applications,
                  e-commerce platforms, AI-enabled workflows and secure cloud solutions.
                </p>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {customFeatures.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-200">
                      <IconCheck className="w-4 h-4 mt-0.5 text-brand-lime shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <CTAButton href="/custom-solutions" variant="ghost-light">Discuss Your Requirement</CTAButton>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Why Bizzux */}
      <section className="py-20 bg-slate-50">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-14">
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
                <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-brand-teal to-brand-blue text-white flex items-center justify-center mb-4">
                  <p.icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold mb-2">{p.title}</h3>
                <p className="text-sm text-slate-600">{p.desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* AI / agentic AI */}
      <section className="py-20 bg-navy text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30" style={{
          background: "radial-gradient(55% 55% at 15% 30%, rgba(37,99,235,0.3) 0%, transparent 65%)"
        }} />
        <Container className="relative grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <Eyebrow light>AI &amp; agentic AI</Eyebrow>
            <h2 className="text-3xl font-bold mb-4">Move beyond traditional software.</h2>
            <p className="text-slate-300 mb-4">
              AI-enabled solutions that help work move faster. Bizzux builds modern cloud applications with AI
              capabilities such as intelligent automation, document processing, workflow assistance, business
              insights and agentic workflows.
            </p>
            <p className="text-slate-300 mb-4">
              Agentic AI can help businesses automate multi-step activities — such as collecting information,
              preparing reports, following up on tasks or connecting data between systems — while keeping people
              in control of important decisions.
            </p>
            <p className="text-brand-lime font-medium">We apply AI where it creates real business value, not just as a label.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-lime to-brand-teal text-navy flex items-center justify-center mb-5">
              <IconSpark className="w-6 h-6" />
            </div>
            <ul className="space-y-4 text-sm text-slate-200">
              <li className="flex gap-3"><IconCheck className="w-4 h-4 mt-0.5 text-brand-lime shrink-0" /> Intelligent automation of repetitive tasks</li>
              <li className="flex gap-3"><IconCheck className="w-4 h-4 mt-0.5 text-brand-lime shrink-0" /> Document processing and data extraction</li>
              <li className="flex gap-3"><IconCheck className="w-4 h-4 mt-0.5 text-brand-lime shrink-0" /> Workflow assistance and business insights</li>
              <li className="flex gap-3"><IconCheck className="w-4 h-4 mt-0.5 text-brand-lime shrink-0" /> Agentic workflows, with people in control</li>
            </ul>
          </div>
        </Container>
      </section>

      {/* Secure solutions */}
      <section className="py-20">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-14">
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
      <section className="py-20 bg-gradient-to-r from-brand-teal to-brand-blue text-white text-center">
        <Container>
          <h2 className="text-3xl font-bold mb-4">Let&apos;s build what your business needs.</h2>
          <p className="text-teal-50 max-w-xl mx-auto mb-10">
            Whether it&apos;s daily business management, a custom AI-enabled application, or a professional
            Microsoft 365 setup — our team can help.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <a
              href="https://wa.me/919591222422"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-white text-brand-blue font-semibold px-6 py-3 text-sm hover:bg-teal-50 transition-colors"
            >
              <IconWhatsApp className="w-4 h-4" />
              Chat on WhatsApp
            </a>
            <a href="/contact" className="inline-flex rounded-full border border-white/60 text-white font-semibold px-6 py-3 text-sm hover:bg-white/10 transition-colors">
              Contact us
            </a>
          </div>
        </Container>
      </section>
    </>
  );
}

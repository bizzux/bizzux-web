import { Container, Eyebrow, CTAButton } from "@/components/Section";
import {
  IconPOS, IconMenu, IconBox, IconWallet, IconUsers, IconChart,
  IconLayers, IconSpark, IconCloud, IconShield, IconWhatsApp, IconCheck,
  IconStore, IconArrowRight,
} from "@/components/Icons";

const featuredApps = [
  { icon: IconStore, name: "Bizzux Shop", desc: "POS, menu, inventory and shop management for food & retail counters.", live: true },
  { icon: IconPOS, name: "Bizzux POS", desc: "A fast, simple point-of-sale for any counter or checkout.", live: false },
  { icon: IconMenu, name: "Bizzux Orders", desc: "Take and track orders from counter, phone or online.", live: false },
  { icon: IconWallet, name: "Bizzux Books", desc: "Accounting and invoicing for small, growing businesses.", live: false },
  { icon: IconBox, name: "Bizzux Inventory", desc: "Stock, materials and supply tracking in real time.", live: false },
  { icon: IconUsers, name: "Bizzux CRM", desc: "Track leads, customers and follow-ups without spreadsheets.", live: false },
];

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
        <Container className="relative pt-14 pb-12 md:pt-16 md:pb-14 text-center">
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight max-w-3xl mx-auto text-white">
            Run Your Business. Build What&apos;s Next. All Under One Roof.
          </h1>
          <p className="mt-5 text-lg text-slate-300 max-w-2xl mx-auto">
            Bizzux gives growing businesses two ways to win: a ready-to-use business management platform for today,
            and custom AI-enabled software for the workflows off-the-shelf tools cannot handle.
          </p>
          <p className="mt-3 text-slate-400 max-w-2xl mx-auto">
            Manage sales, inventory, expenses and profit with Bizzux. Build custom cloud, AI and business solutions
            when your business needs something more.
          </p>
          <div className="mt-8 flex flex-wrap gap-4 justify-center">
            <CTAButton href="/platform">Explore Bizzux Platform</CTAButton>
            <CTAButton href="/custom-solutions" variant="ghost-light">Build a Custom Solution</CTAButton>
          </div>
        </Container>
      </section>

      {/* Featured apps — floats up over the hero's bottom edge, echoing the
          "featured products" panel pattern from bizzux-apps' own launcher
          (icons, layout style) but with Bizzux's own apps and branding. */}
      <div className="px-6 mt-8 md:mt-10 relative z-10">
        <Container className="!px-0">
          <div className="rounded-2xl border border-slate-100 bg-white shadow-xl shadow-slate-900/5 p-6 md:p-8 grid md:grid-cols-[300px_1fr] gap-6 md:gap-8">
            <div className="rounded-xl bg-gradient-to-br from-brand-teal via-brand-cyan to-brand-blue text-white p-6 flex flex-col justify-between">
              <div>
                <div className="w-11 h-11 rounded-lg bg-white/15 flex items-center justify-center mb-4">
                  <IconStore className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold mb-2">Bizzux Shop is live</h3>
                <p className="text-sm text-white/80">
                  POS, digital menu, inventory and shop management — start running your counter on Bizzux today, free for 14 days.
                </p>
              </div>
              <CTAButton href="/sign-in?mode=signup" variant="ghost-light">Start free trial</CTAButton>
            </div>

            <div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-5">
                <span className="text-xs font-bold tracking-wide uppercase text-slate-500">Featured apps</span>
                <a
                  href="/apps"
                  className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-teal to-brand-blue text-xs font-semibold px-4 py-2 hover:opacity-90 transition-opacity whitespace-nowrap"
                  style={{ color: "#ffffff" }}
                >
                  Explore all apps <IconArrowRight className="w-3.5 h-3.5" />
                </a>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
                {featuredApps.map((a) => (
                  <div key={a.name} className="flex gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${a.live ? "bg-gradient-to-br from-brand-teal to-brand-blue text-white" : "bg-slate-100 text-slate-400"}`}>
                      <a.icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{a.name}</span>
                        {!a.live && <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">Soon</span>}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{a.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </div>

      {/* Two core offerings */}
      <section className="pt-14 pb-16 md:pt-20 md:pb-16 border-b border-slate-100">
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

            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-8 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-teal to-brand-cyan text-white flex items-center justify-center mb-5">
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
      <section className="py-16 md:py-20 bg-slate-50">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-10 md:mb-12">
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

      {/* Secure solutions */}
      <section className="py-16 md:py-20">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-10 md:mb-12">
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
      <section className="py-16 md:py-20 bg-gradient-to-r from-brand-teal to-brand-blue text-white text-center">
        <Container>
          <h2 className="text-3xl font-bold mb-4">Let&apos;s build what your business needs.</h2>
          <p className="text-teal-50 max-w-xl mx-auto mb-8 md:mb-10">
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

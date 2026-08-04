import { Container, Eyebrow, CTAButton } from "@/components/Section";
import Link from "next/link";

const platformFeatures = [
  { title: "Sales & CRM", desc: "Track leads, manage your pipeline, and keep every customer conversation in one place." },
  { title: "Invoicing & Billing", desc: "Create, send, and track professional invoices in seconds. Get paid faster." },
  { title: "Scheduling & Operations", desc: "Manage appointments, projects, and team schedules without the back-and-forth." },
  { title: "Inventory Management", desc: "Know what you have, what's low, and what's on order — automatically." },
  { title: "HR & Team Management", desc: "Onboard staff, track time, and manage basic HR needs in one system." },
  { title: "Reporting & Dashboards", desc: "Real-time revenue, profit, and performance — no more end-of-month guesswork." },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="pt-20 pb-24 bg-gradient-to-b from-teal-50/60 to-white">
        <Container className="text-center">
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight max-w-3xl mx-auto">
            Run Your Business. Build What&apos;s Next.
            <span className="text-brand"> All Under One Roof.</span>
          </h1>
          <p className="mt-6 text-lg text-slate-600 max-w-2xl mx-auto">
            Bizzux gives growing businesses two ways to win: an all-in-one business
            management platform ready to use today, and custom software built for the
            workflows off-the-shelf tools can&apos;t handle.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 justify-center">
            <CTAButton href="/contact">Start Free with Bizzux</CTAButton>
            <CTAButton href="/custom-software" variant="secondary">Talk to Us About a Custom Build</CTAButton>
          </div>
        </Container>
      </section>

      {/* Problem/solution teaser */}
      <section className="py-20 border-t border-slate-100">
        <Container className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <Eyebrow>The Problem</Eyebrow>
            <h2 className="text-3xl font-bold mb-4">
              You started a business. Nobody handed you a manual.
            </h2>
            <p className="text-slate-600 mb-4">
              Most small business owners don&apos;t start with an accounting degree. They
              start with an idea, some savings, and a notebook for sales. It works —
              until they realize a notebook can tell you what you sold today, but not
              whether you actually made money.
            </p>
            <p className="text-slate-600">
              No tracked revenue and expenses means no net profit, no break-even
              analysis, and no idea what&apos;s CapEx versus OpEx. Bizzux replaces the
              notebook and the cash tin with software that does the thinking for you.
            </p>
          </div>
          <div className="bg-slate-50 rounded-2xl p-8 border border-slate-100">
            <div className="text-sm font-semibold text-slate-500 mb-4">WITHOUT BIZZUX → WITH BIZZUX</div>
            <ul className="space-y-4">
              {[
                ["Guessing at profit", "Real-time net profit, every day"],
                ["No break-even visibility", "Automatic break-even analysis"],
                ["CapEx & OpEx lumped together", "Automatically separated and tracked"],
                ["Manual notebook & cash tin", "One-tap point of sale"],
                ["No idea what's selling best", "Business intelligence dashboards"],
              ].map(([before, after]) => (
                <li key={before} className="flex items-start gap-3 text-sm">
                  <span className="text-slate-400 line-through w-1/2">{before}</span>
                  <span className="text-brand font-medium w-1/2">{after}</span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      {/* Platform features */}
      <section className="py-20 bg-slate-50 border-t border-slate-100">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-14">
            <Eyebrow>Bizzux Platform</Eyebrow>
            <h2 className="text-3xl font-bold mb-4">Everything your business runs on. In one app.</h2>
            <p className="text-slate-600">
              Invoicing, CRM, scheduling, inventory, HR, and reporting — one login,
              one source of truth, no more duplicate data entry.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {platformFeatures.map((f) => (
              <div key={f.title} className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-slate-600">{f.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <CTAButton href="/platform">See the Full Platform</CTAButton>
          </div>
        </Container>
      </section>

      {/* Custom software teaser */}
      <section className="py-20 border-t border-slate-100">
        <Container className="grid md:grid-cols-2 gap-12 items-center">
          <div className="order-2 md:order-1 bg-slate-50 rounded-2xl p-8 border border-slate-100">
            <ol className="space-y-5">
              {[
                ["Discovery", "We learn your business and where existing tools fall short."],
                ["Design & Scope", "A clear, fixed project plan — no surprises."],
                ["Build & Iterate", "Staged development with regular check-ins."],
                ["Launch & Support", "We deploy, train your team, and stay on for support."],
              ].map(([title, desc], i) => (
                <li key={title} className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-brand text-white text-sm font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div>
                    <div className="font-semibold">{title}</div>
                    <div className="text-sm text-slate-600">{desc}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="order-1 md:order-2">
            <Eyebrow>Custom Software Development</Eyebrow>
            <h2 className="text-3xl font-bold mb-4">
              When off-the-shelf isn&apos;t enough, we build it.
            </h2>
            <p className="text-slate-600 mb-6">
              Some businesses run on processes no template can cover. Our custom
              software team designs and builds bespoke applications, internal tools,
              and integrations tailored to exactly how your business operates.
            </p>
            <CTAButton href="/custom-software">Explore Custom Software</CTAButton>
          </div>
        </Container>
      </section>

      {/* Why Bizzux */}
      <section className="py-20 bg-brand text-white">
        <Container className="text-center">
          <h2 className="text-3xl font-bold mb-4">One team, two ways to solve your software problem.</h2>
          <p className="text-teal-50 max-w-2xl mx-auto mb-10">
            Whether you need a business management platform you can start using today,
            or custom software built around a process no one else has, Bizzux has a
            path for you.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href="/contact" className="rounded-full bg-white text-brand font-semibold px-6 py-3 text-sm hover:bg-teal-50 transition-colors">
              Start Free with Bizzux
            </Link>
            <Link href="/custom-software" className="rounded-full border border-white/60 text-white font-semibold px-6 py-3 text-sm hover:bg-white/10 transition-colors">
              Request a Custom Build
            </Link>
          </div>
        </Container>
      </section>
    </>
  );
}

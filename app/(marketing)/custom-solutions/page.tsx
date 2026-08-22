import { Container, Eyebrow, CTAButton } from "@/components/Section";
import { IconLayers, IconSpark, IconCloud, IconChart, IconDatabase, IconBox, IconShield, IconMail, IconTeam } from "@/components/Icons";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Custom Cloud & AI Solutions | Bizzux",
  description:
    "Custom web applications, e-commerce platforms, AI-enabled workflows and secure cloud solutions built around the way your business works.",
};

const items = [
  { icon: IconLayers, title: "Custom business web applications", desc: "Purpose-built applications for your exact processes." },
  { icon: IconBox, title: "E-commerce websites and ordering platforms", desc: "Sell online with a platform built for how you operate." },
  { icon: IconSpark, title: "AI-enabled automation and intelligent workflows", desc: "Automate repetitive work with AI where it adds real value." },
  { icon: IconSpark, title: "Agentic AI solutions for repetitive business processes", desc: "Multi-step automation with people in control of key decisions." },
  { icon: IconChart, title: "Dashboard, reporting and analytics solutions", desc: "Custom-built visibility into the metrics that matter to you." },
  { icon: IconDatabase, title: "API and third-party integrations", desc: "Connect Bizzux, or any system, to the tools you already use." },
  { icon: IconCloud, title: "Cloud-hosted or self-hosted deployments", desc: "Deploy on our cloud infrastructure, or your own, based on your needs." },
];

// Professional business email setup, folded into this page rather than
// standing on its own. Deliberately provider-agnostic in every word here —
// title, features and pricing labels alike — so the page only ever
// communicates "professional email and productivity tools," never which
// underlying provider powers it.
const emailSetupItems = [
  { icon: IconMail, title: "Custom business email", desc: "you@yourbusiness.com" },
  { icon: IconTeam, title: "Team chat & meetings", desc: "Chat, calls and video meetings" },
  { icon: IconDatabase, title: "Cloud storage", desc: "1 TB per user" },
  { icon: IconLayers, title: "Shared file collaboration", desc: "Organized, shared drives for your team" },
];

export default function CustomSolutionsPage() {
  return (
    <>
      <section className="pt-12 pb-10 bg-navy text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-40" style={{
          background: "radial-gradient(50% 50% at 80% 20%, rgba(163,230,53,0.2) 0%, transparent 60%)"
        }} />
        <Container className="relative text-center">
          <Eyebrow light>Custom Cloud &amp; AI Solutions</Eyebrow>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
            Software built around the way your business works.
          </h1>
          <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-8">
            When standard software is not enough, Bizzux designs and builds custom web applications, e-commerce
            platforms, AI-enabled workflows and secure cloud solutions.
          </p>
          <CTAButton href="/contact">Discuss Your Requirement</CTAButton>
        </Container>
      </section>

      <section className="py-14">
        <Container>
          <h2 className="text-2xl font-bold mb-2 text-center">Professional Business Email Setup</h2>
          <p className="text-slate-600 text-center max-w-xl mx-auto mb-9">
            Stop using yourbusiness@gmail.com for your business. We set up a professional business identity with
            your own domain email, cloud storage and collaboration tools.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {emailSetupItems.map((f) => (
              <div key={f.title} className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm text-center hover:shadow-md transition-shadow">
                <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-brand-tealDark to-brand-blueDark text-white flex items-center justify-center mb-4 mx-auto">
                  <f.icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold mb-1">{f.title}</h3>
                <p className="text-sm text-slate-600">{f.desc}</p>
              </div>
            ))}
          </div>
          <ul className="max-w-xl mx-auto space-y-2 text-sm text-slate-600 text-center">
            <li>Email, documents and spreadsheets, accessible from web and mobile</li>
            <li>User setup, domain configuration and basic administration</li>
            <li>Integration with your website or custom application where needed</li>
          </ul>
        </Container>
      </section>

      <section className="py-14 bg-slate-50">
        <Container className="max-w-3xl">
          <h2 className="text-2xl font-bold mb-8 text-center">Professional Email &amp; Productivity Plan</h2>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-slate-100">
                  <td className="py-4 px-6 font-medium text-slate-700 w-1/2">Email &amp; productivity subscription</td>
                  <td className="py-4 px-6 text-ink font-semibold">₹170/user/month, paid yearly</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-4 px-6 font-medium text-slate-700">Includes</td>
                  <td className="py-4 px-6 text-slate-600">Custom email, team chat &amp; meetings, 1 TB cloud storage/user, shared drives, web/mobile productivity apps</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-4 px-6 font-medium text-slate-700">Bizzux setup and implementation</td>
                  <td className="py-4 px-6 text-ink font-semibold">Starting ₹5,000 one-time</td>
                </tr>
                <tr>
                  <td className="py-4 px-6 font-medium text-slate-700">Custom integrations / migration</td>
                  <td className="py-4 px-6 text-slate-600">Quoted based on scope</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-8 space-y-3 text-xs text-slate-500 max-w-2xl mx-auto text-center">
            <p>
              Email and productivity subscription fees are billed separately and annually by the provider. Bizzux
              charges a one-time implementation fee for domain configuration, account setup and required
              integrations. GST applies as applicable.
            </p>
          </div>
          <div className="mt-10 text-center">
            <CTAButton href="/contact">Set Up Professional Email</CTAButton>
          </div>
        </Container>
      </section>

      <section className="py-14 border-t border-slate-100">
        <Container>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((f) => (
              <div key={f.title} className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-brand-blue to-brand-deep text-white flex items-center justify-center mb-4">
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
        <Container className="max-w-2xl">
          <IconShield className="w-10 h-10 mx-auto mb-4 text-brand-blue" />
          <h2 className="text-2xl font-bold mb-4">Have a specific requirement in mind?</h2>
          <p className="text-slate-600 mb-8">
            Tell us what your business needs and we&apos;ll scope the right cloud, AI or custom software solution.
          </p>
          <CTAButton href="/contact">Discuss Your Requirement</CTAButton>
        </Container>
      </section>
    </>
  );
}

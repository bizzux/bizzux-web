import { Container, Eyebrow, CTAButton } from "@/components/Section";
import { IconLayers, IconSpark, IconCloud, IconChart, IconDatabase, IconBox, IconShield } from "@/components/Icons";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Custom Cloud & AI Solutions — Bizzux",
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

export default function CustomSolutionsPage() {
  return (
    <>
      <section className="pt-20 pb-16 bg-navy text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-40" style={{
          background: "radial-gradient(50% 50% at 80% 20%, rgba(163,230,53,0.2) 0%, transparent 60%)"
        }} />
        <Container className="relative text-center">
          <Eyebrow light>Custom Cloud &amp; AI Solutions</Eyebrow>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6">
            Software built around the way your business works.
          </h1>
          <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-10">
            When standard software is not enough, Bizzux designs and builds custom web applications, e-commerce
            platforms, AI-enabled workflows and secure cloud solutions.
          </p>
          <CTAButton href="/contact">Discuss Your Requirement</CTAButton>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((f) => (
              <div key={f.title} className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
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

      <section className="py-20 bg-slate-50 text-center">
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

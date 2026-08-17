import { Container, Eyebrow } from "@/components/Section";
import { IconLayers, IconCloud, IconSpark, IconTeam, IconChart, IconWhatsApp, IconCheck } from "@/components/Icons";
import CareersForm from "./CareersForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Careers & Internships — Bizzux",
  description: "Build the future of business software with Bizzux. Internship opportunities across engineering, design, AI and business.",
};

const opportunities = [
  "Frontend development",
  "Backend and cloud development",
  "AI/ML and agentic AI",
  "UI/UX design",
  "Business analysis",
  "Digital marketing and sales",
  "Quality assurance",
];

export default function CareersPage() {
  return (
    <>
      <section className="pt-20 pb-16 bg-navy text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30" style={{
          background: "radial-gradient(55% 55% at 80% 10%, rgba(20,184,166,0.3) 0%, transparent 65%)"
        }} />
        <Container className="relative text-center max-w-2xl">
          <Eyebrow light>Careers &amp; Internships</Eyebrow>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6">
            Build the future of business software with Bizzux.
          </h1>
          <p className="text-lg text-slate-300">
            We are building cloud-first, AI-enabled products and custom business solutions. If you are curious
            about software, AI, design, cloud or business technology, we would like to hear from you.
          </p>
        </Container>
      </section>

      <section className="py-20 border-b border-slate-100">
        <Container>
          <h2 className="text-2xl font-bold mb-8 text-center">Internship opportunities</h2>
          <div className="flex flex-wrap justify-center gap-3 max-w-3xl mx-auto">
            {opportunities.map((o) => (
              <span key={o} className="inline-flex items-center gap-2 rounded-full bg-slate-50 border border-slate-200 px-4 py-2 text-sm text-slate-700">
                <IconCheck className="w-4 h-4 text-brand-teal" />
                {o}
              </span>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 bg-slate-50">
        <Container className="max-w-2xl">
          <h2 className="text-2xl font-bold mb-2 text-center">Apply for an internship</h2>
          <p className="text-slate-600 text-center mb-10">Tell us a bit about yourself and what you&apos;d like to work on.</p>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
            <CareersForm />
          </div>
        </Container>
      </section>
    </>
  );
}

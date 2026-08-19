import { Container, Eyebrow, CTAButton } from "@/components/Section";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Custom Software Development | Bizzux",
  description:
    "Custom software development for businesses that have outgrown off-the-shelf tools. From internal tools to full platforms, Bizzux builds software around how you actually work.",
};

const whatWeBuild = [
  "Custom internal tools and workflow automation",
  "Bespoke customer-facing platforms and portals",
  "Integrations connecting the Bizzux platform (or any existing system) with the tools you rely on",
  "End-to-end custom applications for businesses with unique operational needs",
];

const process = [
  ["Discovery", "We learn your business, your workflows, and where existing tools fall short."],
  ["Design & Scope", "We map out a solution and a clear, fixed project plan."],
  ["Build & Iterate", "We develop in stages, with regular check-ins so there are no surprises."],
  ["Launch & Support", "We deploy, train your team, and stay on for ongoing support."],
];

export default function CustomSoftwarePage() {
  return (
    <>
      <section className="pt-20 pb-16 bg-gradient-to-b from-teal-50/60 to-white">
        <Container className="text-center">
          <Eyebrow>Custom Software Development</Eyebrow>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6">
            When off-the-shelf isn&apos;t enough, we build it.
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto mb-10">
            Some businesses run on processes no template can cover. We design and
            build bespoke applications, internal tools, and integrations tailored to
            exactly how your business operates, not the other way around.
          </p>
          <CTAButton href="/contact">Request a Consultation</CTAButton>
        </Container>
      </section>

      <section className="py-20 border-t border-slate-100">
        <Container className="grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-bold mb-6">What we build</h2>
            <ul className="space-y-4">
              {whatWeBuild.map((item) => (
                <li key={item} className="flex gap-3 text-slate-700">
                  <span className="text-brand font-bold">→</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-6">Who it&apos;s for</h2>
            <p className="text-slate-700">
              Growing SMBs and agencies whose workflows are too specific, or too
              critical, to force into a generic tool. If you&apos;ve ever said
              &ldquo;we need software that does exactly X, and nothing on the market
              does that,&rdquo; this is for you.
            </p>
          </div>
        </Container>
      </section>

      <section className="py-20 bg-slate-50 border-t border-slate-100">
        <Container>
          <h2 className="text-2xl font-bold mb-10 text-center">How it works</h2>
          <div className="grid md:grid-cols-4 gap-6">
            {process.map(([title, desc], i) => (
              <div key={title} className="bg-white rounded-xl p-6 border border-slate-100">
                <div className="w-8 h-8 rounded-full bg-brand text-white text-sm font-bold flex items-center justify-center mb-4">
                  {i + 1}
                </div>
                <h3 className="font-semibold mb-2">{title}</h3>
                <p className="text-sm text-slate-600">{desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 text-center border-t border-slate-100">
        <Container>
          <h2 className="text-3xl font-bold mb-4">Tell us what you&apos;re trying to build.</h2>
          <CTAButton href="/contact">Request a Custom Software Consultation</CTAButton>
        </Container>
      </section>
    </>
  );
}

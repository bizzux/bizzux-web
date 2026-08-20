import { Container, Eyebrow, CTAButton } from "@/components/Section";
import { IconMail, IconTeam, IconDatabase, IconLayers } from "@/components/Icons";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Microsoft 365 Setup | Bizzux",
  description:
    "Get a professional business identity with your own domain email, Microsoft Teams, OneDrive and SharePoint, set up by Bizzux.",
};

const setupItems = [
  { icon: IconMail, title: "Custom email", desc: "you@yourbusiness.com" },
  { icon: IconTeam, title: "Microsoft Teams", desc: "Chat, calls and meetings" },
  { icon: IconDatabase, title: "OneDrive cloud storage", desc: "1 TB per user" },
  { icon: IconLayers, title: "SharePoint", desc: "Shared files and internal collaboration" },
];

export default function Microsoft365Page() {
  return (
    <>
      <section className="pt-12 pb-10 bg-gradient-to-b from-teal-50/60 to-white text-center">
        <Container>
          <Eyebrow>Microsoft 365 Solutions</Eyebrow>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
            Make your business look and work like a professional company.
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto mb-8">
            Stop using yourbusiness@gmail.com for your business. Get a professional business identity with your
            own domain email, cloud storage and collaboration tools.
          </p>
          <CTAButton href="/contact">Set Up Professional Email</CTAButton>
        </Container>
      </section>

      <section className="py-14 border-t border-slate-100">
        <Container>
          <h2 className="text-2xl font-bold mb-2 text-center">Microsoft 365 Business Setup</h2>
          <p className="text-slate-600 text-center max-w-xl mx-auto mb-9">We help businesses set up and configure:</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {setupItems.map((f) => (
              <div key={f.title} className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm text-center hover:shadow-md transition-shadow">
                <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-brand-teal to-brand-blue text-white flex items-center justify-center mb-4 mx-auto">
                  <f.icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold mb-1">{f.title}</h3>
                <p className="text-sm text-slate-600">{f.desc}</p>
              </div>
            ))}
          </div>
          <ul className="max-w-xl mx-auto space-y-2 text-sm text-slate-600 text-center">
            <li>Outlook, Word, Excel and PowerPoint web/mobile access</li>
            <li>User setup, domain configuration and basic administration</li>
            <li>Integration with your website or custom application where needed</li>
          </ul>
        </Container>
      </section>

      <section className="py-14 pb-24 bg-slate-50">
        <Container className="max-w-3xl">
          <h2 className="text-2xl font-bold mb-8 text-center">Microsoft 365 Business Basic</h2>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-slate-100">
                  <td className="py-4 px-6 font-medium text-slate-700 w-1/2">Microsoft 365 Business Basic subscription</td>
                  <td className="py-4 px-6 text-ink font-semibold">₹170/user/month, paid yearly</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-4 px-6 font-medium text-slate-700">Includes</td>
                  <td className="py-4 px-6 text-slate-600">Custom email, Teams, OneDrive 1 TB/user, SharePoint, web/mobile Office apps</td>
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
              Microsoft 365 subscription fees are charged separately and billed annually. Bizzux charges a
              one-time implementation fee for domain configuration, account setup, Teams, OneDrive, SharePoint
              and required integrations. GST applies as applicable.
            </p>
            <p>
              Microsoft currently lists Business Basic in India at ₹170 per user/month with annual billing, plus
              applicable GST; it includes custom business email, 1 TB storage per user and Teams.
            </p>
          </div>
          <div className="mt-10 text-center">
            <CTAButton href="/contact">Set Up Professional Email</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}

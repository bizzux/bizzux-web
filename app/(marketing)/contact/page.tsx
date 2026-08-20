import { Container, Eyebrow } from "@/components/Section";
import { IconWhatsApp, IconMail, IconLayers } from "@/components/Icons";
import ContactForm from "./ContactForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact | Bizzux",
  description: "Let's build what your business needs: Bizzux platform, custom AI solutions, or Microsoft 365 setup.",
};

export default function ContactPage() {
  return (
    <>
      <section className="pt-12 pb-10 bg-navy text-white text-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-30" style={{
          background: "radial-gradient(55% 55% at 50% 0%, rgba(20,184,166,0.3) 0%, transparent 65%)"
        }} />
        <Container className="relative max-w-2xl">
          <Eyebrow light>Contact</Eyebrow>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
            Let&apos;s build what your business needs.
          </h1>
          <p className="text-lg text-slate-300 mb-8">
            Whether you need Bizzux for daily business management, a professional Microsoft 365 setup, an
            e-commerce website or a custom AI-enabled application, our team can help.
          </p>
          <a
            href="https://wa.me/919591222422"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-green-600 text-white font-semibold px-6 py-3 text-sm hover:bg-green-700 transition-colors"
          >
            <IconWhatsApp className="w-4 h-4" />
            Chat on WhatsApp
          </a>
        </Container>
      </section>

      <section className="py-14 pb-24">
        <Container className="grid lg:grid-cols-5 gap-10 max-w-5xl">
          <div className="lg:col-span-2">
            <h2 className="text-xl font-bold mb-4">Reach us directly</h2>
            <div className="space-y-4 text-sm">
              <a href="https://wa.me/919591222422" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-slate-700 hover:text-green-600 transition-colors">
                <IconWhatsApp className="w-5 h-5 text-green-600" />
                +91 95912 22422
              </a>
              <a href="mailto:sales@bizzux.com" className="flex items-center gap-3 text-slate-700 hover:text-brand-blue transition-colors">
                <IconMail className="w-5 h-5 text-brand-blue" />
                sales@bizzux.com
              </a>
              <div className="flex items-center gap-3 text-slate-700">
                <IconLayers className="w-5 h-5 text-brand-teal" />
                www.bizzux.com
              </div>
            </div>
            <p className="text-sm text-slate-500 mt-8">
              Or fill out the form and tell us about your business, products, number of shops and current
              challenges. We&apos;ll show you how Bizzux can be configured around the way you work.
            </p>
          </div>
          <div className="lg:col-span-3">
            <ContactForm />
          </div>
        </Container>
      </section>
    </>
  );
}

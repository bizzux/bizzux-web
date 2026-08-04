import { Container, Eyebrow } from "@/components/Section";
import ContactForm from "./ContactForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Book a demo — Bizzux",
  description: "Let's set up Bizzux for your business.",
};

export default function ContactPage() {
  return (
    <section className="py-20">
      <Container className="grid lg:grid-cols-5 gap-12 max-w-5xl">
        <div className="lg:col-span-2">
          <Eyebrow>Get in touch</Eyebrow>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
            Let&apos;s set up Bizzux for your business.
          </h1>
          <p className="text-slate-600 mb-8">
            Tell us about your business, products, number of shops and current challenges. We will show you how
            Bizzux can be configured around the way you work.
          </p>
          <div className="space-y-2 text-sm text-slate-600">
            <p><span className="font-semibold text-ink">Phone:</span> 9591222422</p>
            <p><span className="font-semibold text-ink">Email:</span> sales@bizzux.com</p>
            <p><span className="font-semibold text-ink">Website:</span> www.bizzux.com</p>
          </div>
        </div>
        <div className="lg:col-span-3">
          <ContactForm />
        </div>
      </Container>
    </section>
  );
}

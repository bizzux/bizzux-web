import { Container, Eyebrow } from "@/components/Section";
import ContactForm from "./ContactForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact — Bizzux",
  description: "Start your free trial or request a custom software consultation.",
};

export default function ContactPage() {
  return (
    <section className="py-20">
      <Container className="max-w-2xl">
        <div className="text-center mb-10">
          <Eyebrow>Get in touch</Eyebrow>
          <h1 className="text-4xl font-extrabold tracking-tight mb-4">
            Let&apos;s talk about your business.
          </h1>
          <p className="text-slate-600">
            Whether you want to start free with the Bizzux platform or talk through
            a custom build, tell us a bit about what you need.
          </p>
        </div>
        <ContactForm />
      </Container>
    </section>
  );
}

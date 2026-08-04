import { Container, Eyebrow, CTAButton } from "@/components/Section";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in — Bizzux",
};

export default function SignInPage() {
  return (
    <section className="py-24 text-center">
      <Container className="max-w-xl">
        <Eyebrow>Sign in</Eyebrow>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">Sign-in is coming soon.</h1>
        <p className="text-slate-600 mb-8">
          Already a Bizzux customer? Contact us and we&apos;ll get you access to your account.
        </p>
        <CTAButton href="/contact">Contact us</CTAButton>
      </Container>
    </section>
  );
}

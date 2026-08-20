import { Container, Eyebrow } from "@/components/Section";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Bizzux",
  description: "How Bizzux collects, uses, and protects your information.",
};

const LAST_UPDATED = "August 20, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <h2 className="text-xl font-bold text-ink mb-3">{title}</h2>
      <div className="text-slate-600 leading-relaxed space-y-3">{children}</div>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <section className="pt-14 pb-12 bg-navy text-white relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-30"
          style={{ background: "radial-gradient(60% 60% at 50% 0%, rgba(20,184,166,0.3) 0%, transparent 70%)" }}
        />
        <Container className="relative text-center max-w-2xl">
          <Eyebrow light>Legal</Eyebrow>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">Privacy Policy</h1>
          <p className="text-slate-300">Last updated: {LAST_UPDATED}</p>
        </Container>
      </section>

      <section className="py-14">
        <Container className="max-w-3xl">
          <Section title="1. Introduction">
            <p>
              This Privacy Policy explains how Bizzux (&quot;Bizzux&quot;, &quot;we&quot;, &quot;us&quot;, or
              &quot;our&quot;) collects, uses, and protects information when you use our business management
              platform and related apps (the &quot;Service&quot;). By using the Service, you agree to the
              collection and use of information as described here.
            </p>
          </Section>

          <Section title="2. Information we collect">
            <p>We collect the following categories of information:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <span className="font-semibold text-slate-700">Account information:</span> name, email address,
                phone number, and password (handled securely through Google Firebase Authentication; we never see
                or store your raw password), collected when you sign up or sign in with Google.
              </li>
              <li>
                <span className="font-semibold text-slate-700">Business data:</span> the sales, inventory,
                expense, customer, and other records you or your team enter into the Service.
              </li>
              <li>
                <span className="font-semibold text-slate-700">Billing information:</span> your subscription plan
                and payment status; card and bank details are collected and processed directly by our payment
                providers (Razorpay and/or Stripe), not stored on our own servers.
              </li>
              <li>
                <span className="font-semibold text-slate-700">Career application data:</span> if you apply for a
                role with us, the details and resume file you submit through our careers page.
              </li>
              <li>
                <span className="font-semibold text-slate-700">Usage data:</span> how you interact with the
                Service (pages visited, features used, device and browser information), used to keep the Service
                reliable and to improve it.
              </li>
            </ul>
          </Section>

          <Section title="3. How we use your information">
            <p>We use the information we collect to:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Provide, maintain, and secure the Service, including authenticating your sign-in.</li>
              <li>Process your subscription, trial, and payments, and communicate about your account.</li>
              <li>Respond to support requests and career applications.</li>
              <li>Understand usage patterns so we can improve performance and features.</li>
              <li>Meet legal, tax, and regulatory obligations.</li>
            </ul>
          </Section>

          <Section title="4. How we store and protect your information">
            <p>
              Your account data and business records are stored using Google Firebase (Authentication and
              Firestore), and the Service itself is hosted on Vercel. Career application resumes are stored using
              Vercel Blob storage, accessible only to authorized Bizzux administrators. We apply
              industry-standard technical and organizational safeguards, including access controls and encrypted
              connections, to help protect your information, though no method of transmission or storage is ever
              completely secure.
            </p>
          </Section>

          <Section title="5. Third-party service providers">
            <p>
              We rely on trusted providers to operate the Service, and limited information is shared with them only
              as needed to provide their part of the Service:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Google Firebase: authentication and database hosting.</li>
              <li>Vercel: application hosting, and Blob storage for uploaded files.</li>
              <li>Razorpay and Stripe: payment processing for subscriptions.</li>
              <li>WhatsApp Business: optional support and sales communication, if you choose to contact us that way.</li>
            </ul>
            <p>Each of these providers has its own privacy practices governing the information it processes on our behalf.</p>
          </Section>

          <Section title="6. Data sharing and disclosure">
            <p>
              We do not sell your personal or business data. We only share information with the third-party
              providers listed above, with your explicit consent, or where required to comply with a legal
              obligation, protect our rights, or prevent fraud or harm.
            </p>
          </Section>

          <Section title="7. Data retention">
            <p>
              We keep your account and business data for as long as your account is active, and for a reasonable
              period afterward to meet legal, accounting, or dispute-resolution needs. You can request deletion of
              your account and associated data at any time (see &quot;Your rights&quot; below).
            </p>
          </Section>

          <Section title="8. Your rights and choices">
            <p>
              Depending on where you're located, you may have the right to access, correct, export, or delete your
              personal information, or to object to or restrict certain processing. You can update most account
              details yourself from your{" "}
              <a href="/profile" className="text-brand-blue hover:underline">profile</a>. For anything else,
              including a full data export or account deletion request, contact us at{" "}
              <a href="mailto:sales@bizzux.com" className="text-brand-blue hover:underline">sales@bizzux.com</a>{" "}
              and we'll respond within a reasonable time.
            </p>
          </Section>

          <Section title="9. Cookies">
            <p>
              We use essential cookies and similar technologies to keep you signed in and to remember your
              preferences. We do not use cookies to sell your data to advertisers.
            </p>
          </Section>

          <Section title="10. Children's privacy">
            <p>
              The Service is intended for business use by adults and is not directed at children. We do not
              knowingly collect personal information from anyone under the age of 18.
            </p>
          </Section>

          <Section title="11. International data transfers">
            <p>
              Our infrastructure providers may process and store data in locations outside your own country. Where
              this happens, we rely on those providers' own safeguards for cross-border data transfers.
            </p>
          </Section>

          <Section title="12. Changes to this policy">
            <p>
              We may update this Privacy Policy from time to time. If we make material changes, we will update the
              &quot;Last updated&quot; date above and, where appropriate, notify you through the Service or by
              email.
            </p>
          </Section>

          <Section title="13. Contact us">
            <p>
              Questions about this Privacy Policy or your data can be sent to{" "}
              <a href="mailto:sales@bizzux.com" className="text-brand-blue hover:underline">sales@bizzux.com</a>, or
              via{" "}
              <a
                href="https://wa.me/919591222422"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-blue hover:underline"
              >
                WhatsApp
              </a>
              .
            </p>
          </Section>
        </Container>
      </section>
    </>
  );
}

import { Container, Eyebrow } from "@/components/Section";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Bizzux",
  description: "The terms that govern your use of the Bizzux business management platform.",
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

export default function TermsPage() {
  return (
    <>
      <section className="pt-14 pb-12 bg-navy text-white relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-30"
          style={{ background: "radial-gradient(60% 60% at 50% 0%, rgba(18,166,149,0.3) 0%, transparent 70%)" }}
        />
        <Container className="relative text-center max-w-2xl">
          <Eyebrow light>Legal</Eyebrow>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">Terms of Service</h1>
          <p className="text-slate-300">Last updated: {LAST_UPDATED}</p>
        </Container>
      </section>

      <section className="py-14">
        <Container className="max-w-3xl">
          <Section title="1. Agreement to these terms">
            <p>
              These Terms of Service (&quot;Terms&quot;) govern your access to and use of Bizzux, a cloud-based
              business management platform for point of sale, inventory, expense and profit tracking, and related
              apps and services (together, the &quot;Service&quot;), provided by Bizzux (&quot;Bizzux&quot;,
              &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).
            </p>
            <p>
              By creating an account, starting a free trial, or otherwise using the Service, you agree to be bound
              by these Terms and by our{" "}
              <a href="/privacy" className="text-brand-blue hover:underline">Privacy Policy</a>. If you are using
              the Service on behalf of a business or organization, you confirm that you have the authority to bind
              that organization to these Terms.
            </p>
          </Section>

          <Section title="2. Description of the Service">
            <p>
              Bizzux provides a cloud-based platform for running day-to-day business operations, including point of
              sale, inventory management, expense tracking and profit reporting, along with additional apps we make
              available under your account from time to time. We may add, change, or discontinue features of the
              Service, and may introduce new apps or retire existing ones, provided we give reasonable notice where
              the change materially affects your use of a paid feature.
            </p>
          </Section>

          <Section title="3. Accounts and eligibility">
            <p>
              You must provide accurate information when creating an account and keep your login credentials
              confidential. You are responsible for all activity that happens under your account, including actions
              taken by team members you invite. Let us know right away at{" "}
              <a href="mailto:sales@bizzux.com" className="text-brand-blue hover:underline">sales@bizzux.com</a>{" "}
              if you suspect unauthorized access.
            </p>
            <p>
              The Service is intended for business use by adults capable of forming a binding contract. It is not
              directed at, and should not be used by, anyone under the age of 18.
            </p>
          </Section>

          <Section title="4. Free trial and subscription plans">
            <p>
              New accounts start with a free trial period. Once your trial ends, continued access to live apps
              requires an active subscription plan. Subscription fees, billing cycles and plan features are shown
              on our{" "}
              <a href="/pricing" className="text-brand-blue hover:underline">pricing page</a> and may be updated
              from time to time; changes to your own plan's pricing will not take effect until your next renewal.
            </p>
            <p>
              Payments are processed by third-party payment providers (Razorpay and/or Stripe, depending on your
              region). We do not store your full card or bank details on our own servers. Except where required by
              law or expressly stated otherwise, fees already paid are non-refundable.
            </p>
          </Section>

          <Section title="5. Acceptable use">
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Break any applicable law, or infringe another party's intellectual property or privacy rights.</li>
              <li>Upload malicious code, attempt to gain unauthorized access, or disrupt the Service's operation.</li>
              <li>Resell, sublicense, or provide the Service to third parties outside your own organization without our written consent.</li>
              <li>Reverse-engineer or attempt to extract the underlying source code of the Service, except as permitted by law.</li>
            </ul>
            <p>We may suspend or terminate access for accounts that violate this section.</p>
          </Section>

          <Section title="6. Team members and roles">
            <p>
              Account owners and admins can invite team members and assign them roles with different levels of
              access. You are responsible for managing who has access to your account and for removing access when
              a team member no longer needs it.
            </p>
          </Section>

          <Section title="7. Your data and content">
            <p>
              You retain ownership of the business data you enter into the Service (sales, inventory, expenses,
              customer records, and similar). You grant us a limited license to host, process, and display that
              data solely to provide and improve the Service to you. We do not sell your business data.
            </p>
            <p>
              You are responsible for the accuracy and legality of the data you upload, including ensuring you have
              the right to store any customer or third-party information within the Service.
            </p>
          </Section>

          <Section title="8. Intellectual property">
            <p>
              The Service, including its software, design, branding, and documentation, is owned by Bizzux and
              protected by intellectual property laws. These Terms do not grant you any rights to our trademarks or
              branding beyond what is necessary to use the Service as intended.
            </p>
          </Section>

          <Section title="9. Third-party services">
            <p>
              The Service relies on trusted third-party infrastructure to operate, including cloud hosting and
              authentication (such as Google Firebase), application hosting (such as Vercel), payment processing
              (such as Razorpay and Stripe), and messaging (such as WhatsApp Business). Your use of the Service may
              be subject to those providers' own terms where you interact with them directly.
            </p>
          </Section>

          <Section title="10. Service availability">
            <p>
              We aim to keep the Service available and reliable, but we do not guarantee uninterrupted or error-free
              operation. We may perform maintenance, and features may occasionally be unavailable, with as much
              advance notice as is reasonably practical.
            </p>
          </Section>

          <Section title="11. Limitation of liability">
            <p>
              To the fullest extent permitted by law, Bizzux and its team are not liable for indirect, incidental,
              or consequential damages arising from your use of the Service. Our total liability for any claim
              relating to the Service is limited to the amount you paid us for the Service in the twelve months
              before the claim arose.
            </p>
          </Section>

          <Section title="12. Termination">
            <p>
              You may stop using the Service and cancel your subscription at any time from your account. We may
              suspend or terminate your access if you breach these Terms, if required by law, or if your account
              has been inactive with a lapsed trial or subscription for an extended period, after reasonable notice
              where practical.
            </p>
          </Section>

          <Section title="13. Governing law">
            <p>
              These Terms are governed by the laws of India, without regard to its conflict of law principles. Any
              disputes arising from these Terms or the Service will be subject to the exclusive jurisdiction of the
              courts located in India.
            </p>
          </Section>

          <Section title="14. Changes to these terms">
            <p>
              We may update these Terms from time to time. If we make material changes, we will update the &quot;Last
              updated&quot; date above and, where appropriate, notify you through the Service or by email. Continued
              use of the Service after changes take effect means you accept the updated Terms.
            </p>
          </Section>

          <Section title="15. Contact us">
            <p>
              Questions about these Terms can be sent to{" "}
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

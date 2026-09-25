import type { Metadata } from "next";
import { Container, CTAButton } from "@/components/Section";
import { CompanyHero } from "@/components/CompanyBlocks";

export const metadata: Metadata = {
  title: "Events | Bizzux",
  description: "Bizzux product demos, workshops and events for business owners.",
};

// No events are scheduled yet — this is an honest empty state rather than
// placeholder events. When real events exist, list them above the demo card.
export default function EventsPage() {
  return (
    <>
      <CompanyHero eyebrow="Events" title="Demos, workshops and events.">
        Hands-on sessions to help business owners get more out of Bizzux and AI.
      </CompanyHero>

      <section className="py-16 pb-24">
        <Container className="max-w-2xl">
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-8 text-center">
            <h2 className="text-xl font-bold mb-2">No upcoming events right now</h2>
            <p className="text-slate-600 mb-6">
              New events will be announced here. In the meantime, book a free one-to-one live demo and we&apos;ll
              walk you through Bizzux for your business.
            </p>
            <CTAButton href="/contact">Book a live demo</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}

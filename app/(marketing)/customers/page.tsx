import Link from "next/link";
import type { Metadata } from "next";
import { Container, CTAButton } from "@/components/Section";
import { CompanyHero, ReviewCards } from "@/components/CompanyBlocks";
import { IconJuice, IconBakery, IconRestaurant, IconStore, IconLayers, IconSpark } from "@/components/Icons";
import { getApprovedReviews, getCustomerLogos } from "@/lib/companyData";
import CustomerMarquee from "@/components/CustomerMarquee";

export const metadata: Metadata = {
  title: "Customers | Bizzux",
  description: "The businesses Bizzux is built for: shops, cafés, restaurants, bakeries, retail stores and growing multi-branch businesses.",
};

// Shows the latest approved reviews; the admin reviews API revalidates this page.
export const revalidate = 60;

// Same business types as /solutions — who Bizzux is built for. Real
// customer names/logos come only from /admin → Customers (the marquee).
const segments = [
  { icon: IconJuice, title: "Juice and beverage shops", desc: "Fast billing, daily sales and stock of fruit and supplies." },
  { icon: IconBakery, title: "Tea shops and cafés", desc: "Quick counter sales, menu items and daily expense tracking." },
  { icon: IconRestaurant, title: "Restaurants and fast food", desc: "POS, digital menu, self-ordering and profit visibility." },
  { icon: IconBakery, title: "Bakeries and snack shops", desc: "Expiry alerts, low-stock warnings and purchase tracking." },
  { icon: IconStore, title: "Retail and provision stores", desc: "Inventory, customer dues, vendor balances and reports." },
  { icon: IconLayers, title: "Multi-branch businesses", desc: "Every shop, every staff member and every rupee in one view." },
  { icon: IconSpark, title: "Growing teams", desc: "CRM, projects, files and AI apps as the business scales." },
];

export default async function CustomersPage() {
  const [reviews, logos] = await Promise.all([getApprovedReviews(3), getCustomerLogos()]);
  return (
    <>
      <CompanyHero eyebrow="Customers" title="Built for businesses that sell every day.">
        From a single juice counter to a multi-branch retail business, Bizzux gives owners one place to run the
        whole business.
      </CompanyHero>

      <div className="border-b border-slate-100">
        <CustomerMarquee logos={logos} title="Businesses running on Bizzux" />
      </div>

      <section className="py-14">
        <Container>
          <h2 className="text-2xl font-bold mb-8 text-center">Who uses Bizzux</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {segments.map((s) => (
              <div key={s.title} className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-brand-tealDark to-brand-blueDark text-white flex items-center justify-center mb-4">
                  <s.icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold mb-1">{s.title}</h3>
                <p className="text-sm text-slate-600">{s.desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {reviews.length > 0 && (
        <section className="py-14 bg-slate-50 border-t border-slate-100">
          <Container>
            <h2 className="text-2xl font-bold mb-8 text-center">In their words</h2>
            <ReviewCards reviews={reviews} />
            <div className="text-center mt-8">
              <Link href="/reviews" className="text-sm font-semibold text-brand-blue hover:text-brand-teal">
                Read all customer reviews &rarr;
              </Link>
            </div>
          </Container>
        </section>
      )}

      <section className="py-14 pb-24 text-center border-t border-slate-100">
        <Container>
          <h2 className="text-2xl font-bold mb-3">See how Bizzux fits your business</h2>
          <p className="text-slate-600 mb-6">Start a free trial, or book a demo and we&apos;ll walk you through it.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <CTAButton href="/sign-in?mode=signup">Start Free Trial</CTAButton>
            <CTAButton href="/contact" variant="secondary">Book a Demo</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}

import Image from "next/image";
import Link from "next/link";
import { Container, Eyebrow, BrandTagline, CTAButton } from "@/components/Section";
import type { Metadata } from "next";
import { getTeam, getApprovedReviews } from "@/lib/companyData";
import { LeaderCard, ReviewCards } from "@/components/CompanyBlocks";
import { COMPANY_LINE, BRAND_TAGLINE } from "@/lib/brand";

export const metadata: Metadata = {
  title: `About | Bizzux, ${BRAND_TAGLINE}`,
  description: `${COMPANY_LINE}`,
};

// Team and reviews are edited from /admin, so this page can't be frozen at
// build time. The admin team/reviews APIs revalidate it after every write
// (see COMPANY_DATA_PATHS); this is the fallback.
export const revalidate = 60;

const beliefs = [
  "Technology should simplify work, not add complexity.",
  "Small businesses deserve professional digital tools.",
  "AI should solve real problems and improve decisions.",
  "Security, ownership and scalability should be built in from the beginning.",
];

function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div className="text-center mt-8">
      <Link href={href} className="text-sm font-semibold text-brand-blue hover:text-brand-teal">
        {children} &rarr;
      </Link>
    </div>
  );
}

export default async function AboutPage() {
  const [team, reviews] = await Promise.all([getTeam(), getApprovedReviews(3)]);
  // A short preview here; the full list lives on /leadership.
  const leaders = [...team.filter((m) => m.isCEO), ...team.filter((m) => !m.isCEO)].slice(0, 3);
  return (
    <>
      <section className="pt-14 pb-14 bg-navy text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30" style={{
          background: "radial-gradient(60% 60% at 50% 0%, rgba(18,166,149,0.3) 0%, transparent 70%)"
        }} />
        <Container className="relative text-center max-w-3xl">
          <BrandTagline light />
          <Eyebrow light>About Bizzux</Eyebrow>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-6">
            We build cloud and AI-enabled solutions for growing businesses.
          </h1>
          <p className="text-lg text-slate-300 mb-4">
            {COMPANY_LINE}
          </p>
          <p className="text-slate-400">
            We offer a connected suite of business apps for CRM, sales, POS, inventory, billing, expenses, projects
            and files. We also design custom software, AI-enabled applications, e-commerce websites and secure
            cloud solutions for businesses with unique requirements.
          </p>
          <div className="mt-8 flex justify-center">
            <Image src="/logo-transparent.png" alt="Bizzux" width={200} height={82} className="h-12 w-auto" />
          </div>
        </Container>
      </section>

      <section className="py-14 border-b border-slate-100">
        <Container className="text-center max-w-xl">
          <h2 className="text-2xl font-bold mb-4">Our approach is simple</h2>
          <p className="text-xl font-semibold bg-gradient-to-r from-brand-tealDark via-brand-cyanDark to-brand-blueDark bg-clip-text text-transparent">
            Understand the business. Build the right solution. Make growth visible.
          </p>
        </Container>
      </section>

      <section className="py-14 bg-slate-50">
        <Container>
          <h2 className="text-2xl font-bold mb-8 text-center">What we believe</h2>
          <div className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {beliefs.map((b) => (
              <div key={b} className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <p className="text-slate-700">{b}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {leaders.length > 0 && (
        <section className="py-14 border-t border-slate-100">
          <Container>
            <h2 className="text-2xl font-bold mb-8 text-center">The people behind Bizzux</h2>
            <div className={`grid gap-6 mx-auto ${leaders.length === 1 ? "max-w-sm" : "sm:grid-cols-2 lg:grid-cols-3 max-w-4xl"}`}>
              {leaders.map((m) => <LeaderCard key={m.id} m={m} />)}
            </div>
            <MoreLink href="/leadership">Meet the leadership team</MoreLink>
          </Container>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="py-14 bg-slate-50 border-t border-slate-100">
          <Container>
            <h2 className="text-2xl font-bold mb-8 text-center">What people say</h2>
            <ReviewCards reviews={reviews} />
            <MoreLink href="/reviews">Read all reviews or write one</MoreLink>
          </Container>
        </section>
      )}

      <section className="py-14 pb-24 text-center">
        <Container>
          <h2 className="text-2xl font-bold mb-6">Want to see it for your business?</h2>
          <CTAButton href="/contact">Book a demo</CTAButton>
        </Container>
      </section>
    </>
  );
}

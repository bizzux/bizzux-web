import type { Metadata } from "next";
import { Container, CTAButton } from "@/components/Section";
import { CompanyHero, LeaderCard } from "@/components/CompanyBlocks";
import { getTeam } from "@/lib/companyData";
import { LEGAL_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Leadership Team | Bizzux",
  description: `Meet the people leading Bizzux and ${LEGAL_NAME}.`,
};

// Team is edited from /admin → Team; the admin API revalidates this page.
export const revalidate = 60;

export default async function LeadershipPage() {
  const team = await getTeam();
  const ceo = team.filter((m) => m.isCEO);
  const others = team.filter((m) => !m.isCEO);
  return (
    <>
      <CompanyHero eyebrow="Leadership Team" title="The people building Bizzux.">
        A small team with a clear goal: give every growing business professional, AI-ready software.
      </CompanyHero>

      <section className="py-14">
        <Container>
          {team.length === 0 ? (
            <p className="text-center text-slate-500">Our leadership profiles are coming soon.</p>
          ) : (
            <>
              {ceo.length > 0 && (
                <div className="max-w-md mx-auto mb-10 grid gap-6">
                  {ceo.map((m) => <LeaderCard key={m.id} m={m} large />)}
                </div>
              )}
              {others.length > 0 && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {others.map((m) => <LeaderCard key={m.id} m={m} />)}
                </div>
              )}
            </>
          )}
        </Container>
      </section>

      <section className="py-14 pb-24 bg-slate-50 text-center border-t border-slate-100">
        <Container>
          <h2 className="text-2xl font-bold mb-3">Want to build with us?</h2>
          <p className="text-slate-600 mb-6">We&apos;re always open to talented people who care about small businesses.</p>
          <CTAButton href="/careers">See careers</CTAButton>
        </Container>
      </section>
    </>
  );
}

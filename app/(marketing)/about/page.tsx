import Image from "next/image";
import { Container, Eyebrow, CTAButton } from "@/components/Section";
import type { Metadata } from "next";
import { adminDb } from "@/lib/firebaseAdmin";
import ReviewForm from "@/components/ReviewForm";

export const metadata: Metadata = {
  title: "About | Bizzux",
  description: "We build cloud and AI-enabled solutions for growing businesses.",
};

const beliefs = [
  "Technology should simplify work, not add complexity.",
  "Small businesses deserve professional digital tools.",
  "AI should solve real problems and improve decisions.",
  "Security, ownership and scalability should be built in from the beginning.",
];

type TeamMember = {
  id: string;
  name: string;
  role?: string;
  bio?: string;
  photoUrl?: string | null;
  isCEO?: boolean;
};

type Review = {
  id: string;
  name: string;
  photoUrl?: string | null;
  rating: number;
  text: string;
};

// Rendered server-side with the Admin SDK, same pattern the homepage's
// generateMetadata already uses — no client fetch/loading state needed for
// content that's the same for every visitor, and it's managed from
// /admin (Team / Reviews tabs, Platform Owner/Admin only).
async function getTeam(): Promise<TeamMember[]> {
  try {
    const snap = await adminDb().collection("team").orderBy("order", "asc").get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamMember);
  } catch {
    return [];
  }
}

async function getApprovedReviews(): Promise<Review[]> {
  try {
    // Filtering in JS instead of where("status","==","approved").orderBy
    // ("createdAt") avoids needing a composite Firestore index just for
    // this one query — fine at this volume (a marketing site's reviews),
    // and status/order can change without touching Firestore config.
    const snap = await adminDb().collection("reviews").orderBy("createdAt", "desc").limit(50).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as Review & { status?: string })
      .filter((r) => r.status === "approved")
      .slice(0, 12);
  } catch {
    return [];
  }
}

export default async function AboutPage() {
  const [team, reviews] = await Promise.all([getTeam(), getApprovedReviews()]);
  const ceo = team.find((m) => m.isCEO);
  const staff = team.filter((m) => !m.isCEO);
  return (
    <>
      <section className="pt-14 pb-14 bg-navy text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30" style={{
          background: "radial-gradient(60% 60% at 50% 0%, rgba(18,166,149,0.3) 0%, transparent 70%)"
        }} />
        <Container className="relative text-center max-w-3xl">
          <Eyebrow light>About Bizzux</Eyebrow>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-6">
            We build cloud and AI-enabled solutions for growing businesses.
          </h1>
          <p className="text-lg text-slate-300 mb-4">
            Bizzux is a cloud software and AI solutions company focused on helping businesses run better today
            and build for tomorrow.
          </p>
          <p className="text-slate-400">
            We offer a ready-to-use business management platform for sales, inventory, expenses and profit. We
            also design custom software, AI-enabled applications, e-commerce websites and secure cloud solutions
            for businesses with unique requirements.
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

      {team.length > 0 && (
        <section className="py-14 border-t border-slate-100">
          <Container>
            <h2 className="text-2xl font-bold mb-8 text-center">The people behind Bizzux</h2>

            {ceo && (
              <div className="max-w-sm mx-auto mb-10 text-center">
                <div className="w-28 h-28 rounded-full overflow-hidden bg-slate-100 mx-auto mb-4 border-4 border-white shadow-lg">
                  {ceo.photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ceo.photoUrl} alt={ceo.name} className="w-full h-full object-cover" />
                  )}
                </div>
                <p className="font-bold text-lg">{ceo.name}</p>
                <p className="text-brand-blue text-sm font-semibold mb-2">{ceo.role || "Founder & CEO"}</p>
                {ceo.bio && <p className="text-slate-600 text-sm max-w-xs mx-auto">{ceo.bio}</p>}
              </div>
            )}

            {staff.length > 0 && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {staff.map((m) => (
                  <div key={m.id} className="text-center">
                    <div className="w-20 h-20 rounded-full overflow-hidden bg-slate-100 mx-auto mb-3">
                      {m.photoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.photoUrl} alt={m.name} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <p className="font-semibold text-sm">{m.name}</p>
                    <p className="text-slate-500 text-xs">{m.role}</p>
                  </div>
                ))}
              </div>
            )}
          </Container>
        </section>
      )}

      <section className="py-14 bg-slate-50 border-t border-slate-100">
        <Container>
          <h2 className="text-2xl font-bold mb-8 text-center">What people say</h2>
          {reviews.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
              {reviews.map((r) => (
                <div key={r.id} className="bg-white rounded-xl p-5 border border-slate-100 shadow-sm">
                  <p className="text-amber-400 mb-2">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</p>
                  <p className="text-slate-700 text-sm mb-4">&ldquo;{r.text}&rdquo;</p>
                  <div className="flex items-center gap-2">
                    {r.photoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.photoUrl} alt="" className="w-7 h-7 rounded-full" />
                    )}
                    <span className="text-xs font-semibold text-slate-600">{r.name}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <ReviewForm />
        </Container>
      </section>

      <section className="py-14 pb-24 text-center">
        <Container>
          <h2 className="text-2xl font-bold mb-6">Want to see it for your business?</h2>
          <CTAButton href="/contact">Book a demo</CTAButton>
        </Container>
      </section>
    </>
  );
}

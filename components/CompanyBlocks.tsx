import type { Review, TeamMember } from "@/lib/companyData";
import { Container, Eyebrow, BrandTagline } from "@/components/Section";

// Shared renderers for the Company pages, so About / Leadership / Reviews /
// Customers / Events all look like one section of the site.

export function CompanyHero({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <section className="pt-14 pb-14 bg-navy text-white relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-30"
        style={{ background: "radial-gradient(60% 60% at 50% 0%, rgba(18,166,149,0.3) 0%, transparent 70%)" }}
      />
      <Container className="relative text-center max-w-3xl">
        <BrandTagline light />
        <Eyebrow light>{eyebrow}</Eyebrow>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">{title}</h1>
        {children && <div className="text-lg text-slate-300">{children}</div>}
      </Container>
    </section>
  );
}

export function ReviewCards({ reviews }: { reviews: Review[] }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
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
  );
}

export function LeaderCard({ m, large = false }: { m: TeamMember; large?: boolean }) {
  return (
    <div className={`text-center bg-white rounded-2xl border border-slate-100 shadow-sm ${large ? "p-8" : "p-6"}`}>
      <div
        className={`rounded-full overflow-hidden bg-slate-100 mx-auto mb-4 border-4 border-white shadow-md ${
          large ? "w-32 h-32" : "w-24 h-24"
        }`}
      >
        {m.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.photoUrl} alt={m.name} className="w-full h-full object-cover" />
        )}
      </div>
      <p className={`font-bold ${large ? "text-xl" : "text-base"}`}>{m.name}</p>
      <p className="text-brand-blue text-sm font-semibold mb-2">{m.role || (m.isCEO ? "Founder & CEO" : "")}</p>
      {m.bio && <p className="text-slate-600 text-sm max-w-md mx-auto">{m.bio}</p>}
    </div>
  );
}

import type { Metadata } from "next";
import { Container } from "@/components/Section";
import { CompanyHero, ReviewCards } from "@/components/CompanyBlocks";
import ReviewForm from "@/components/ReviewForm";
import { getApprovedReviews } from "@/lib/companyData";

export const metadata: Metadata = {
  title: "Customer Reviews | Bizzux",
  description: "What business owners say about Bizzux, and a place to share your own experience.",
};

// Reviews are moderated from /admin → Reviews; the admin API revalidates this page.
export const revalidate = 60;

export default async function ReviewsPage() {
  const reviews = await getApprovedReviews(60);
  return (
    <>
      <CompanyHero eyebrow="Customer Reviews" title="What people say about Bizzux.">
        Honest feedback from the businesses and people who use Bizzux every day.
      </CompanyHero>

      {reviews.length > 0 && (
        <section className="py-14">
          <Container>
            <ReviewCards reviews={reviews} />
          </Container>
        </section>
      )}

      <section className={`py-14 pb-24 bg-slate-50 ${reviews.length > 0 ? "border-t border-slate-100" : ""}`}>
        <Container>
          <h2 className="text-2xl font-bold mb-8 text-center">Used Bizzux? Share your experience</h2>
          <ReviewForm />
        </Container>
      </section>
    </>
  );
}

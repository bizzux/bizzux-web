import Link from "next/link";
import { Container, Eyebrow, CTAButton } from "@/components/Section";
import type { Metadata } from "next";
import { getPublishedPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Insights | Bizzux",
  description: "Practical guides for running a small shop, plus cybersecurity and AI insights from the Bizzux Technologies team.",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
}

export default async function ResourcesPage() {
  const posts = await getPublishedPosts();
  return (
    <section className="py-16 pb-24">
      <Container>
        <div className="text-center max-w-xl mx-auto mb-14">
          <Eyebrow>Insights</Eyebrow>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
            Practical guides, and what we're thinking about in security and AI.
          </h1>
          <p className="text-slate-600">
            Writing on running a small shop better, plus cybersecurity and AI perspectives from the Bizzux
            Technologies team — no fluff, either way.
          </p>
        </div>

        {posts.length === 0 ? (
          <div className="text-center">
            <p className="text-slate-600 mb-8">New guides are on the way. In the meantime, book a demo and we&apos;ll walk you through it directly.</p>
            <CTAButton href="/contact">Book a demo</CTAButton>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/resources/${post.slug}`}
                className="group block bg-white rounded-xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md hover:border-brand-blue/30 transition-all"
              >
                {post.coverImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.coverImage} alt="" className="w-full h-36 object-cover" />
                )}
                <div className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  {post.tags.map((tag) => (
                    <span key={tag} className="text-xs font-semibold uppercase tracking-wide text-brand-blue bg-brand-blue/10 rounded-full px-2.5 py-1">
                      {tag}
                    </span>
                  ))}
                </div>
                <h2 className="text-lg font-bold mb-2 group-hover:text-brand-blue transition-colors">{post.title}</h2>
                <p className="text-sm text-slate-600 mb-4 line-clamp-3">{post.excerpt}</p>
                <div className="text-xs text-slate-400 flex items-center gap-2">
                  <span>{formatDate(post.date)}</span>
                  <span>·</span>
                  <span>{post.readTime}</span>
                </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Container>
    </section>
  );
}

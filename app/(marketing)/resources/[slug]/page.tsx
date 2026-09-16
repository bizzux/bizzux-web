import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, Eyebrow, CTAButton } from "@/components/Section";
import type { Metadata } from "next";
import { getAllSlugs, getPost, posts, type BlockType } from "@/lib/blog";

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = getPost(params.slug);
  if (!post) return {};
  return {
    title: `${post.title} | Bizzux`,
    description: post.excerpt,
    alternates: { canonical: `https://bizzux.com/resources/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.date,
      url: `https://bizzux.com/resources/${post.slug}`,
    },
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
}

function Block({ block }: { block: BlockType }) {
  switch (block.type) {
    case "h2":
      return <h2 className="text-xl font-bold mt-10 mb-3">{block.text}</h2>;
    case "ul":
      return (
        <ul className="list-disc pl-5 space-y-2 my-4 text-slate-700">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote className="border-l-4 border-brand-blue/40 pl-5 my-6 text-slate-700 italic">
          {block.text}
        </blockquote>
      );
    default:
      return <p className="text-slate-700 leading-relaxed my-4">{block.text}</p>;
  }
}

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) notFound();

  const related = posts.filter((p) => p.slug !== post.slug).slice(0, 2);

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: { "@type": "Organization", name: "Bizzux" },
    publisher: { "@type": "Organization", name: "Bizzux" },
    mainEntityOfPage: `https://bizzux.com/resources/${post.slug}`,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />

      <article className="py-16 pb-24">
        <Container className="max-w-2xl">
          <Link href="/resources" className="text-sm text-brand-blue font-semibold hover:underline mb-6 inline-block">
            ← All resources
          </Link>

          <div className="flex items-center gap-2 mb-4">
            {post.tags.map((tag) => (
              <span key={tag} className="text-xs font-semibold uppercase tracking-wide text-brand-blue bg-brand-blue/10 rounded-full px-2.5 py-1">
                {tag}
              </span>
            ))}
          </div>

          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">{post.title}</h1>
          <div className="text-sm text-slate-400 mb-10">
            {formatDate(post.date)} · {post.readTime}
          </div>

          <div>
            {post.body.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </div>

          <div className="mt-14 pt-10 border-t border-slate-100 text-center">
            <h2 className="text-xl font-bold mb-4">Want to see this in practice?</h2>
            <CTAButton href="/contact">Book a demo</CTAButton>
          </div>

          {related.length > 0 && (
            <div className="mt-14 pt-10 border-t border-slate-100">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-4">Read next</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {related.map((r) => (
                  <Link
                    key={r.slug}
                    href={`/resources/${r.slug}`}
                    className="block bg-white rounded-xl p-5 border border-slate-100 shadow-sm hover:shadow-md hover:border-brand-blue/30 transition-all"
                  >
                    <p className="font-semibold mb-1">{r.title}</p>
                    <p className="text-xs text-slate-400">{r.readTime}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Container>
      </article>
    </>
  );
}

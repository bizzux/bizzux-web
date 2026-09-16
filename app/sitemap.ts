import type { MetadataRoute } from "next";
import { getPublishedPosts } from "@/lib/blog";

const marketingPages = [
  "",
  "about",
  "careers",
  "contact",
  "custom-software",
  "custom-solutions",
  "partners",
  "platform",
  "pricing",
  "privacy",
  "product",
  "resources",
  "solutions",
  "terms",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = marketingPages.map((path) => ({
    url: `https://bizzux.com/${path}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
  const posts = await getPublishedPosts();
  const blogPages: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `https://bizzux.com/resources/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: "monthly",
    priority: 0.6,
  }));
  return [...pages, ...blogPages];
}

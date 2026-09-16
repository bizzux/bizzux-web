import type { MetadataRoute } from "next";

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

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return marketingPages.map((path) => ({
    url: `https://bizzux.com/${path}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
}

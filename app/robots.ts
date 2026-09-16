import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin", "/api", "/dashboard", "/team", "/profile", "/sign-in",
        "/accept-invite", "/analytics", "/apps", "/change-password", "/files", "/notes",
        "/setup-2fa", "/verify-2fa", "/share",
      ],
    },
    sitemap: "https://bizzux.com/sitemap.xml",
  };
}

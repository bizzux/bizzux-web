import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "./globals.css";
import "./bzx-app.css";
import UpdateToast from "@/components/UpdateToast";
import { BRAND_TAGLINE, BRAND_DESCRIPTION, LEGAL_NAME } from "@/lib/brand";

// tailwind.config.ts's `sans` stack points at --font-inter, but nothing
// used to actually define that variable — it was silently falling back to
// each device's own default UI font (e.g. Segoe UI on Windows), which is
// why the "font style" looked inconsistent rather than deliberately
// on-brand. This wires up the real Inter font (self-hosted via
// @fontsource/inter — no Google Fonts network fetch needed at build time)
// and applies it site-wide, including the (saas) app section — see the
// `font-family: inherit` change in app/bzx-app.css.
export const metadata: Metadata = {
  title: `Bizzux | ${BRAND_TAGLINE}`,
  description: BRAND_DESCRIPTION,
  metadataBase: new URL("https://bizzux.com"),
  applicationName: "Bizzux",
  publisher: LEGAL_NAME,
  // favicon.ico, icon.png, and apple-icon.png are all auto-detected from the
  // app/ directory by Next.js's file convention — no metadata entry needed.
  openGraph: {
    title: `Bizzux | ${BRAND_TAGLINE}`,
    description: BRAND_DESCRIPTION,
    url: "https://bizzux.com",
    siteName: "Bizzux",
    type: "website",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: `Bizzux | ${BRAND_TAGLINE}`,
    description: BRAND_DESCRIPTION,
    images: ["/og-image.png"],
  },
  alternates: {
    canonical: "https://bizzux.com",
  },
};

// Organization structured data — tells Google explicitly that "Bizzux" is the
// brand/entity name for this domain, which is what exact-brand-name searches
// match against. Add real social profile URLs to `sameAs` once they exist;
// a fabricated one would do more harm than good.
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Bizzux",
  url: "https://bizzux.com",
  legalName: LEGAL_NAME,
  slogan: BRAND_TAGLINE,
  logo: "https://bizzux.com/bizzux-logo-full.png",
  address: { "@type": "PostalAddress", addressLocality: "Chennai", addressRegion: "Tamil Nadu", addressCountry: "IN" },
  description: BRAND_DESCRIPTION,
};

// Kept deliberately minimal — the marketing Nav/Footer chrome now lives in
// app/(marketing)/layout.tsx and the app-shell chrome for
// dashboard/team/profile/sign-in/etc. lives in app/(saas)/layout.js, so
// neither leaks into the other's routes. Route groups don't affect the URL,
// so every existing bizzux.com path is unchanged.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans bg-white text-ink">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        {children}
        <UpdateToast />
      </body>
    </html>
  );
}

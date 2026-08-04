import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Bizzux — Run your business smarter, every day.",
  description:
    "Bizzux is cloud-based POS, inventory, expense and profit management software for small and growing businesses.",
  metadataBase: new URL("https://bizzux.com"),
  icons: { icon: "/logo-transparent.png" },
  openGraph: {
    title: "Bizzux — Run your business smarter, every day.",
    description:
      "Cloud-based POS, inventory, expense and profit management software for small and growing businesses.",
    url: "https://bizzux.com",
    siteName: "Bizzux",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col font-sans bg-white text-ink">
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

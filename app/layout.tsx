import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Bizzux — Run Your Business. Build What's Next.",
  description:
    "Bizzux is an all-in-one business management platform with CRM, invoicing, scheduling, inventory, and HR — plus custom software development for businesses with unique needs.",
  metadataBase: new URL("https://bizzux.com"),
  openGraph: {
    title: "Bizzux — Run Your Business. Build What's Next.",
    description:
      "The all-in-one business management platform, plus custom software development.",
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

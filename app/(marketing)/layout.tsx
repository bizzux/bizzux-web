import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

// Route group (marketing) — every existing bizzux.com page keeps the shared
// Nav + Footer chrome it always had. This layout was moved out of the root
// layout so the (saas) route group (dashboard, team, profile, sign-in, …)
// can render its own app shell instead, without touching any marketing
// page's URL (route groups don't affect the path).
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

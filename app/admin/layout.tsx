import Footer from "@/components/Footer";

// /admin previously had no layout of its own, so it fell straight through
// to the bare root layout — no Footer anywhere, on any of AdminTabs.tsx's
// render branches (loading, no-access, or the real page). Every other page
// in the app shows the Footer (marketing pages via app/(marketing)/layout.tsx,
// signed-in pages via app/(saas)/layout.js), so this brings /admin in line
// with the same min-h-screen flex-column "sticky footer" pattern: the
// content area grows to fill the screen via flex-1, and the Footer sits
// pinned to the bottom on short pages while still landing at the true end
// once content is taller than the viewport.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* bg-slate-50 + pb-12 match AdminTabs.tsx's own section background,
          so any extra space this flex-1 wrapper adds below short content
          stays gray instead of exposing the white body behind it — the
          same white-band-before-footer mismatch fixed on the SaaS shell. */}
      <div className="flex-1 bg-slate-50 pb-12">{children}</div>
      <Footer />
    </div>
  );
}

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-slate-100 mt-24">
      <div className="max-w-6xl mx-auto px-6 py-12 grid gap-8 md:grid-cols-4 text-sm text-slate-500">
        <div>
          <div className="text-lg font-bold text-ink mb-2">
            Bizz<span className="text-brand">ux</span>
          </div>
          <p>Run your business. Build what&apos;s next.</p>
        </div>
        <div>
          <div className="font-semibold text-ink mb-3">Product</div>
          <ul className="space-y-2">
            <li><Link href="/platform" className="hover:text-brand">Platform</Link></li>
            <li><Link href="/contact" className="hover:text-brand">Start Free</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold text-ink mb-3">Services</div>
          <ul className="space-y-2">
            <li><Link href="/custom-software" className="hover:text-brand">Custom Software</Link></li>
            <li><Link href="/contact" className="hover:text-brand">Book a Consultation</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold text-ink mb-3">Company</div>
          <ul className="space-y-2">
            <li><Link href="/contact" className="hover:text-brand">Contact</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-100 py-6 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} Bizzux. All rights reserved.
      </div>
    </footer>
  );
}

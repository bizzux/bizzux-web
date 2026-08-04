import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  return (
    <footer className="bg-navy text-slate-300 mt-24">
      <div className="max-w-6xl mx-auto px-6 py-14 grid gap-10 md:grid-cols-4">
        <div>
          <Image src="/logo-transparent.png" alt="Bizzux" width={120} height={49} className="h-8 w-auto mb-4" />
          <p className="text-sm text-slate-400">
            Cloud-based POS, inventory, expense and profit management software.
          </p>
        </div>
        <div>
          <div className="font-semibold text-white mb-3 text-sm">Navigate</div>
          <ul className="space-y-2 text-sm">
            <li><Link href="/product" className="hover:text-brand-teal transition-colors">Product</Link></li>
            <li><Link href="/solutions" className="hover:text-brand-teal transition-colors">Solutions</Link></li>
            <li><Link href="/pricing" className="hover:text-brand-teal transition-colors">Pricing</Link></li>
            <li><Link href="/about" className="hover:text-brand-teal transition-colors">About</Link></li>
            <li><Link href="/contact" className="hover:text-brand-teal transition-colors">Contact</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold text-white mb-3 text-sm">Contact</div>
          <ul className="space-y-2 text-sm text-slate-400">
            <li>Phone: 9591222422</li>
            <li>Email: sales@bizzux.com</li>
            <li>www.bizzux.com</li>
          </ul>
        </div>
        <div>
          <div className="font-semibold text-white mb-3 text-sm">Get started</div>
          <Link
            href="/contact"
            className="inline-flex rounded-full bg-gradient-to-r from-brand-teal to-brand-blue text-white text-sm font-semibold px-5 py-2.5 hover:opacity-90 transition-opacity"
          >
            Request a demo
          </Link>
        </div>
      </div>
      <div className="border-t border-white/10 py-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} Bizzux. All rights reserved.
      </div>
    </footer>
  );
}

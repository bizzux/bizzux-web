import Link from "next/link";
import Image from "next/image";
import { IconWhatsApp } from "./Icons";
import { customerVersionLabel } from "@/lib/version";
import { BRAND_TAGLINE, LEGAL_NAME, COMPANY_LOCATION } from "@/lib/brand";

export default function Footer() {
  return (
    <footer className="bg-navy text-slate-300">
      <div className="max-w-7xl mx-auto px-6 py-10 grid gap-6 md:grid-cols-4">
        <div>
          <Image src="/logo-transparent.png" alt="Bizzux" width={120} height={49} className="h-8 w-auto mb-3" />
          <p className="text-xs font-bold tracking-wider uppercase text-brand-teal mb-3">{BRAND_TAGLINE}</p>
          <p className="text-sm text-slate-400">
            CRM, sales, POS, inventory, billing, expenses, projects, files and more in one connected platform, plus
            custom cloud and AI solutions. Developed by {LEGAL_NAME}.
          </p>
        </div>
        <div>
          <div className="font-semibold text-white mb-3 text-sm">Bizzux</div>
          <ul className="space-y-2 text-sm">
            <li><Link href="/platform" className="hover:text-brand-teal transition-colors">Platform</Link></li>
            <li><Link href="/custom-solutions" className="hover:text-brand-teal transition-colors">Build</Link></li>
            <li><Link href="/solutions" className="hover:text-brand-teal transition-colors">Solutions</Link></li>
            <li><Link href="/pricing" className="hover:text-brand-teal transition-colors">Pricing</Link></li>
            <li><Link href="/partners" className="hover:text-brand-teal transition-colors">Partners</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold text-white mb-3 text-sm">Company</div>
          <ul className="space-y-2 text-sm">
            <li><Link href="/about" className="hover:text-brand-teal transition-colors">About</Link></li>
            <li><Link href="/careers" className="hover:text-brand-teal transition-colors">Career</Link></li>
            <li><Link href="/contact" className="hover:text-brand-teal transition-colors">Contact</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold text-white mb-3 text-sm">Get in touch</div>
          <ul className="space-y-2 text-sm text-slate-400 mb-4">
            <li>sales@bizzux.com</li>
            <li>www.bizzux.com</li>
          </ul>
          <a
            href="https://wa.me/919591222422"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-10 rounded-full bg-green-600 text-white text-sm font-semibold px-5 hover:bg-green-700 transition-colors"
          >
            <IconWhatsApp className="w-4 h-4" />
            Chat on WhatsApp
          </a>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-center text-xs text-slate-500">
        <span>© {new Date().getFullYear()} {LEGAL_NAME}. All rights reserved. {COMPANY_LOCATION}.</span>
        <span className="hidden sm:inline">·</span>
        <span className="flex items-center gap-4">
          <Link href="/terms" className="hover:text-brand-teal transition-colors">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-brand-teal transition-colors">Privacy Policy</Link>
        </span>
        <span className="hidden sm:inline">·</span>
        <span>{customerVersionLabel()}</span>
      </div>
    </footer>
  );
}

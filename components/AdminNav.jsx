"use client";

import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Nav from "@/components/Nav";
import { useIsAdminHost, wwwHrefFor, ADMIN_NAV } from "@/lib/adminLinks";

// The shared header of the /team pages. On www it is exactly today's Nav; on the Admin Center host it is a small company-admin header
// (the marketing nav does not exist there), with absolute links back to www.
export default function AdminNav({ active }) {
  const onAdmin = useIsAdminHost();
  if (!onAdmin) return <Nav />;
  return (
    <header className="border-b border-slate-100 bg-white">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-6">
        <Link href="/users" className="font-semibold text-ink">Bizzux Admin Center</Link>
        <nav className="flex items-center gap-5 text-[13px] font-medium">
          {ADMIN_NAV.map((t) => (
            <Link key={t.key} href={t.admin} className={"transition-colors " + (active === t.key ? "text-brand-blue font-semibold" : "text-slate-500 hover:text-brand-blue")}>{t.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-[13px] font-medium">
          <a href={wwwHrefFor(true, "/dashboard")} className="text-slate-500 hover:text-brand-blue">Back to bizzux.com</a>
          <button type="button" className="text-slate-500 hover:text-brand-blue" onClick={async () => { await signOut(auth); window.location.assign(wwwHrefFor(true, "/sign-in")); }}>Sign out</button>
        </div>
      </div>
    </header>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/lib/useMe";
import {
  IconPOS, IconMenu, IconBox, IconWallet, IconUsers, IconStore,
} from "@/components/Icons";

// Defined here (a Client Component) rather than passed in as a prop from
// the server page that renders this — icon components are function
// references, and React Server Components can't serialize those across
// the server/client boundary (passing them as props fails the build).
const featuredApps = [
  { icon: IconStore, name: "Bizzux Shop", desc: "POS, menu, inventory and shop management for food & retail counters.", live: true },
  { icon: IconPOS, name: "Bizzux POS", desc: "A fast, simple point-of-sale for any counter or checkout.", live: false },
  { icon: IconMenu, name: "Bizzux Orders", desc: "Take and track orders from counter, phone or online.", live: false },
  { icon: IconWallet, name: "Bizzux Books", desc: "Accounting and invoicing for small, growing businesses.", live: false },
  { icon: IconBox, name: "Bizzux Inventory", desc: "Stock, materials and supply tracking in real time.", live: false },
  { icon: IconUsers, name: "Bizzux CRM", desc: "Track leads, customers and follow-ups without spreadsheets.", live: false },
];

// The homepage's "Featured apps" tiles used to be plain, unclickable divs —
// even the one marked `live` (Bizzux Shop), so it looked interactive but
// did nothing. This mirrors exactly what app/(saas)/apps/page.js's own
// openApp() does for the same app (same /api/shop-sso hand-off) rather
// than inventing a second way to open it. Only the live tile is
// interactive; "Soon" tiles have nothing to open yet.
export default function FeaturedAppsGrid() {
  const apps = featuredApps;
  const { user } = useMe();
  const router = useRouter();
  const [opening, setOpening] = useState(false);

  async function openShop() {
    if (opening) return;
    if (!user) {
      router.push("/sign-in?mode=signup");
      return;
    }
    setOpening(true);
    try {
      const token = await user.getIdToken();
      const r = await fetch("/api/shop-sso", { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      if (r.status === 402) {
        router.push("/pricing");
        return;
      }
      if (!r.ok) throw new Error(d.error || "Couldn't open Bizzux Shop right now");
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      alert(e.message || "Couldn't open Bizzux Shop right now. Please try again.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
      {apps.map((a) => {
        const Icon = a.icon;
        const clickable = a.live;
        return (
          <div
            key={a.name}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? openShop : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openShop(); } } : undefined}
            className={`flex gap-4 ${clickable ? "cursor-pointer group -m-2 p-2 rounded-lg hover:bg-slate-50 transition-colors" : ""}`}
          >
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${a.live ? "bg-gradient-to-br from-brand-tealDark to-brand-blueDark text-white" : "bg-slate-100 text-slate-400"}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`font-semibold text-base ${clickable ? "group-hover:text-brand-blue transition-colors" : ""}`}>{a.name}</span>
                {!a.live && <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">Soon</span>}
                {clickable && opening && <span className="text-xs text-slate-400">Opening…</span>}
              </div>
              <p className="text-sm text-slate-500 mt-1 leading-relaxed">{a.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

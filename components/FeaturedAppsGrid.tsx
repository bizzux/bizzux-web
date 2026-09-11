"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/lib/useMe";
import {
  IconStore, IconLayers, IconDatabase, IconChart,
} from "@/components/Icons";

// Defined here (a Client Component) rather than passed in as a prop from
// the server page that renders this — icon components are function
// references, and React Server Components can't serialize those across
// the server/client boundary (passing them as props fails the build).
// Only real, working apps — no "coming soon" placeholders. Notes/Files/
// Projects are free utilities (see app/api/app-sso, unrestricted by plan),
// so they're always usable for anyone with an account; `ssoKey` picks
// which SSO hand-off each tile uses — Shop's own /api/shop-sso (plan-
// gated) vs the shared /api/app-sso?app=... (not plan-gated) for the rest.
const featuredApps = [
  { icon: IconStore, name: "Bizzux Shop", desc: "POS, menu, inventory and shop management for food & retail counters.", ssoKey: "shop" },
  { icon: IconLayers, name: "Bizzux Notes", desc: "Live meeting transcription and AI summaries — free for any account.", ssoKey: "notes" },
  { icon: IconDatabase, name: "Bizzux Files", desc: "Upload, search and manage files across all your documents.", ssoKey: "files" },
  { icon: IconChart, name: "Bizzux Projects", desc: "Projects and tasks on a simple Kanban board.", ssoKey: "projects" },
];

// The homepage's "Featured apps" tiles used to be plain, unclickable divs,
// so they looked interactive but did nothing. Mirrors exactly what
// app/(saas)/apps/page.js's own openApp() does for each of these apps
// (same SSO hand-offs) rather than inventing a second way to open them.
export default function FeaturedAppsGrid() {
  const apps = featuredApps;
  const { user } = useMe();
  const router = useRouter();
  const [openingKey, setOpeningKey] = useState<string | null>(null);

  async function openApp(a: (typeof featuredApps)[number]) {
    if (openingKey) return;
    if (!user) {
      router.push("/sign-in?mode=signup");
      return;
    }
    setOpeningKey(a.ssoKey);
    try {
      const token = await user.getIdToken();
      const endpoint = a.ssoKey === "shop" ? "/api/shop-sso" : `/api/app-sso?app=${a.ssoKey}`;
      const r = await fetch(endpoint, { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      if (r.status === 402) {
        router.push("/pricing");
        return;
      }
      if (!r.ok) throw new Error(d.error || `Couldn't open ${a.name} right now`);
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      alert(e.message || `Couldn't open ${a.name} right now. Please try again.`);
    } finally {
      setOpeningKey(null);
    }
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
      {apps.map((a) => {
        const Icon = a.icon;
        return (
          <div
            key={a.name}
            role="button"
            tabIndex={0}
            onClick={() => openApp(a)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openApp(a); } }}
            className="flex gap-4 cursor-pointer group -m-2 p-2 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br from-brand-tealDark to-brand-blueDark text-white">
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-base group-hover:text-brand-blue transition-colors">{a.name}</span>
                {openingKey === a.ssoKey && <span className="text-xs text-slate-400">Opening…</span>}
              </div>
              <p className="text-sm text-slate-500 mt-1 leading-relaxed">{a.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

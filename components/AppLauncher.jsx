"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LAUNCHER_APPS } from "@/lib/launcherApps";

// The 9-dot grid icon, top-left, next to the logo, on every signed-in page
// (mirroring Microsoft 365's App Launcher). Opening it shows every Bizzux
// app in one grid so someone can jump straight from, say, Notes over to
// Projects without going back through /apps first. Same SSO hand-off
// app/(saas)/apps/page.js's "Try now" uses; kept as its own copy here since
// this renders inside Nav (no page-level auth/trial state to reuse).
export default function AppLauncher({ user, isAccountAdmin }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [openingKey, setOpeningKey] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const apps = LAUNCHER_APPS.filter((a) => !a.adminOnly || isAccountAdmin);

  async function openApp(a) {
    setOpen(false);
    if (a.internal) {
      router.push(a.url);
      return;
    }
    if (a.direct || !a.sso) {
      window.open(a.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (!user) return;
    setOpeningKey(a.key);
    try {
      const token = await user.getIdToken();
      const r = await fetch(a.ssoEndpoint || "/api/shop-sso", { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't open that app right now");
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      alert(e.message || "Couldn't open that app right now. Please try again.");
    } finally {
      setOpeningKey(null);
    }
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="App launcher"
        aria-expanded={open}
        className="inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-slate-100 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="text-slate-600">
          {[2, 9, 16].flatMap((cy) => [2, 9, 16].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />))}
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-[280px] bg-white rounded-xl shadow-xl border border-slate-100 p-4 z-50">
          <div className="grid grid-cols-3 gap-1">
            {apps.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => openApp(a)}
                disabled={openingKey === a.key}
                className="flex flex-col items-center gap-1.5 rounded-lg p-2.5 hover:bg-slate-50 transition-colors text-center"
              >
                <span className="text-2xl leading-none">{a.icon}</span>
                <span className="text-[11px] font-medium text-ink leading-tight">
                  {openingKey === a.key ? "Opening…" : a.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

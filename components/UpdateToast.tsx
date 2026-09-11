"use client";

import { useEffect, useRef, useState } from "react";

// How long with zero mouse/keyboard/scroll activity before we consider
// someone "idle" and safe to interrupt with the toast. Deliberately well
// above a normal reading pause — this is only meant to catch someone who's
// stepped away or finished a task, not someone mid-thought between clicks.
const IDLE_MS = 60_000;
// How often we re-check the deployed version. A new deploy doesn't need to
// be caught within seconds — minutes is plenty, and keeps this from being
// a meaningful source of background traffic.
const POLL_MS = 4 * 60_000;

// Session-only (not localStorage) so dismissing just quiets this tab for
// its current lifetime — reopening the app later still offers the same
// update rather than staying silently suppressed forever.
const DISMISS_KEY = "bzx-update-dismissed-version";

// A deliberately passive, corner-anchored notice — never a modal, never
// steals focus, and only appears once the visitor has gone idle (or comes
// back to a tab they'd left) so an in-progress action is never interrupted
// by a deploy happening in the background. See the version endpoint this
// polls at app/api/version/route.js.
export default function UpdateToast() {
  const [available, setAvailable] = useState(false);
  const currentVersion = useRef<string | null>(null);
  const newVersion = useRef<string | null>(null);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    const markActive = () => {
      lastActivity.current = Date.now();
    };
    const events: (keyof WindowEventMap)[] = ["mousemove", "keydown", "scroll", "click", "touchstart"];
    events.forEach((e) => window.addEventListener(e, markActive, { passive: true }));

    fetch("/api/version")
      .then((r) => r.json())
      .then((d) => {
        currentVersion.current = d.version;
      })
      .catch(() => {});

    let idleCheck: ReturnType<typeof setInterval>;

    async function checkVersion() {
      if (!currentVersion.current) return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const d = await r.json();
        if (d.version && d.version !== currentVersion.current) {
          newVersion.current = d.version;
        }
      } catch {
        // Offline or a mid-deploy blip — just try again next poll.
      }
    }

    function maybeShow() {
      if (!newVersion.current) return;
      if (sessionStorage.getItem(DISMISS_KEY) === newVersion.current) return;
      if (Date.now() - lastActivity.current >= IDLE_MS) setAvailable(true);
    }

    const poll = setInterval(checkVersion, POLL_MS);
    idleCheck = setInterval(maybeShow, 15_000);

    // Someone switching back to this tab after being away is a natural,
    // non-disruptive moment to check — they weren't mid-action here.
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      checkVersion().then(() => {
        if (newVersion.current && sessionStorage.getItem(DISMISS_KEY) !== newVersion.current) {
          setAvailable(true);
        }
      });
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      events.forEach((e) => window.removeEventListener(e, markActive));
      clearInterval(poll);
      clearInterval(idleCheck);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!available) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-[9999] max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-tealDark to-brand-blueDark text-white text-sm">
          ✨
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">
            Update available{newVersion.current ? " — build " + newVersion.current.slice(0, 7) : ""}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Bizzux has the latest fixes and improvements ready. Click Update to install it now — the
            page will reload. Your work is saved as you go, so nothing is lost.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-gradient-to-br from-brand-tealDark to-brand-blueDark px-3 py-1.5 text-xs font-semibold text-white"
            >
              Update now
            </button>
            <button
              type="button"
              onClick={() => {
                if (newVersion.current) sessionStorage.setItem(DISMISS_KEY, newVersion.current);
                setAvailable(false);
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

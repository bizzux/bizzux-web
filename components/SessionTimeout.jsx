"use client";

// Bizzux session timeout — shared, identical copy in every Bizzux app
// (bizzux-web portal, Shop, CRM, Notes, Files, Projects, Chat, Mail,
// Assistant). Keep the copies in sync; the source of truth is
// bizzux-web/components/SessionTimeout.jsx.
//
// What it enforces, for whoever is signed in to THIS app:
//   - Idle timeout: no mouse/keyboard/touch/scroll activity for
//     `idleMinutes` → signed out. A warning with a countdown appears
//     `warnSeconds` before; only "Stay signed in" dismisses it (moving the
//     mouse doesn't, so a walk-past can't keep an unattended screen open).
//   - Maximum session length: `maxHours` after the last real sign-in the
//     user must sign in again, active or not.
// Activity is shared between this app's tabs via localStorage, so working
// in one tab keeps the others alive. Checks also run the moment a tab
// becomes visible again, so a laptop that slept past the limit is signed
// out on wake instead of staying open.
//
// The policy (minutes/hours, per-app overrides) is set by the Platform
// Owner in bizzux.com → Super Admin → Security Settings and served from
// /api/session-policy. If that can't be reached, safe defaults apply.

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

const DEFAULTS = { idleMinutes: 30, maxHours: 12, warnSeconds: 60 };
const ACTIVITY_KEY = "bzx:lastActivity";
const POLICY_CACHE_KEY = "bzx:sessionPolicy";
const EVENTS = ["mousedown", "mousemove", "keydown", "touchstart", "scroll", "wheel"];

function readNumber(key) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function writeActivity(t) {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(t));
  } catch {}
}

async function loadPolicy(policyUrl) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(POLICY_CACHE_KEY) || "null");
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.policy;
  } catch {}
  try {
    const r = await fetch(policyUrl, { cache: "no-store" });
    if (!r.ok) throw new Error();
    const p = await r.json();
    const policy = {
      idleMinutes: Number(p.idleMinutes) || DEFAULTS.idleMinutes,
      maxHours: Number(p.maxHours) || DEFAULTS.maxHours,
      warnSeconds: Number(p.warnSeconds) || DEFAULTS.warnSeconds,
    };
    try {
      sessionStorage.setItem(POLICY_CACHE_KEY, JSON.stringify({ at: Date.now(), policy }));
    } catch {}
    return policy;
  } catch {
    return DEFAULTS;
  }
}

function fmt(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function SessionTimeout({
  appKey,
  // Where to send someone after an automatic sign-out; `reason=timeout` or
  // `reason=expired` is appended so the sign-in page can explain why.
  signInUrl = "/sign-in",
  policyUrl = "https://www.bizzux.com/api/session-policy",
  // sessionStorage keys to wipe on sign-out (e.g. an unsaved POS cart), so
  // the next person at the device never sees them.
  clearKeys = [],
}) {
  const [user, setUser] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [warnLeft, setWarnLeft] = useState(null); // seconds left, or null when no warning
  const [notice, setNotice] = useState("");
  const warningRef = useRef(false);
  const signingOutRef = useRef(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  // Explain an automatic sign-out on whatever page it landed on.
  useEffect(() => {
    try {
      const reason = new URLSearchParams(window.location.search).get("reason");
      if (reason === "timeout") setNotice("You were signed out after a period of inactivity. Please sign in again.");
      if (reason === "expired") setNotice("Your session expired. Please sign in again.");
    } catch {}
  }, []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    loadPolicy(policyUrl + (policyUrl.includes("?") ? "&" : "?") + "app=" + encodeURIComponent(appKey || "")).then(
      (p) => alive && setPolicy(p)
    );
    return () => {
      alive = false;
    };
  }, [user, appKey, policyUrl]);

  // Props held in a ref so a new `clearKeys` array on each parent render
  // doesn't restart the timers below.
  const propsRef = useRef({ clearKeys, signInUrl });
  propsRef.current = { clearKeys, signInUrl };

  const doSignOut = useCallback(async (reason) => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    const { clearKeys: keys, signInUrl: url } = propsRef.current;
    try {
      keys.forEach((k) => sessionStorage.removeItem(k));
      localStorage.removeItem(ACTIVITY_KEY);
    } catch {}
    try {
      await signOut(auth);
    } catch {}
    window.location.href = url + (url.includes("?") ? "&" : "?") + "reason=" + reason;
  }, []);

  useEffect(() => {
    if (!user || !policy) return;
    signingOutRef.current = false;
    const idleMs = policy.idleMinutes * 60 * 1000;
    const warnMs = Math.min(policy.warnSeconds * 1000, idleMs / 2);
    const maxMs = policy.maxHours * 60 * 60 * 1000;
    const signedInAt = Date.parse(user.metadata?.lastSignInTime || "") || Date.now();

    // A stale timestamp left over from an earlier session must not count
    // against a fresh sign-in.
    if (readNumber(ACTIVITY_KEY) < signedInAt) writeActivity(Date.now());

    let lastWrite = 0;
    const onActivity = () => {
      if (warningRef.current) return; // only the button dismisses a warning
      const now = Date.now();
      if (now - lastWrite > 5000) {
        lastWrite = now;
        writeActivity(now);
      }
    };

    const check = () => {
      const now = Date.now();
      if (now - signedInAt >= maxMs) return doSignOut("expired");
      const idle = now - (readNumber(ACTIVITY_KEY) || now);
      if (idle >= idleMs) return doSignOut("timeout");
      if (idle >= idleMs - warnMs) {
        warningRef.current = true;
        setWarnLeft((idleMs - idle) / 1000);
      } else if (warningRef.current) {
        // Another tab clicked "Stay signed in".
        warningRef.current = false;
        setWarnLeft(null);
      }
    };

    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    const timer = setInterval(check, 1000);
    check();
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      clearInterval(timer);
      warningRef.current = false;
      setWarnLeft(null);
    };
  }, [user, policy, doSignOut]);

  const staySignedIn = () => {
    warningRef.current = false;
    writeActivity(Date.now());
    setWarnLeft(null);
  };

  if (user && warnLeft !== null) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bzx-session-title"
        style={{
          position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(15,23,42,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div style={{ background: "#fff", borderRadius: 16, maxWidth: 400, width: "100%", padding: 24, boxShadow: "0 20px 50px rgba(0,0,0,0.25)", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
          <h2 id="bzx-session-title" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px", color: "#0f172a" }}>
            Are you still there?
          </h2>
          <p style={{ fontSize: 14, color: "#475569", margin: "0 0 4px" }}>
            For your security, you&apos;ll be signed out due to inactivity in
          </p>
          <p style={{ fontSize: 28, fontWeight: 800, color: "#0e7490", margin: "4px 0 18px", fontVariantNumeric: "tabular-nums" }}>
            {fmt(warnLeft)}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              autoFocus
              onClick={staySignedIn}
              style={{ height: 40, padding: "0 20px", borderRadius: 999, border: 0, cursor: "pointer", fontWeight: 600, fontSize: 14, color: "#fff", background: "linear-gradient(90deg,#0f8f80,#1d4ed8)" }}
            >
              Stay signed in
            </button>
            <button
              type="button"
              onClick={() => doSignOut("timeout")}
              style={{ height: 40, padding: "0 20px", borderRadius: 999, border: "1px solid #cbd5e1", cursor: "pointer", fontWeight: 600, fontSize: 14, color: "#0f172a", background: "#fff" }}
            >
              Sign out now
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!user && notice) {
    return (
      <div
        role="status"
        style={{
          position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 2147483000,
          background: "#0f172a", color: "#fff", borderRadius: 12, padding: "10px 14px", fontSize: 13,
          fontFamily: "Inter, system-ui, sans-serif", display: "flex", gap: 12, alignItems: "center",
          maxWidth: "calc(100% - 24px)", boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        }}
      >
        <span>{notice}</span>
        <button type="button" onClick={() => setNotice("")} aria-label="Dismiss" style={{ background: "none", border: 0, color: "#fff", cursor: "pointer", fontSize: 16 }}>
          ×
        </button>
      </div>
    );
  }

  return null;
}

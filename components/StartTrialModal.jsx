"use client";

import { useState } from "react";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import { TRIAL_POLICY_POINTS, TRIAL_CONTACT_URL, trialHeadline } from "@/lib/trialPolicy";

// Starts the free trial for an org in "trial_pending" with one click:
// POST /api/trial/start (no SMS / phone step; the account's email is already
// verified at sign-up and the server allows one trial per email address).
// `onStarted()` runs after the trial is live (e.g. to refresh the page's
// data). The success screen then offers `onOpenApp()` as a real click, so
// the app's new tab isn't blocked as a pop-up.
export default function StartTrialModal({ appName, trialDays, onClose, onStarted, onOpenApp }) {
  const [step, setStep] = useState("ready"); // ready | started | blocked
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPolicy, setShowPolicy] = useState(false);
  const [started, setStarted] = useState(null);

  async function startTrial() {
    setBusy(true);
    setError("");
    try {
      const token = await auth.currentUser.getIdToken(true);
      const r = await fetch("/api/trial/start", { method: "POST", headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      if (!r.ok) {
        if (d.code === "EMAIL_USED" || d.code === "TRIAL_NOT_AVAILABLE") setStep("blocked");
        throw new Error(d.error || "Couldn't start your trial");
      }
      setStarted(d);
      setStep("started");
      await onStarted?.(d);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  if (step === "started") {
    const end = started?.trialEndDate ? new Date(started.trialEndDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
          <h2 style={{ marginBottom: 6 }}>Your free trial has started</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
            All Bizzux apps are unlocked{end ? ` until ${end}` : ""}. No card needed.
          </p>
          {appName && onOpenApp ? (
            <button className="btn-primary" style={{ width: "100%" }} onClick={onOpenApp}>Open {appName} →</button>
          ) : (
            <button className="btn-primary" style={{ width: "100%" }} onClick={onClose}>Continue</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="onboarding-hi">🎁 {trialHeadline(trialDays)}</div>
        <h2 style={{ marginBottom: 4 }}>Start your free trial</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          {appName ? `${appName} opens right after. ` : ""}All Bizzux apps unlocked, no card needed.
        </p>

        {step === "blocked" ? (
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-outline-dark" onClick={onClose}>Close</button>
            <Link href="/pricing" className="btn-primary">See plans</Link>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-outline-dark" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={startTrial} disabled={busy}>
              {busy ? "Starting…" : "Start free trial"}
            </button>
          </div>
        )}

        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}

        <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <button type="button" className="link-btn" onClick={() => setShowPolicy((v) => !v)} style={{ fontSize: 12 }}>
            {showPolicy ? "Hide" : "Read"} free trial policy
          </button>
          {showPolicy && (
            <ul className="muted" style={{ fontSize: 12, lineHeight: 1.5, margin: "8px 0 0 16px", listStyle: "disc" }}>
              {TRIAL_POLICY_POINTS.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Need more time? <Link href={TRIAL_CONTACT_URL} className="link-btn">Contact us</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

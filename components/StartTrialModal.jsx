"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RecaptchaVerifier, linkWithPhoneNumber } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { COUNTRIES, DEFAULT_COUNTRY_ISO2, findCountry, phoneLengthShortLabel, isValidPhoneLength, findCountryByPhone } from "@/lib/countryCodes";
import { TRIAL_POLICY_POINTS, TRIAL_CONTACT_URL, trialHeadline } from "@/lib/trialPolicy";

// Starts the phone-verified free trial for an org in "trial_pending":
//   1. enter mobile number -> Firebase sends an SMS code (invisible reCAPTCHA)
//   2. enter the code -> the number is linked to this Firebase login
//   3. POST /api/trial/start, which reads the verified number from Firebase
//      Auth and claims it (one trial per number, ever).
// If the login already has a verified number linked, step 1-2 are skipped.
// `onStarted()` runs after the trial is live (e.g. to refresh the page's
// data). The success screen then offers `onOpenApp()` as a real click, so
// the app's new tab isn't blocked as a pop-up.
export default function StartTrialModal({ appName, trialDays, defaultPhone, onClose, onStarted, onOpenApp }) {
  const initialCountry = findCountryByPhone(defaultPhone) || findCountry(DEFAULT_COUNTRY_ISO2);
  const [countryIso, setCountryIso] = useState(initialCountry.iso2);
  const [phone, setPhone] = useState(() => {
    if (!defaultPhone) return "";
    const digits = String(defaultPhone).replace(/[^\d]/g, "");
    const dialDigits = initialCountry.dial.replace("+", "");
    return digits.startsWith(dialDigits) ? digits.slice(dialDigits.length) : digits;
  });
  const [step, setStep] = useState("phone"); // phone | code | starting
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPolicy, setShowPolicy] = useState(false);
  const [started, setStarted] = useState(null);
  const confirmationRef = useRef(null);
  const verifierRef = useRef(null);
  const country = findCountry(countryIso);
  const linkedPhone = auth.currentUser?.phoneNumber || null;

  useEffect(() => () => {
    try { verifierRef.current?.clear(); } catch {}
  }, []);

  async function startTrial() {
    setStep("starting");
    setBusy(true);
    setError("");
    try {
      const token = await auth.currentUser.getIdToken(true);
      const r = await fetch("/api/trial/start", { method: "POST", headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't start your trial");
      setStarted(d);
      setBusy(false);
      setStep("started");
      await onStarted?.(d);
    } catch (e) {
      setError(e.message);
      setStep(linkedPhone || confirmationRef.current ? "done-error" : "phone");
      setBusy(false);
    }
  }

  async function sendCode(e) {
    e.preventDefault();
    const digits = phone.replace(/[^\d]/g, "");
    if (!isValidPhoneLength(digits, country.len)) {
      setError(`Enter a valid ${country.name} mobile number.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!verifierRef.current) {
        verifierRef.current = new RecaptchaVerifier(auth, "trial-recaptcha", { size: "invisible" });
      }
      confirmationRef.current = await linkWithPhoneNumber(auth.currentUser, country.dial + digits, verifierRef.current);
      setStep("code");
    } catch (err) {
      setError(phoneError(err));
      try { verifierRef.current?.clear(); } catch {}
      verifierRef.current = null;
    }
    setBusy(false);
  }

  async function confirmCode(e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code we sent you.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await confirmationRef.current.confirm(code.trim());
    } catch (err) {
      setError(phoneError(err));
      setBusy(false);
      return;
    }
    await startTrial();
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
        <h2 style={{ marginBottom: 4 }}>Verify your mobile to start your free trial</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          {appName ? `${appName} opens right after. ` : ""}All Bizzux apps unlocked, no card needed. We send a one-time code by SMS.
        </p>

        {linkedPhone ? (
          <div>
            <p style={{ fontSize: 14, marginBottom: 16 }}>
              Your verified number: <strong>{linkedPhone}</strong>
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn-outline-dark" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={startTrial} disabled={busy}>
                {busy ? "Starting…" : "Start free trial"}
              </button>
            </div>
          </div>
        ) : step === "phone" ? (
          <form onSubmit={sendCode} noValidate>
            <label className="label">Mobile number *</label>
            <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "nowrap" }}>
              <select
                className="input" style={{ width: 120, flex: "none" }} value={countryIso}
                onChange={(e) => setCountryIso(e.target.value)} aria-label="Country code"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.iso2} value={c.iso2}>{c.iso2} {c.dial}</option>
                ))}
              </select>
              <input
                className="input" inputMode="tel" autoComplete="tel-national" value={phone} autoFocus
                onChange={(e) => setPhone(e.target.value)} placeholder={`Mobile (${phoneLengthShortLabel(country.len)})`}
              />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn-outline-dark" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn-primary" disabled={busy}>{busy ? "Sending…" : "Send code"}</button>
            </div>
          </form>
        ) : step === "code" ? (
          <form onSubmit={confirmCode} noValidate>
            <label className="label">6-digit code sent to {country.dial} {phone}</label>
            <input
              className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} autoFocus
              onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))} style={{ marginBottom: 14, letterSpacing: 4 }}
            />
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button type="button" className="link-btn" disabled={busy} onClick={() => { setStep("phone"); setCode(""); setError(""); }}>
                Change number
              </button>
              <button className="btn-primary" disabled={busy}>{busy ? "Verifying…" : "Verify & start trial"}</button>
            </div>
          </form>
        ) : step === "starting" ? (
          <p className="muted">Starting your trial…</p>
        ) : (
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Link href="/pricing" className="btn-primary">See plans</Link>
          </div>
        )}

        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
        <div id="trial-recaptcha" />

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
            Need more time or can&apos;t verify by SMS? <Link href={TRIAL_CONTACT_URL} className="link-btn">Contact us</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

function phoneError(err) {
  const code = err?.code || "";
  if (code === "auth/credential-already-in-use" || code === "auth/account-exists-with-different-credential") {
    return "This mobile number is already linked to another Bizzux account, so it can't start a new trial. Sign in with that account, or contact us.";
  }
  if (code === "auth/provider-already-linked") return "Your account already has a mobile number linked. Refresh the page and try again.";
  if (code === "auth/invalid-verification-code") return "That code didn't match. Check it and try again.";
  if (code === "auth/code-expired") return "That code has expired. Go back and request a new one.";
  if (code === "auth/too-many-requests") return "Too many attempts. Please wait a while and try again.";
  if (code === "auth/invalid-phone-number") return "That mobile number doesn't look right.";
  if (code === "auth/operation-not-allowed") return "SMS verification isn't switched on yet. Please contact us to start your trial.";
  if (code === "auth/quota-exceeded") return "We can't send more codes right now. Please try again later or contact us.";
  return err?.message || "Something went wrong. Please try again.";
}

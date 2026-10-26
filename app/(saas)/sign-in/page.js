"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  signInWithCustomToken,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { safeNext } from "@/lib/safeNext";
import Link from "next/link";
import Nav from "@/components/Nav";
import { IconEye, IconEyeOff } from "@/components/Icons";
import { COUNTRIES, DEFAULT_COUNTRY_ISO2, findCountry, phoneLengthLabel, phoneLengthShortLabel, isValidPhoneLength } from "@/lib/countryCodes";
import { createJourneyTracker } from "@/lib/authJourneyClient";
import { APP_VERSION } from "@/lib/version";

// Login Journey Diagnostics (see lib/authJourney.js) — categories only, never credentials.
const journey = createJourneyTracker({ app: "admin-center", buildVersion: APP_VERSION, getToken: () => auth.currentUser?.getIdToken() });
import { BRAND_TAGLINE } from "@/lib/brand";
import { isBizzuxId } from "@/lib/loginId";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [countryIso, setCountryIso] = useState(DEFAULT_COUNTRY_ISO2);
  const [phone, setPhone] = useState("");
  const country = findCountry(countryIso);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("mode");
    if (p === "signup" || p === "signin") setMode(p);
  }, []);

  // signInWithPopup used to be blocked by Chrome's popup blocker for real
  // users (works fine when automated/synthetic-clicked, which is why this
  // slipped through testing) — signInWithRedirect avoids popups entirely by
  // navigating to Google and back instead. On the way back, Firebase
  // resolves the pending sign-in here rather than at the click site.
  useEffect(() => {
    let cancelled = false;
    // Coming back from Google, getRedirectResult + /api/claim + /api/me take
    // a few seconds during which the form used to look idle (users clicked
    // again). The flag set just before the redirect lets us show the busy
    // state from the very first paint of the return trip.
    let returning = false;
    try { returning = sessionStorage.getItem("bzx:googleRedirect") === "1"; } catch {}
    if (returning) setGoogleBusy(true);
    (async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result && !cancelled) {
          try { sessionStorage.removeItem("bzx:googleRedirect"); } catch {}
          journey.track("OAUTH_CALLBACK_RECEIVED", { method: "google" });
          journey.track("AUTH_SUCCEEDED", { method: "google" });
          setGoogleBusy(true);
          await afterAuth();
          return;
        }
        if (!cancelled && returning) {
          // Redirect came back without a result — release the form.
          journey.track("OAUTH_CALLBACK_RECEIVED", { method: "google" });
          journey.track("AUTH_FAILED", { method: "google", errorCategory: "redirect_failed" });
          try { sessionStorage.removeItem("bzx:googleRedirect"); } catch {}
          setGoogleBusy(false);
        }
      } catch (err) {
        try { sessionStorage.removeItem("bzx:googleRedirect"); } catch {}
        journey.fail("AUTH_FAILED", err, { method: "google" });
        if (!cancelled) {
          setGoogleBusy(false);
          setError("That didn't go through. Mind giving it another try?");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ensures a customers/{uid} record exists (creating it with the current
  // trial length and verification requirements on first login). Returns
  // the parsed response so callers can see whether email verification is
  // actually required for this account before deciding to send that email.
  async function claimAccount(extra) {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch("/api/claim", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(extra || {}),
    });
    try {
      return await r.json();
    } catch {
      return {};
    }
  }

  async function afterAuth(extra) {
    const result = await claimAccount(extra);
    journey.track("SESSION_INITIALIZED");
    if (result?.mustChangePassword) {
      router.push("/change-password");
    } else if (result?.twoFactorRequired && !result?.twoFactorEnabled) {
      router.push("/setup-2fa");
    } else if (result?.twoFactorEnabled && sessionStorage.getItem("2fa_verified") !== "true") {
      router.push("/verify-2fa");
    } else {
      // /api/claim now reports platformRole itself; only fall back to a
      // separate /api/me call if an older response didn't include it.
      const role = result && "platformRole" in result ? result.platformRole : undefined;
      const isAdmin = role !== undefined ? role === "OWNER" || role === "ADMIN" : await isPlatformAdmin();
      journey.track("APP_ACCESS_GRANTED");
      router.push(safeNext(new URLSearchParams(window.location.search).get("next")) || (isAdmin ? "/admin" : "/dashboard"));
    }
  }

  // Platform Owner/Admins land on the admin dashboard (new sign-ups,
  // trials, etc.) instead of the customer dashboard. Their own business
  // dashboard is still one click away in the nav.
  async function isPlatformAdmin() {
    try {
      const token = await auth.currentUser.getIdToken();
      const r = await fetch("/api/me", { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      return d.platformRole === "OWNER" || d.platformRole === "ADMIN";
    } catch {
      return false;
    }
  }

  async function handleGoogleSignIn() {
    setError("");
    setGoogleBusy(true);
    journey.track("LOGIN_STARTED", { method: "google" });
    journey.track("AUTH_PROVIDER_SELECTED", { method: "google" });
    // Navigates away to Google and back — no popup involved, so nothing
    // here runs until the redirect-result effect above picks it up on
    // return. Only the (rare) synchronous failure to even start the
    // redirect lands in this catch.
    try {
      try { sessionStorage.setItem("bzx:googleRedirect", "1"); } catch {}
      journey.track("OAUTH_REDIRECT_STARTED", { method: "google" });
      await signInWithRedirect(auth, new GoogleAuthProvider());
    } catch (err) {
      try { sessionStorage.removeItem("bzx:googleRedirect"); } catch {}
      journey.fail("AUTH_FAILED", err, { method: "google" });
      setError("That didn't go through. Mind giving it another try?");
      setGoogleBusy(false);
    }
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validateSignup() {
    const errs = {};
    if (!fullName.trim()) errs.fullName = "Please enter your full name";
    else if (fullName.trim().length < 2) errs.fullName = "Please enter your full name";

    if (!email.trim()) errs.email = "Please enter your email";
    else if (!EMAIL_RE.test(email.trim())) errs.email = "Please enter a valid email address";

    if (!password) errs.password = "Please enter a password";
    else if (password.length < 8) errs.password = "Password cannot be less than 8 characters";

    if (!phone.trim()) errs.phone = "Please enter your phone number";
    else if (!isValidPhoneLength(phone.trim(), country.len))
      errs.phone = `Please enter a valid ${country.name} phone number (${phoneLengthLabel(country.len)})`;

    if (!agreeTerms) errs.agreeTerms = "Please accept the Terms of Service and Privacy Policy";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    if (mode === "signup") {
      if (!validateSignup()) return;

      // Checked before creating the Firebase Auth account, so we never end
      // up with an orphaned login for a phone number we then reject.
      setBusy(true);
      try {
        const r = await fetch("/api/check-phone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: country.dial + phone.trim() }),
        });
        const d = await r.json();
        if (!d.available) {
          setFieldErrors({ phone: "This phone number is already registered to another account" });
          setBusy(false);
          return;
        }
      } catch {
        // If the check itself fails, don't block signup on it.
      }
    } else {
      setBusy(true);
    }

    const loginMethod = email.includes("@") ? "password" : "bizzux-id";
    if (mode !== "signup") journey.track("LOGIN_STARTED", { method: loginMethod, subject: email });
    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
        // /api/claim stamps and returns which gate(s) this account actually
        // needs — a Super Admin can require Email, Mobile, or both (see
        // Super Admin > Trial settings), so only send the email when
        // verifyEmailRequired comes back true. The mobile OTP, if also
        // required, is sent by VerifyMobileGate itself once the dashboard
        // shows it (app/(saas)/dashboard/page.js).
        const claimed = await claimAccount({ fullName: fullName.trim(), phone: country.dial + phone.trim() });
        if (claimed.verifyEmailRequired) {
          try {
            // Sent through Resend (see /api/send-verification-email), not the
            // Firebase client SDK's own sendEmailVerification() — Firebase's
            // default sender has no SPF/DKIM alignment with bizzux.com and
            // reliably lands in spam.
            const token = await auth.currentUser.getIdToken();
            await fetch("/api/send-verification-email", {
              method: "POST",
              headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
              body: JSON.stringify({ continueUrl: window.location.origin + "/dashboard" }),
            });
          } catch {
            // Non-fatal — account creation already succeeded either way.
          }
        }
        router.push("/dashboard");
      } else {
        if (!email.includes("@") || isBizzuxId(email)) {
          // Admin-provisioned username login (no email on the account): a short username or a Bizzux ID ("first.last@bizzux"); the server maps both to the same login.
          const r = await fetch("/api/auth/username-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: email, password }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) {
            journey.fail("AUTH_FAILED", r.status === 429 ? "too-many-requests" : "invalid-credential", { method: loginMethod, subject: email });
            setError(d.error || "That didn't work. Double check your username and password and try again.");
            setBusy(false);
            return;
          }
          await signInWithCustomToken(auth, d.token);
        } else {
          await signInWithEmailAndPassword(auth, email, password);
        }
        journey.track("AUTH_SUCCEEDED", { method: loginMethod });
        await afterAuth();
      }
    } catch (err) {
      if (mode !== "signup") journey.fail(auth.currentUser ? "SESSION_FAILED" : "AUTH_FAILED", err, { method: loginMethod, subject: email });
      if (mode === "signup" && err?.code === "auth/email-already-in-use") {
        setError("Looks like you already have an account with this email. Try signing in instead.");
      } else if (err?.code === "auth/user-disabled") {
        // Closed by the Platform Owner (recoverable for 60 days).
        setError("This account has been closed. If you think this is a mistake, contact sales@bizzux.com to get it back.");
      } else if (mode === "signup" && err?.code === "auth/weak-password") {
        setError("Password must be at least 8 characters.");
      } else {
        setError(mode === "signup" ? "We couldn't create your account. Please give it another try." : "That didn't work. Double check your email and password and try again.");
      }
      setBusy(false);
    }
  }

  return (
    <>
      {/* While a sign-in/sign-up submission is in flight, block every other
          click on the page (Nav links, WhatsApp/Book a demo, mode toggle,
          etc.) so the app doesn't end up mid-navigation or firing a second
          submit on top of the first one. Nav's own buttons already have no
          disabled state of their own to thread through, so a transparent,
          full-viewport click-catcher above everything is the simplest way
          to freeze the whole page for that brief window. */}
      {(busy || googleBusy) && (
        <div
          className="fixed inset-0 z-[999] cursor-wait flex items-center justify-center"
          style={{ background: googleBusy ? "rgba(255,255,255,0.85)" : "transparent" }}
          role="status"
          aria-live="polite"
        >
          {googleBusy && <span style={{ fontSize: 16, fontWeight: 600, color: "#0f172a" }}>Signing you in…</span>}
        </div>
      )}
      <Nav />
      <div className="login-wrap login-v2">
      <div className="login-shell">
      <div className="login-aside">
        <div className="lv2-eyebrow">{BRAND_TAGLINE}</div>
        <h2>{mode === "signup" ? <>Start free.<br />Ready to grow <span className="lv2-accent">today?</span></> : <>Welcome back.<br />Ready to grow <span className="lv2-accent">today?</span></>}</h2>
        <p>One account for all your business apps — POS, inventory, projects, finance, HR, attendance and more. {mode === "signup" ? "Create your account and get started in minutes." : "Sign in and pick up right where you left off."}</p>
        <ul>
          <li>All your business apps in one login</li>
          <li>Role-based access for your team</li>
          <li>Secure and reliable platform</li>
          <li>Free 14-day trial, cancel anytime</li>
        </ul>
        <div className="lv2-hero" aria-hidden="true">
          <img src="/images/hero-girl.webp" alt="" className="lv2-girl" />
          <div className="lv2-note">Welcome back!<br />Log in and<br />get to work<br />smarter.</div>
          <span className="lv2-chip lv2-chip-sales"><i style={{ background: "#2159d4" }} />Sales</span>
          <span className="lv2-chip lv2-chip-inv"><i style={{ background: "#f97316" }} />Inventory</span>
          <span className="lv2-chip lv2-chip-crm"><i style={{ background: "#12a695" }} />CRM</span>
          <span className="lv2-chip lv2-chip-proj"><i style={{ background: "#7c3aed" }} />Projects</span>
        </div>
      </div>
      <div className="login-card">
        <Link href="/" style={{ display: "block", marginBottom: 16 }}>
          <img src="/app-logo.png" alt="Bizzux" className="logo-img" style={{ height: 32 }} />
        </Link>

        <button type="button" className="btn-google" onClick={handleGoogleSignIn} disabled={googleBusy || busy}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
          </svg>
          {googleBusy ? "Signing in…" : "Continue with Google"}
        </button>

        <div className="login-divider"><span>or</span></div>

        <div className="mode-toggle" role="tablist" aria-label="Sign in or sign up">
          <button
            type="button" role="tab" aria-selected={mode === "signin"}
            className={"mode-toggle-btn" + (mode === "signin" ? " active" : "")}
            onClick={() => { setMode("signin"); setFieldErrors({}); setError(""); }}
            disabled={busy || googleBusy}
          >
            Sign in
          </button>
          <button
            type="button" role="tab" aria-selected={mode === "signup"}
            className={"mode-toggle-btn" + (mode === "signup" ? " active" : "")}
            onClick={() => { setMode("signup"); setFieldErrors({}); setError(""); }}
            disabled={busy || googleBusy}
          >
            Sign up
          </button>
        </div>

        <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
        <p className="sub">
          {mode === "signup" ? "Start your free trial in a minute." : "Sign in to your Bizzux account."}
        </p>

        <form onSubmit={handleSubmit} noValidate>
          {mode === "signup" && (
            <div>
              <label className="label">Full name</label>
              <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
              {fieldErrors.fullName && <p className="field-error">{fieldErrors.fullName}</p>}
            </div>
          )}

          <div>
            <label className="label">{mode === "signin" ? "Email or Bizzux ID" : "Email"}</label>
            <input className="input" type={mode === "signin" ? "text" : "email"} autoCapitalize="none" placeholder={mode === "signin" ? "Email, or first.last@bizzux" : "Enter your email"} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={mode === "signin"} />
            {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
          </div>

          <div>
            <label className="label">Password</label>
            <div className="password-field">
              <input
                className="input" type={showPassword ? "text" : "password"}
                placeholder={mode === "signin" ? "Enter your password" : "Create a password (8+ characters)"}
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((s) => !s)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <IconEyeOff className="w-4 h-4" /> : <IconEye className="w-4 h-4" />}
              </button>
            </div>
            {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
            {mode === "signin" && (
              <p className="lv2-forgot"><Link href="/recover-password">Forgot password?</Link></p>
            )}
          </div>

          {mode === "signup" && (
            <>
              <div>
                <label className="label">Phone</label>
                <div className="phone-field">
                  <select
                    className="phone-code-select"
                    value={countryIso}
                    aria-label="Country code"
                    onChange={(e) => {
                      setCountryIso(e.target.value);
                      // A number typed for the previous country may be too
                      // long for the new one's expected length — trim it
                      // instead of leaving a stale, now-invalid value sitting
                      // in the field.
                      const next = findCountry(e.target.value);
                      const maxLen = Array.isArray(next.len) ? next.len[1] : next.len;
                      setPhone((p) => p.slice(0, maxLen));
                    }}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.iso2} value={c.iso2}>
                        {c.name} ({c.dial})
                      </option>
                    ))}
                  </select>
                  <input
                    className="input" type="tel" value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder={`Phone number (${phoneLengthShortLabel(country.len)})`}
                    maxLength={Array.isArray(country.len) ? country.len[1] : country.len}
                  />
                </div>
                {fieldErrors.phone && <p className="field-error">{fieldErrors.phone}</p>}
              </div>

              <div className="terms-row">
                <label>
                  <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                  <span>
                    I agree to the{" "}
                    <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and{" "}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
                  </span>
                </label>
                {fieldErrors.agreeTerms && <p className="field-error">{fieldErrors.agreeTerms}</p>}
              </div>
            </>
          )}

          <button className="btn-primary" style={{ width: "100%" }} disabled={busy}>
            {busy ? (mode === "signup" ? "Creating account…" : "Signing in…") : (mode === "signup" ? "Get started" : "Sign in  →")}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
      </div>
      </div>
    </>
  );
}

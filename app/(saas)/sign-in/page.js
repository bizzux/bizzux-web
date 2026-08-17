"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import Link from "next/link";
import Nav from "@/components/Nav";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("mode");
    if (p === "signup" || p === "signin") setMode(p);
  }, []);

  // Ensures a customers/{uid} record exists (creating it with the current
  // trial length on first login), then sends the user to their dashboard.
  async function afterAuth(extra) {
    const token = await auth.currentUser.getIdToken();
    await fetch("/api/claim", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(extra || {}),
    });
    router.push("/dashboard");
  }

  async function handleGoogleSignIn() {
    setError("");
    setGoogleBusy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      await afterAuth();
    } catch (err) {
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
    else if (!/^\d{10}$/.test(phone.trim())) errs.phone = "Please enter a valid 10-digit phone number";

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
          body: JSON.stringify({ phone: phone.trim() }),
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

    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
        try {
          await sendEmailVerification(auth.currentUser, { url: window.location.origin + "/dashboard" });
        } catch {
          // Non-fatal — account creation already succeeded either way.
        }
        await afterAuth({ fullName: fullName.trim(), phone: phone.trim() });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        await afterAuth();
      }
    } catch (err) {
      if (mode === "signup" && err?.code === "auth/email-already-in-use") {
        setError("Looks like you already have an account with this email. Try signing in instead.");
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
      <Nav />
      <div className="login-wrap">
      <div className="login-shell">
      <div className="login-aside">
        <h2>Run your business smarter, every day.</h2>
        <p>One account for POS, inventory, expenses and profit — start free, no card required.</p>
        <ul>
          <li>Sales, inventory and expenses in one place</li>
          <li>Multi-branch visibility as you grow</li>
          <li>Free 14-day trial, cancel anytime</li>
          <li>Invite your team with role-based access</li>
        </ul>
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
          >
            Sign in
          </button>
          <button
            type="button" role="tab" aria-selected={mode === "signup"}
            className={"mode-toggle-btn" + (mode === "signup" ? " active" : "")}
            onClick={() => { setMode("signup"); setFieldErrors({}); setError(""); }}
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
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={mode === "signin"} />
            {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
          </div>

          <div>
            <label className="label">Password</label>
            <div className="password-field">
              <input
                className="input" type={showPassword ? "text" : "password"}
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((s) => !s)} tabIndex={-1}>
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
            {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
          </div>

          {mode === "signup" && (
            <>
              <div>
                <label className="label">Phone</label>
                <div className="phone-field">
                  <span className="phone-code">+91</span>
                  <input
                    className="input" type="tel" value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="Phone number"
                  />
                </div>
                {fieldErrors.phone && <p className="field-error">{fieldErrors.phone}</p>}
              </div>

              <div className="terms-row">
                <label>
                  <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                  <span>
                    I agree to the <a href="#" onClick={(e) => e.preventDefault()}>Terms of Service</a> and{" "}
                    <a href="#" onClick={(e) => e.preventDefault()}>Privacy Policy</a>.
                  </span>
                </label>
                {fieldErrors.agreeTerms && <p className="field-error">{fieldErrors.agreeTerms}</p>}
              </div>
            </>
          )}

          <button className="btn-primary" style={{ width: "100%" }} disabled={busy}>
            {busy ? (mode === "signup" ? "Creating account…" : "Signing in…") : (mode === "signup" ? "Get started" : "Sign in")}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
      </div>
      </div>
    </>
  );
}

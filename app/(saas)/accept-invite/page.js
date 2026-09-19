"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { verifyPasswordResetCode, confirmPasswordReset, signInWithEmailAndPassword, signInWithRedirect, getRedirectResult, GoogleAuthProvider } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Link from "next/link";

// Three ways someone can land here, all starting from the same invite email:
//   1. "reset" — the email link carries mode=resetPassword&oobCode=... directly
//      (Firebase's Action URL is configured to point straight at this page),
//      so we finish the password reset ourselves via confirmPasswordReset.
//   2. "signin" — Firebase's own hosted password-reset page handled the
//      oobCode first (the default when no custom Action URL is set) and its
//      "Continue" link drops mode/oobCode, landing here with only
//      ?invite=... left. The person already set their password there, so we
//      just need them to sign in with it — we look their email up from the
//      invite token via GET /api/team/accept.
//   3. "existing" — the invited email already had a Bizzux sign-in before
//      this invite (see app/api/team/route.js's auth/email-already-exists
//      branch), so there's no password to set at all — just offer Google or
//      an existing password to sign in with directly.
// Either way, the invite is finalized the same way: POST /api/team/accept
// once the invitee is signed in.
function AcceptInviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const invite = params.get("invite") || "";
  const oobCode = params.get("oobCode") || "";
  const mode = params.get("mode") || "";

  // "checking" | "reset" | "signin" | "existing" | "invalid"
  const [stage, setStage] = useState("checking");
  const [email, setEmail] = useState("");
  const [invalidMessage, setInvalidMessage] = useState("This invite link is invalid or has expired. Ask whoever invited you to resend it.");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!invite) {
      setStage("invalid");
      return;
    }
    if (mode === "resetPassword" && oobCode) {
      verifyPasswordResetCode(auth, oobCode)
        .then((e) => { setEmail(e); setStage("reset"); })
        .catch(() => fallBackToSignIn());
      return;
    }
    fallBackToSignIn();

    function fallBackToSignIn() {
      fetch("/api/team/accept?invite=" + encodeURIComponent(invite))
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "This invite link is invalid or has expired.");
          setEmail(d.email);
          setStage(d.existingAccount ? "existing" : "signin");
        })
        .catch((err) => {
          setInvalidMessage(err.message || "This invite link is invalid or has expired. Ask whoever invited you to resend it.");
          setStage("invalid");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite, mode, oobCode]);

  // signInWithPopup gets blocked by Chrome's popup blocker for real users —
  // signInWithRedirect avoids that by navigating to Google and back instead
  // of opening a popup. getRedirectResult only ever resolves non-null ONCE
  // (right after the redirect completes), so it's read exactly once here,
  // on mount, into state — not re-invoked as a dependency of anything else,
  // since a second call would just see it as already consumed and return
  // null. The actual email-match check waits for BOTH this and the
  // invite-lookup effect above (which re-derives `email` from the URL on
  // this same post-redirect page load) in the effect below.
  const [redirectCred, setRedirectCred] = useState(undefined); // undefined = not checked yet

  useEffect(() => {
    getRedirectResult(auth)
      .then((cred) => setRedirectCred(cred || null))
      .catch((err) => {
        setError(err.message || "That didn't go through. Mind giving it another try?");
        setRedirectCred(null);
      });
  }, []);

  useEffect(() => {
    if (!redirectCred || !email) return;
    setGoogleBusy(true);
    if ((redirectCred.user.email || "").toLowerCase() !== email.toLowerCase()) {
      setError(`Signed in as ${redirectCred.user.email}, but this invite is for ${email}. Sign in with that account instead.`);
      setGoogleBusy(false);
      return;
    }
    finishAccept().catch((err) => {
      setError(err.message || "Couldn't finish setting up your account");
      setGoogleBusy(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirectCred, email]);

  async function finishAccept() {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch("/api/team/accept", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ invite }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Couldn't finish setting up your account");
    router.push("/dashboard");
  }

  async function submitReset(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setBusy(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      await signInWithEmailAndPassword(auth, email, password);
      await finishAccept();
    } catch (err) {
      setError(err.message || "That didn't work. Please try again or ask your admin to resend the invite.");
      setBusy(false);
    }
  }

  async function submitSignIn(e) {
    e.preventDefault();
    setError("");
    if (!password) {
      setError("Enter the password you set.");
      return;
    }

    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      await finishAccept();
    } catch (err) {
      setError(err.message || "That didn't work. Please try again or ask your admin to resend the invite.");
      setBusy(false);
    }
  }

  // Available on every stage, not just "existing": Firebase links a Google
  // sign-in to the SAME auth record as long as the email matches (its
  // default "one account per email" behavior), including the password-less
  // placeholder account created for a brand-new email invite — so this is a
  // real alternative to setting a password, not just a fallback for someone
  // who already had an account.
  async function handleInviteGoogle() {
    setError("");
    setGoogleBusy(true);
    // Navigates away to Google and back — the redirect-result effect above
    // picks up the outcome (including the email-match check) once the page
    // reloads on return.
    try {
      await signInWithRedirect(auth, new GoogleAuthProvider());
    } catch (err) {
      setError(err.message || "That didn't go through. Mind giving it another try?");
      setGoogleBusy(false);
    }
  }

  async function submitExistingPassword(e) {
    e.preventDefault();
    setError("");
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      await finishAccept();
    } catch (err) {
      setError("That didn't work. Double check your password, or use Google above if that's how you normally sign in.");
      setBusy(false);
    }
  }

  if (stage === "checking") {
    return <div className="login-wrap"><p style={{ color: "#fff" }}>Checking your invite…</p></div>;
  }

  if (stage === "invalid") {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>⚠️</div>
          <h1>Invite link invalid</h1>
          <p className="sub">{invalidMessage}</p>
          <Link href="/sign-in" className="btn-primary" style={{ display: "inline-flex", marginTop: 10 }}>
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  const logo = (
    <Link href="/" style={{ display: "block", marginBottom: 22 }}>
      <img src="/app-logo.png" alt="Bizzux" className="logo-img" style={{ height: 32 }} />
    </Link>
  );

  const googleButton = (
    <button type="button" className="btn-google" onClick={handleInviteGoogle} disabled={googleBusy || busy}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z" />
        <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
      </svg>
      {googleBusy ? "Signing in…" : "Continue with Google"}
    </button>
  );

  if (stage === "signin") {
    return (
      <div className="login-wrap">
        <div className="login-card">
          {logo}
          <h1>Welcome back</h1>
          <p className="sub">Your password is already set for <strong>{email}</strong>. Sign in to finish joining the team.</p>

          {googleButton}
          <div className="login-divider"><span>or</span></div>

          <form onSubmit={submitSignIn} noValidate>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </div>
            <button className="btn-primary" style={{ width: "100%", marginTop: 18 }} disabled={busy}>
              {busy ? "Signing in…" : "Sign in & join team"}
            </button>
            {error && <p className="error">{error}</p>}
          </form>
        </div>
      </div>
    );
  }

  if (stage === "existing") {
    return (
      <div className="login-wrap">
        <div className="login-card">
          {logo}
          <h1>You&apos;re invited!</h1>
          <p className="sub">
            You already have a Bizzux account for <strong>{email}</strong>. Sign in the way you normally do to
            accept this invite.
          </p>

          {googleButton}
          <div className="login-divider"><span>or</span></div>

          <form onSubmit={submitExistingPassword} noValidate>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </div>
            <button className="btn-primary" style={{ width: "100%", marginTop: 18 }} disabled={busy || googleBusy}>
              {busy ? "Signing in…" : "Sign in & join team"}
            </button>
            {error && <p className="error">{error}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        {logo}
        <h1>You&apos;re invited!</h1>
        <p className="sub">Sign in with Google, or set a password, for <strong>{email}</strong> to join the team.</p>

        {googleButton}
        <div className="login-divider"><span>or set a password</span></div>

        <form onSubmit={submitReset} noValidate>
          <div>
            <label className="label">New password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="label">Confirm password</label>
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <button className="btn-primary" style={{ width: "100%", marginTop: 18 }} disabled={busy}>
            {busy ? "Setting up…" : "Join team"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="login-wrap"><p style={{ color: "#fff" }}>Loading…</p></div>}>
      <AcceptInviteInner />
    </Suspense>
  );
}

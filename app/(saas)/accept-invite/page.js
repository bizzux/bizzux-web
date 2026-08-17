"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { verifyPasswordResetCode, confirmPasswordReset, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Link from "next/link";

// Two ways someone can land here, both starting from the same invite email:
//   1. "reset" — the email link carries mode=resetPassword&oobCode=... directly
//      (Firebase's Action URL is configured to point straight at this page),
//      so we finish the password reset ourselves via confirmPasswordReset.
//   2. "signin" — Firebase's own hosted password-reset page handled the
//      oobCode first (the default when no custom Action URL is set) and its
//      "Continue" link drops mode/oobCode, landing here with only
//      ?invite=... left. The person already set their password there, so we
//      just need them to sign in with it — we look their email up from the
//      invite token via GET /api/team/accept.
// Either way, the invite is finalized the same way: POST /api/team/accept
// once the invitee is signed in.
function AcceptInviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const invite = params.get("invite") || "";
  const oobCode = params.get("oobCode") || "";
  const mode = params.get("mode") || "";

  // "checking" | "reset" | "signin" | "invalid"
  const [stage, setStage] = useState("checking");
  const [email, setEmail] = useState("");
  const [invalidMessage, setInvalidMessage] = useState("This invite link is invalid or has expired. Ask whoever invited you to resend it.");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
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
          setStage("signin");
        })
        .catch((err) => {
          setInvalidMessage(err.message || "This invite link is invalid or has expired. Ask whoever invited you to resend it.");
          setStage("invalid");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite, mode, oobCode]);

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

  if (stage === "signin") {
    return (
      <div className="login-wrap">
        <div className="login-card">
          {logo}
          <h1>Welcome back</h1>
          <p className="sub">Your password is already set for <strong>{email}</strong> — sign in to finish joining the team.</p>

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

  return (
    <div className="login-wrap">
      <div className="login-card">
        {logo}
        <h1>You&apos;re invited!</h1>
        <p className="sub">Set a password for <strong>{email}</strong> to join the team.</p>

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

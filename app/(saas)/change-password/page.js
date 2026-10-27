"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updatePassword, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Nav from "@/components/Nav";
import { useMe } from "@/lib/useMe";
import { currentNext, withNext } from "@/lib/safeNext";

// Forced first-login password change for admin-created logins (Create
// Business Login, or an admin-created team member — see
// app/api/admin/organizations & .../customers's setPassword action, both
// of which can set mustChangePassword: true). Not a general "change your
// password" settings page; someone who doesn't need this is bounced
// straight to /dashboard.
export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, me } = useMe();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState(null);

  useEffect(() => {
    if (user === null) router.push(withNext("/sign-in"));
  }, [user, router]);

  useEffect(() => {
    if (me && !me.mustChangePassword) router.replace("/dashboard");
  }, [me, router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      const token = await auth.currentUser.getIdToken();
      if (!auth.currentUser.email) {
        // Username login: no Firebase password provider, so the server
        // changes the hash and revokes the session; sign in again.
        const r = await fetch("/api/auth/username-change-password", {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setError(d.error || "Couldn't update your password. Please try again.");
          setBusy(false);
          return;
        }
        const d = await r.json().catch(() => ({}));
        if (d.recoveryCodes) {
          // Shown once; the user signs in again after saving them.
          setCodes(d.recoveryCodes);
          setBusy(false);
          return;
        }
        await signOut(auth);
        router.push(withNext("/sign-in"));
        return;
      }
      await updatePassword(auth.currentUser, password);
      await fetch("/api/change-password", { method: "POST", headers: { Authorization: "Bearer " + token } });
      // With a "next" (e.g. an invitation), take the same two-step steps sign-in would before going there;
      // without one, /dashboard's own guard handles them as before.
      const next = currentNext();
      router.push(!next ? "/dashboard"
        : me?.twoFactorRequired && !me?.twoFactorEnabled ? withNext("/setup-2fa", next)
        : me?.twoFactorEnabled && sessionStorage.getItem("2fa_verified") !== "true" ? withNext("/verify-2fa", next)
        : next);
    } catch (err) {
      // A password change this sensitive can ask Firebase to re-verify a
      // very recent sign-in — happens if this page is reached a while
      // after actually signing in (e.g. left the tab open overnight).
      if (err?.code === "auth/requires-recent-login") {
        setError("For security, please sign out and sign back in, then try again.");
      } else {
        setError("Couldn't update your password. Please try again.");
      }
      setBusy(false);
    }
  }

  if (codes) {
    return (
      <>
        <Nav />
        <div className="min-h-[70vh] flex items-center justify-center px-6 py-16 bg-slate-50">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-sm border border-slate-100 p-8">
            <h1 className="text-2xl font-bold mb-2">Save your recovery codes</h1>
            <p className="text-slate-600 text-sm mb-4">
              Your account has no email, so these one-time codes are the only way to reset your own password if you forget it.
              Write them down and keep them private. They are shown once.
            </p>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-slate-50 rounded-lg p-4 mb-4">
              {codes.map((c) => <span key={c}>{c}</span>)}
            </div>
            <button
              className="w-full h-11 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white text-sm font-semibold"
              onClick={async () => { await signOut(auth); router.push("/sign-in"); }}
            >
              I've saved them. Sign in again
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Nav />
      <div className="min-h-[70vh] flex items-center justify-center px-6 py-16 bg-slate-50">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-sm border border-slate-100 p-8">
          <h1 className="text-2xl font-bold mb-2">Set a new password</h1>
          <p className="text-slate-600 text-sm mb-6">
            Your account was set up with a temporary password. Choose your own password to continue.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New password</label>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:border-brand-blue"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Confirm new password</label>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:border-brand-blue"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {busy ? "Saving…" : "Set password and continue"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updatePassword, onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Nav from "@/components/Nav";
import { useMe } from "@/lib/useMe";

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

  useEffect(() => {
    if (user === null) router.push("/sign-in");
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
      await updatePassword(auth.currentUser, password);
      const token = await auth.currentUser.getIdToken();
      await fetch("/api/change-password", { method: "POST", headers: { Authorization: "Bearer " + token } });
      router.push("/dashboard");
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

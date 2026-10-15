"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Nav from "@/components/Nav";

// Password recovery for username logins (no email): a single-use recovery
// code from the set shown at first password change replaces the email link.
export default function RecoverPasswordPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/username-recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, code, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't recover the account.");
      setDone(d.remainingCodes);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  const field = "w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:border-brand-blue";
  return (
    <>
      <Nav />
      <div className="min-h-[70vh] flex items-center justify-center px-6 py-16 bg-slate-50">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-sm border border-slate-100 p-8">
          <h1 className="text-2xl font-bold mb-2">Recover your account</h1>
          {done !== null ? (
            <>
              <p className="text-sm text-slate-600 mb-4">
                Your password was changed. You have {done} recovery code{done === 1 ? "" : "s"} left
                {done <= 2 ? "; ask your administrator for a new set soon." : "."}
              </p>
              <button className="w-full h-11 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white text-sm font-semibold" onClick={() => router.push("/sign-in")}>Sign in</button>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-sm text-slate-600">Enter your username and one of the recovery codes you saved. If you have none left, ask your company administrator to reset your password.</p>
              <input className={field} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" required />
              <input className={field + " font-mono"} placeholder="Recovery code (XXXX-XXXX)" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" required />
              <input className={field} type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
              <input className={field} type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button disabled={busy} className="w-full h-11 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white text-sm font-semibold disabled:opacity-60">{busy ? "Working…" : "Set new password"}</button>
              <p className="text-center text-sm"><Link href="/sign-in" className="underline">Back to sign in</Link></p>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

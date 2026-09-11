"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import Nav from "@/components/Nav";
import { useMe } from "@/lib/useMe";

// Second-factor check after a normal email+password (or Google) sign-in
// already succeeded — see app/(saas)/sign-in/page.js's afterAuth and
// dashboard/page.js's guard, both of which send someone here once instead
// of straight to /dashboard when their account has 2FA enabled.
// "Verified" is remembered per browser session (sessionStorage), not
// persisted anywhere server-side — the same lightweight pattern
// mustChangePassword's gate already uses, appropriate for this audience/
// threat model rather than a full server session concept.
export default function Verify2faPage() {
  const router = useRouter();
  const { user, me } = useMe();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (user === null) router.push("/sign-in");
  }, [user, router]);

  useEffect(() => {
    if (me && !me.twoFactorEnabled) router.replace("/dashboard");
  }, [me, router]);

  // Email method: send a code automatically on arrival so there's nothing
  // extra to click for the common case. TOTP has no send step at all —
  // the code is already on their phone.
  useEffect(() => {
    if (me?.twoFactorEnabled && me.twoFactorMethod === "email" && !sent) {
      sendCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  async function sendCode() {
    setSending(true);
    setError("");
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch("/api/2fa/send-email-code", { method: "POST", headers: { Authorization: "Bearer " + token } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSent(true);
    } catch (err) {
      setError(err.message || "Couldn't send the code. Please try again.");
    }
    setSending(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch("/api/2fa/verify", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      sessionStorage.setItem("2fa_verified", "true");
      router.push("/dashboard");
    } catch (err) {
      setError(err.message || "Couldn't verify that code.");
      setBusy(false);
    }
  }

  const isTotp = me?.twoFactorMethod === "totp";

  return (
    <>
      <Nav />
      <div className="min-h-[70vh] flex items-center justify-center px-6 py-16 bg-slate-50">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-sm border border-slate-100 p-8">
          <h1 className="text-2xl font-bold mb-2">Two-factor verification</h1>
          <p className="text-slate-600 text-sm mb-6">
            {isTotp
              ? "Enter the 6-digit code from your authenticator app."
              : sending
              ? "Sending a code to your email…"
              : "Enter the code we emailed you."}
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:border-brand-blue"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              autoFocus
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="w-full h-11 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {busy ? "Verifying…" : "Verify and continue"}
            </button>
          </form>
          {!isTotp && (
            <button
              type="button"
              onClick={sendCode}
              disabled={sending}
              className="w-full text-center text-sm text-brand-blue font-semibold mt-4 hover:underline disabled:opacity-60"
            >
              {sending ? "Sending…" : "Resend code"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

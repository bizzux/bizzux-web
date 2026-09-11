"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { useMe } from "@/lib/useMe";
import TwoFactorSettings from "@/components/TwoFactorSettings";

// Forced setup — reached only when a Super Admin has marked this account
// "2FA required" (see app/api/admin/two-factor/route.js) and it isn't set
// up yet. Same TwoFactorSettings component the Profile page uses
// voluntarily, just framed as mandatory and redirecting straight into the
// app once done, instead of back to Profile.
export default function Setup2faPage() {
  const router = useRouter();
  const { user, me } = useMe();

  useEffect(() => {
    if (user === null) router.push("/sign-in");
  }, [user, router]);

  useEffect(() => {
    if (me && !(me.twoFactorRequired && !me.twoFactorEnabled)) router.replace("/dashboard");
  }, [me, router]);

  function onEnabled() {
    sessionStorage.setItem("2fa_verified", "true"); // just set it up — no need to immediately re-verify
    router.push("/dashboard");
  }

  if (!user || !me) {
    return (
      <div>
        <Nav />
        <div className="py-24 text-center text-slate-400">Loading…</div>
      </div>
    );
  }

  return (
    <>
      <Nav />
      <div className="min-h-[70vh] flex items-center justify-center px-6 py-16 bg-slate-50">
        <div className="w-full max-w-md">
          <div className="rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4 mb-4">
            <p className="text-sm font-semibold text-amber-900">Two-factor authentication is required on this account.</p>
            <p className="text-xs text-amber-800 mt-1">An admin has required this for security. Set it up below to continue.</p>
          </div>
          <TwoFactorSettings enabled={false} method={null} onChanged={onEnabled} />
        </div>
      </div>
    </>
  );
}

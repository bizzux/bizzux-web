"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMe } from "@/lib/useMe";

// Platform team invitation. Steps: link is valid -> sign in with the invited
// email -> email verified -> two-step verification on -> Accept. The server
// re-checks every one of those; this page only guides the person through.
function Inner() {
  const router = useRouter();
  const token = useSearchParams().get("token") || "";
  const { user } = useMe();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setInfo({ state: "invalid" }); return; }
    fetch("/api/admin/platform-invitation?token=" + encodeURIComponent(token))
      .then((r) => r.json()).then(setInfo).catch(() => setInfo({ state: "invalid" }));
  }, [token]);

  async function accept() {
    setBusy(true); setError(""); setCode("");
    try {
      const idToken = await user.getIdToken(true);
      const r = await fetch("/api/admin/platform-invitation", {
        method: "POST", headers: { Authorization: "Bearer " + idToken, "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Could not accept the invitation."); setCode(d.code || ""); }
      else router.push("/admin");
    } catch (e) {
      setError(e.message || "Could not accept the invitation.");
    }
    setBusy(false);
  }

  const wrap = (children) => (
    <div style={{ maxWidth: 460, margin: "64px auto", padding: "0 16px" }}>
      <div className="card" style={{ padding: 24 }}>{children}</div>
    </div>
  );

  if (!info || user === undefined) return wrap(<p className="muted">Checking invitation…</p>);
  if (info.state !== "ok") {
    const msg = { expired: "This invitation has expired. Ask the Platform Owner to resend it.", used: "This invitation has already been used." }[info.state]
      || "This invitation link is invalid.";
    return wrap(<><h1 style={{ fontSize: 18, marginBottom: 8 }}>Invitation unavailable</h1><p className="muted">{msg}</p></>);
  }

  const wrongAccount = user && user.email && user.email.toLowerCase() !== info.email;
  return wrap(
    <>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>Join the Bizzux platform team</h1>
      <p className="muted" style={{ marginBottom: 14 }}>
        You were invited as <strong>{info.roleLabel}</strong> using <strong>{info.email}</strong>.
      </p>
      {!user && (
        <Link href="/sign-in" className="btn-primary" style={{ display: "inline-flex" }}>
          Sign in as {info.email}
        </Link>
      )}
      {wrongAccount && (
        <p className="error">You&apos;re signed in as {user.email}. Sign out and sign in with {info.email} to accept.</p>
      )}
      {user && !wrongAccount && (
        <>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Two-step verification is required for platform access. Turn it on in your{" "}
            <Link href="/profile" style={{ textDecoration: "underline" }}>profile</Link> first if you haven&apos;t.
          </p>
          <button className="btn-primary" onClick={accept} disabled={busy}>{busy ? "Activating…" : "Accept invitation"}</button>
        </>
      )}
      {error && (
        <p className="error" style={{ marginTop: 12 }}>
          {error} {code === "mfa_required" && <Link href="/profile" style={{ textDecoration: "underline" }}>Open profile</Link>}
        </p>
      )}
    </>
  );
}

export default function AcceptPlatformInvitePage() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}

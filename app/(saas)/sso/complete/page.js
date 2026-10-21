"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { safeAdminTarget } from "@/lib/adminHost";
import { wwwHrefFor, useIsAdminHost } from "@/lib/adminLinks";

// Landing page of the app to Admin Center hand-off. The one-time code was posted as a form (never in a URL) and burned on the server, which set a
// short-lived host-only cookie. This page redeems it once for a Firebase sign-in of the same person, remembers where to return to, and opens
// the requested Admin Center page. On failure it STOPS with a link; it never bounces back automatically.
export default function SsoCompletePage() {
  const router = useRouter();
  const onAdminHost = useIsAdminHost();
  const [error, setError] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error")) { setError("This sign-in link is invalid or has expired. Open the Admin Center again."); return; }
    (async () => {
      try {
        const r = await fetch("/api/admin-center/session", { method: "POST", credentials: "same-origin" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Sign-in failed");
        await signInWithCustomToken(auth, d.customToken);
        try { sessionStorage.setItem("bzx.admin.ctx", JSON.stringify({ ...d.context, at: Date.now() })); } catch { /* private window: no Back link */ }
        router.replace(safeAdminTarget(d.to));
      } catch (e) { setError(e.message || "Sign-in failed. Open the Admin Center again."); }
    })();
  }, [router]);

  return (
    <div className="login-wrap"><div className="login-shell"><div className="login-card" style={{ textAlign: "center" }}>
      {error ? (<><p className="error">{error}</p><p style={{ margin: "14px 0 0" }}><a className="btn-primary" style={{ display: "block", textDecoration: "none", padding: "13px 16px" }} href={wwwHrefFor(onAdminHost, "/dashboard")}>Back to bizzux.com</a></p></>) : <p className="muted">Signing you in…</p>}
    </div></div></div>
  );
}

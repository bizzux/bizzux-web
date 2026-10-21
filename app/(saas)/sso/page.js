"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { safeAdminTarget } from "@/lib/adminHost";
import { wwwHrefFor, useIsAdminHost } from "@/lib/adminLinks";

// Landing page of the Admin Center hand-off. The token is in the URL fragment (never sent to a server); it is exchanged once for a Firebase custom
// token for the same user, then we go to a whitelisted admin path. On failure we STOP and show a link, we never bounce back automatically.
export default function SsoPage() {
  const router = useRouter();
  const onAdminHost = useIsAdminHost();
  const [error, setError] = useState("");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = hash.get("token");
    const to = safeAdminTarget(hash.get("to"));
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) { setError("Missing sign-in link. Open the Admin Center from bizzux.com again."); return; }
    (async () => {
      try {
        const r = await fetch("/api/sso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Sign-in failed");
        await signInWithCustomToken(auth, d.customToken);
        router.replace(to);
      } catch (e) {
        setError(e.message || "Sign-in failed. Open the Admin Center from bizzux.com again.");
      }
    })();
  }, [router]);

  return (
    <div className="login-wrap">
      <div className="login-shell">
        <div className="login-card" style={{ textAlign: "center" }}>
          {error ? (
            <>
              <p className="error">{error}</p>
              <p style={{ margin: "14px 0 0" }}><a className="btn-primary" style={{ display: "block", textDecoration: "none", padding: "13px 16px" }} href={wwwHrefFor(onAdminHost, "/open-admin")}>Try again from bizzux.com</a></p>
            </>
          ) : <p className="muted">Signing you in…</p>}
        </div>
      </div>
    </div>
  );
}

"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import { useMe } from "@/lib/useMe";
import { safeAdminTarget } from "@/lib/adminHost";

// www-side start of the Admin Center hand-off: signed in -> ask the server for a single-use token -> go to the admin host.
// Not signed in -> normal sign-in first (it returns here). Loop guard: at most one automatic attempt per 20 seconds.
function OpenAdmin() {
  const router = useRouter();
  const params = useSearchParams();
  const to = safeAdminTarget(params.get("to"));
  const { user } = useMe();
  const [error, setError] = useState("");

  useEffect(() => {
    if (user === undefined) return;
    if (user === null) { router.replace("/sign-in?next=" + encodeURIComponent("/open-admin?to=" + to)); return; }
    let last = 0;
    try { last = Number(sessionStorage.getItem("bzx:adminHop") || 0); } catch { /* storage blocked */ }
    if (Date.now() - last < 20_000) { setError("The Admin Center did not open. Please try again."); return; }
    try { sessionStorage.setItem("bzx:adminHop", String(Date.now())); } catch { /* storage blocked */ }
    (async () => {
      try {
        const token = await auth.currentUser.getIdToken();
        const r = await fetch("/api/admin-center/handoff?to=" + encodeURIComponent(to), { headers: { Authorization: "Bearer " + token } });
        const d = await r.json();
        if (r.status === 403) throw new Error("The Admin Center is for company owners and admins. Ask your admin if you need access.");
        if (!r.ok) throw new Error(d.error || "Could not open the Admin Center");
        window.location.assign(d.url);
      } catch (e) { setError(e.message); }
    })();
  }, [user, to, router]);

  return (
    <div className="login-wrap"><div className="login-shell"><div className="login-card" style={{ textAlign: "center" }}>
      {error ? (<><p className="error">{error}</p><p style={{ margin: "14px 0 0" }}><a className="btn-primary" style={{ display: "block", textDecoration: "none", padding: "13px 16px" }} href="/dashboard">Back to dashboard</a></p></>) : <p className="muted">Opening the Admin Center…</p>}
    </div></div></div>
  );
}

export default function OpenAdminPage() {
  return <Suspense fallback={null}><OpenAdmin /></Suspense>;
}

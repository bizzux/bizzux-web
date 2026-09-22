"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";

// Shown only for a login that both owns its own Bizzux account AND is
// staff on someone else's team (me.dualContext, from /api/me — see
// resolveAccount() in lib/firebaseAdmin.js). Switching reloads the page
// rather than trying to patch every account-scoped piece of state in
// place — accountId touches too much (dashboard, apps, team, chat/notes/
// files/projects SSO) for a partial client-side refresh to be reliable.
export default function AccountSwitcher({ me }) {
  const [busy, setBusy] = useState(false);
  if (!me?.dualContext) return null;

  async function switchTo(context) {
    if (busy || context === (me.useMembershipContext ? "membership" : "own")) return;
    setBusy(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const r = await fetch("/api/switch-context", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });
      if (!r.ok) throw new Error();
      window.location.reload();
    } catch {
      setBusy(false);
      alert("Couldn't switch accounts right now. Please try again.");
    }
  }

  return (
    <select
      value={me.useMembershipContext ? "membership" : "own"}
      disabled={busy}
      onChange={(e) => switchTo(e.target.value)}
      title="Switch which Bizzux account you're acting as"
      className="text-[11px] font-medium text-ink bg-slate-100 hover:bg-slate-200 rounded-full pl-3 pr-2 py-1.5 border-0 outline-none cursor-pointer max-w-[160px]"
    >
      <option value="own">{me.ownAccountEmail || "My account"}</option>
      <option value="membership">{me.membershipOrgEmail || "Team"} (staff)</option>
    </select>
  );
}

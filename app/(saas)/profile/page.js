"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import OrganizationsManager from "@/components/OrganizationsManager";
import Nav from "@/components/Nav";
import AccountTabs from "@/components/AccountTabs";
import { useMe } from "@/lib/useMe";

// Anyone can reach their own profile; only the fields below decide what's
// visible on it. "canManageOrgs" mirrors requireOrgManager() server-side
// (Super Admin, or the Global Admin / Admin profile on their own account) —
// see lib/firebaseAdmin.js for why that's the intended gate, not a mistake.
export default function ProfilePage() {
  const router = useRouter();
  // useMe() (lib/useMe.js) shares this /api/me lookup with Nav instead of
  // each firing its own duplicate request, and starts a remount from the
  // last known answer instead of a blank "checking…" state.
  const { user, me } = useMe();
  const [customer, setCustomer] = useState(null);

  useEffect(() => {
    if (user === null) { router.push("/sign-in"); return; }
    if (user && !user.emailVerified) { router.push("/dashboard"); return; } // reuse the existing verify-email gate there
  }, [user, router]);

  useEffect(() => {
    if (!user || !me || !me.accountId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "customers", me.accountId));
        if (!cancelled) setCustomer(snap.exists() ? snap.data() : {});
      } catch {
        if (!cancelled) setCustomer({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, me]);

  if (!user || me === null) {
    // Same fix as dashboard/page.js: keep Nav visible on a light background
    // during this ~1-2s load instead of flashing to the dark, full-viewport
    // .login-wrap the sign-in page uses, which read as the page going blank.
    return (
      <div>
        <Nav />
        <div className="py-24 text-center text-slate-400">Loading…</div>
      </div>
    );
  }

  const roleLabel = me.isOwner ? "Owner" : (me.profile || "Team member");

  return (
    <div>
      <Nav />
      <AccountTabs active="profile" isAccountAdmin={!!me.isAccountAdmin} isSuper={!!me.superAdmin} />

      <div className="admin-shell">
        <h1 className="dash-heading" style={{ fontSize: 20 }}>My Profile</h1>
        <p className="dash-sub" style={{ marginBottom: 16 }}>Your account details and access.</p>

        {/* One shared card instead of two half-empty side-by-side ones —
            each section only takes the width its own fields need (no
            flex-grow), so the row hugs its content instead of stretching
            into a lot of blank space on the shorter side. */}
        <div className="card" style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 36, alignItems: "flex-start" }}>
            <div>
              <h3 style={{ marginBottom: 10, fontSize: 14.5 }}>Your details</h3>
              <div className="row" style={{ gap: 22, flexWrap: "wrap" }}>
                <div>
                  <div className="label">Email</div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{user.email}</div>
                </div>
                <div>
                  <div className="label">Role</div>
                  <span className="status-pill active" style={{ display: "inline-block" }}>{roleLabel}</span>
                </div>
                <div>
                  <div className="label">Email status</div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{user.emailVerified ? "Verified" : "Not verified"}</div>
                </div>
              </div>
            </div>

            <div style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />

            <div>
              <h3 style={{ marginBottom: 10, fontSize: 14.5 }}>Organization</h3>
              {customer ? (
                <div className="row" style={{ gap: 22, flexWrap: "wrap" }}>
                  <div>
                    <div className="label">Name</div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{customer.companyName || "N/A"}</div>
                  </div>
                  {customer.status && (
                    <div>
                      <div className="label">Status</div>
                      <span className={"status-pill " + customer.status} style={{ display: "inline-block" }}>
                        {customer.status === "trial" ? "Trial" : customer.status === "active" ? "Active" : customer.status === "past_due" ? "Past due" : "Cancelled"}
                      </span>
                    </div>
                  )}
                  {customer.planName && (
                    <div>
                      <div className="label">Plan</div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{customer.planName}</div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="muted">No organization on file yet.</p>
              )}
            </div>
          </div>
        </div>

        {me.canManageOrgs && (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 3 }}>Add Organization</h2>
            <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
              Available to Global Admin and Admin, provision a new organization record.
            </p>
            <OrganizationsManager />
          </>
        )}
      </div>
    </div>
  );
}

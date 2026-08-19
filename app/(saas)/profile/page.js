"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import OrganizationsManager from "@/components/OrganizationsManager";
import Nav from "@/components/Nav";

// Anyone can reach their own profile; only the fields below decide what's
// visible on it. "canManageOrgs" mirrors requireOrgManager() server-side
// (Super Admin, or the Global Admin / Admin profile on their own account) —
// see lib/firebaseAdmin.js for why that's the intended gate, not a mistake.
export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [me, setMe] = useState(null); // null = loading
  const [customer, setCustomer] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { router.push("/sign-in"); return; }
      if (!u.emailVerified) { router.push("/dashboard"); return; } // reuse the existing verify-email gate there
      setUser(u);
    });
    return unsub;
  }, [router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const t = await user.getIdToken();
        const r = await fetch("/api/me", { headers: { Authorization: "Bearer " + t } });
        const d = await r.json();
        setMe(d);
        if (d.accountId) {
          const snap = await getDoc(doc(db, "customers", d.accountId));
          setCustomer(snap.exists() ? snap.data() : {});
        }
      } catch {
        setMe({ canManageOrgs: false });
      }
    })();
  }, [user]);

  if (!user || me === null) {
    return <div className="login-wrap"><p style={{ color: "#fff" }}>Loading…</p></div>;
  }

  const roleLabel = me.isOwner ? "Owner" : (me.profile || "Team member");

  const topbarLinks = [
    { href: "/dashboard", label: "Dashboard" },
    ...(me.superAdmin ? [{ href: "/admin", label: "Admin" }] : []),
    ...(me.isAccountAdmin ? [{ href: "/team", label: "Team" }] : []),
  ];

  return (
    <div>
      <Nav extraLinks={topbarLinks} />

      <div className="admin-shell">
        <h1 className="dash-heading">My Profile</h1>
        <p className="dash-sub">Your account details and access.</p>

        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "1.1fr 1fr", marginBottom: 32 }}>
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Your details</h3>
            <div className="row" style={{ gap: 32, flexWrap: "wrap" }}>
              <div>
                <div className="label">Email</div>
                <div style={{ fontWeight: 700 }}>{user.email}</div>
              </div>
              <div>
                <div className="label">Role</div>
                <span className="status-pill active" style={{ display: "inline-block" }}>{roleLabel}</span>
              </div>
              <div>
                <div className="label">Email status</div>
                <div style={{ fontWeight: 700 }}>{user.emailVerified ? "Verified" : "Not verified"}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Organization</h3>
            {customer ? (
              <div className="row" style={{ gap: 32, flexWrap: "wrap" }}>
                <div>
                  <div className="label">Name</div>
                  <div style={{ fontWeight: 700 }}>{customer.companyName || "N/A"}</div>
                </div>
                {customer.status && (
                  <div>
                    <div className="label">Status</div>
                    <span className={"status-pill " + customer.status} style={{ display: "inline-block" }}>{customer.status}</span>
                  </div>
                )}
                {customer.planName && (
                  <div>
                    <div className="label">Plan</div>
                    <div style={{ fontWeight: 700 }}>{customer.planName}</div>
                  </div>
                )}
              </div>
            ) : (
              <p className="muted">No organization on file yet.</p>
            )}
          </div>
        </div>

        {me.canManageOrgs && (
          <>
            <h2 style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Add Organization</h2>
            <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 13.5 }}>
              Available to Global Admin and Admin, provision a new organization record.
            </p>
            <OrganizationsManager />
          </>
        )}
      </div>
    </div>
  );
}

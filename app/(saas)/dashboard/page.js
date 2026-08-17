"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, sendEmailVerification } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import Link from "next/link";
import OnboardingModal from "@/components/OnboardingModal";
import AppTopbar from "@/components/AppTopbar";

const APPS = [
  // `sso: true` means clicking this tile goes through /api/shop-sso instead
  // of a plain link, so the person lands there already signed in with the
  // right Owner/Shopkeeper role. Other apps fall back to a plain link until
  // they get the same treatment.
  { key: "juicechatjunction", name: "Bizzux Shop", icon: "🏪", desc: "POS & shop management", live: true, url: "https://shop.bizzux.com", sso: true },
  { key: "pos", name: "Bizzux POS", icon: "🧾", desc: "Coming soon", live: false },
  { key: "orders", name: "Bizzux Orders", icon: "📋", desc: "Coming soon", live: false },
  { key: "books", name: "Bizzux Books", icon: "📒", desc: "Coming soon", live: false },
  { key: "payroll", name: "Bizzux Payroll", icon: "💰", desc: "Coming soon", live: false },
  { key: "inventory", name: "Bizzux Inventory", icon: "📦", desc: "Coming soon", live: false },
  { key: "vendors", name: "Bizzux Vendors", icon: "🚚", desc: "Coming soon", live: false },
  { key: "crm", name: "Bizzux CRM", icon: "👥", desc: "Coming soon", live: false },
  { key: "support", name: "Bizzux Support", icon: "🎧", desc: "Coming soon", live: false },
  { key: "sites", name: "Bizzux Sites", icon: "🌐", desc: "Coming soon", live: false },
];

function daysLeft(trialEndDate) {
  if (!trialEndDate) return null;
  const end = trialEndDate.toDate ? trialEndDate.toDate() : new Date(trialEndDate);
  const ms = end.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function VerifyEmailGate({ user }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [checking, setChecking] = useState(false);

  async function resend() {
    setBusy(true);
    setMsg("");
    try {
      await sendEmailVerification(user, { url: window.location.origin + "/dashboard" });
      setMsg("Sent! Take a peek at your inbox, and your spam folder just in case.");
    } catch {
      setMsg("Hmm, that didn't go through. Give it another try in a moment.");
    }
    setBusy(false);
  }

  async function checkNow() {
    setChecking(true);
    setMsg("");
    try {
      await user.reload();
      if (auth.currentUser.emailVerified) {
        router.refresh();
        window.location.reload();
      } else {
        setMsg("We don't see it just yet. Open the email, click the link, then give this another try.");
      }
    } catch {
      setMsg("Couldn't check right now, give it another moment and try again.");
    }
    setChecking(false);
  }

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>📧</div>
        <h1>Check your inbox</h1>
        <p className="sub">
          We've sent a verification link to <strong>{user.email}</strong>. Just click it,
          then hop back here to continue.
        </p>
        <button className="btn-primary" style={{ width: "100%", marginBottom: 12 }} onClick={checkNow} disabled={checking}>
          {checking ? "Checking…" : "I've verified, continue"}
        </button>
        <button className="btn-outline-dark" style={{ width: "100%" }} onClick={resend} disabled={busy}>
          {busy ? "Sending…" : "Resend verification email"}
        </button>
        {msg && <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>{msg}</p>}
        <button className="link-btn" style={{ display: "block", margin: "18px auto 0" }} onClick={() => signOut(auth)}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [customer, setCustomer] = useState(null); // null = loading
  const [isSuper, setIsSuper] = useState(false);
  const [isAccountAdmin, setIsAccountAdmin] = useState(false);
  const [accountId, setAccountId] = useState(null);
  const [openingKey, setOpeningKey] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.push("/sign-in");
        return;
      }
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
        setIsSuper(d.superAdmin === true);
        setIsAccountAdmin(d.isAccountAdmin === true);
        setAccountId(d.accountId || user.uid);
      } catch {
        setIsSuper(false);
        setAccountId(user.uid);
      }
    })();
  }, [user]);

  // Does NOT swallow errors on purpose — OnboardingModal's onDone call
  // needs the real error (e.g. a Firestore permission message) to bubble up
  // so it can show it, instead of silently doing nothing.
  async function reloadCustomer(uid) {
    const snap = await getDoc(doc(db, "customers", uid));
    setCustomer(snap.exists() ? snap.data() : {});
  }

  useEffect(() => {
    if (!user || !accountId) return;
    reloadCustomer(accountId).catch((e) => {
      console.error("Couldn't load customer doc:", e);
      setCustomer({});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, accountId]);

  if (!user || customer === null || !accountId) {
    return <div className="login-wrap"><p style={{ color: "#fff" }}>Loading…</p></div>;
  }

  // Google sign-ins already have a verified email; only email/password +
  // phone-OTP signups need this gate.
  if (!user.emailVerified) {
    return <VerifyEmailGate user={user} />;
  }

  const isOwner = accountId === user.uid;
  const remaining = daysLeft(customer.trialEndDate);
  const status = customer.status || "trial";
  const expired = status === "trial" && remaining !== null && remaining <= 0;

  async function openApp(a) {
    if (!a.sso) {
      window.open(a.url, "_blank", "noopener,noreferrer");
      return;
    }
    setOpeningKey(a.key);
    try {
      const token = await user.getIdToken();
      const r = await fetch("/api/shop-sso", { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't open that app right now");
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      alert(e.message || "Couldn't open that app right now. Please try again.");
    } finally {
      setOpeningKey(null);
    }
  }

  const topbarLinks = [
    ...(isSuper ? [{ href: "/admin", label: "Admin" }] : []),
    ...(isAccountAdmin ? [{ href: "/team", label: "Team" }] : []),
    { href: "/profile", label: "Profile" },
  ];

  return (
    <div>
      <AppTopbar links={topbarLinks} />

      {status === "trial" && !expired && remaining !== null && (
        <div className="trial-banner">
          {remaining} day{remaining === 1 ? "" : "s"} left on your free trial. Enjoy exploring!
        </div>
      )}
      {expired && (
        <div className="trial-banner expired">
          Your trial has wrapped up. Pick a plan whenever you're ready to keep going.
        </div>
      )}

      <div className="dash-body">
        <h1 className="dash-heading">
          Welcome back{customer.companyName ? `, ${customer.companyName}` : ""}!
        </h1>
        <p className="dash-sub">
          <span className={"status-pill " + status}>{status === "trial" ? "Trial" : status === "active" ? "Active" : "Expired"}</span>
          {"  "}
          {customer.planName ? <>· Plan: {customer.planName}</> : (
            <Link href="/pricing" className="btn-primary-sm" style={{ marginLeft: 8 }}>Choose a plan</Link>
          )}
        </p>

        <div className="app-grid">
          {APPS.map((a) => {
            const opening = openingKey === a.key;
            const content = (
              <>
                <div className="app-tile-icon">{a.icon}</div>
                <div className="app-tile-name">{a.name}</div>
                <div className={"app-tile-status" + (a.live ? " live" : "")}>
                  {a.live ? (opening ? "Opening…" : "Open app →") : a.desc}
                </div>
              </>
            );
            if (!a.live || !a.url) {
              return (
                <div key={a.key} className="app-tile locked">
                  {content}
                </div>
              );
            }
            // SSO apps go through openApp() (fetches a signed hand-off link
            // first); everything else is still a plain link.
            return a.sso ? (
              <button
                key={a.key} type="button" onClick={() => openApp(a)} disabled={opening}
                className="app-tile" style={{ textAlign: "left", border: "1px solid var(--line)" }}
              >
                {content}
              </button>
            ) : (
              <a
                key={a.key} href={a.url} target="_blank" rel="noopener noreferrer"
                className="app-tile"
              >
                {content}
              </a>
            );
          })}
        </div>
      </div>

      {isOwner && customer.onboarded !== true && (
        <OnboardingModal user={user} onDone={() => reloadCustomer(accountId)} />
      )}
    </div>
  );
}

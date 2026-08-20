"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, signOut, sendEmailVerification } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import Link from "next/link";
import OnboardingModal from "@/components/OnboardingModal";
import CheckoutSuccessModal from "@/components/CheckoutSuccessModal";
import TrialExpiredModal from "@/components/TrialExpiredModal";
import Nav from "@/components/Nav";
import AccountTabs from "@/components/AccountTabs";
import { IconClock } from "@/components/Icons";
import { daysLeft, canAccessApps } from "@/lib/trial";

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

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState(null);
  const [customer, setCustomer] = useState(null); // null = loading
  const [isSuper, setIsSuper] = useState(false);
  const [isAccountAdmin, setIsAccountAdmin] = useState(false);
  const [accountId, setAccountId] = useState(null);
  const [openingKey, setOpeningKey] = useState(null);
  // Both the Razorpay handler (PricingPlans.tsx) and the Stripe hosted
  // checkout's success_url (app/api/checkout/route.js) land back here with
  // ?checkout=success — this shows the congratulations modal once, then
  // strips the param so refreshing/revisiting doesn't retrigger it.
  const [showCheckoutSuccess, setShowCheckoutSuccess] = useState(false);
  // Shown instead of opening a live app when canAccessApps() (below) says
  // this account's trial has ended or its plan has lapsed.
  const [showLockedModal, setShowLockedModal] = useState(false);

  useEffect(() => {
    if (searchParams.get("checkout") === "success") {
      setShowCheckoutSuccess(true);
      router.replace("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // Gates the live app tiles only — the account/dashboard itself stays
  // reachable either way. Covers an expired trial and a lapsed
  // (past_due/cancelled) plan with the same friendly modal.
  const appsLocked = !canAccessApps(customer);

  async function openApp(a) {
    if (appsLocked) {
      setShowLockedModal(true);
      return;
    }
    if (!a.sso) {
      window.open(a.url, "_blank", "noopener,noreferrer");
      return;
    }
    setOpeningKey(a.key);
    try {
      const token = await user.getIdToken();
      const r = await fetch("/api/shop-sso", { headers: { Authorization: "Bearer " + token } });
      // The server enforces the same access rule (defense in depth, in case
      // this account's trial/plan lapsed after the page loaded) and answers
      // 402 when it does — surface the same friendly modal rather than a
      // raw alert for that case too.
      if (r.status === 402) {
        setShowLockedModal(true);
        return;
      }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't open that app right now");
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      alert(e.message || "Couldn't open that app right now. Please try again.");
    } finally {
      setOpeningKey(null);
    }
  }

  return (
    <div>
      <Nav />
      <AccountTabs active="dashboard" isAccountAdmin={isAccountAdmin} isSuper={isSuper} />

      {status === "trial" && !expired && remaining !== null && (
        <div className="trial-banner">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconClock className="w-4 h-4" />
            {remaining} day{remaining === 1 ? "" : "s"} left on your free trial. Enjoy exploring!
          </span>
          {/* Keyed on `remaining` so the CTA remounts (and its two-burst
              animation replays) whenever the day-count changes, most
              notably when the trial reaches its final day, instead of
              looping forever on every render. */}
          <Link key={"trial-cta-" + remaining} href="/pricing" className="trial-banner-cta">Choose a plan →</Link>
        </div>
      )}
      {expired && (
        <div className="trial-banner expired">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconClock className="w-4 h-4" />
            Your trial has wrapped up. Pick a plan whenever you're ready to keep going.
          </span>
          <Link key="trial-cta-expired" href="/pricing" className="trial-banner-cta">Choose a plan →</Link>
        </div>
      )}

      <div className="dash-body">
        <h1 className="dash-heading">
          Welcome back{customer.companyName ? `, ${customer.companyName}` : ""}!
        </h1>
        <p className="dash-sub" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className={"status-pill " + status}>{status === "trial" ? "Trial" : status === "active" ? "Active" : "Expired"}</span>
          {customer.planName ? (
            <span
              style={{
                display: "inline-flex", alignItems: "center",
                background: "var(--brand-gradient)", color: "#fff",
                borderRadius: 999, padding: "4px 14px", fontWeight: 700, fontSize: 12,
              }}
            >
              Plan: {customer.planName}
            </span>
          ) : (
            <Link href="/pricing" className="btn-primary-sm">Choose a plan</Link>
          )}
        </p>

        <div className="app-grid">
          {APPS.map((a) => {
            const opening = openingKey === a.key;
            // A live app still greys out (reusing the same "locked" look
            // "coming soon" tiles already use) once access is gated, so the
            // trial-ended state is visible before someone even clicks —
            // the modal on click is the explanation, this is the hint.
            const tileLocked = a.live && appsLocked;
            const content = (
              <>
                <div className="app-tile-icon">{a.icon}</div>
                <div className="app-tile-name">{a.name}</div>
                <div className={"app-tile-status" + (a.live && !tileLocked ? " live" : "")}>
                  {!a.live ? a.desc : tileLocked ? "Trial ended, choose a plan" : opening ? "Opening…" : "Open app →"}
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
            // Every live app now goes through openApp() — sso apps fetch a
            // signed hand-off link first, plain-link apps just window.open —
            // so the trial/plan gate above applies the same way regardless
            // of how a given app ends up opening.
            return (
              <button
                key={a.key} type="button" onClick={() => openApp(a)} disabled={opening}
                className={"app-tile" + (tileLocked ? " locked" : "")}
                style={{ textAlign: "left", border: "1px solid var(--line)" }}
              >
                {content}
              </button>
            );
          })}
        </div>
      </div>

      {isOwner && customer.onboarded !== true && (
        <OnboardingModal user={user} onDone={() => reloadCustomer(accountId)} />
      )}

      {showCheckoutSuccess && (
        <CheckoutSuccessModal planName={customer.planName} onClose={() => setShowCheckoutSuccess(false)} />
      )}

      {showLockedModal && (
        <TrialExpiredModal status={status} onClose={() => setShowLockedModal(false)} />
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="login-wrap"><p style={{ color: "#fff" }}>Loading…</p></div>}>
      <DashboardInner />
    </Suspense>
  );
}

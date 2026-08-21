"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "firebase/auth";
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
import { useMe } from "@/lib/useMe";
import { deriveVerificationFlags } from "@/lib/verification";

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
      // Sent through Resend (see /api/send-verification-email), not the
      // Firebase client SDK's own sendEmailVerification() — Firebase's
      // default sender has no SPF/DKIM alignment with bizzux.com and
      // reliably lands in spam.
      const token = await user.getIdToken();
      const r = await fetch("/api/send-verification-email", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ continueUrl: window.location.origin + "/dashboard" }),
      });
      if (!r.ok) throw new Error();
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

// Shown after VerifyEmailGate (if that one applies too) when this
// account's verifyMobileRequired flag (stamped at signup time by
// /api/claim, based on the Super Admin's Trial settings > Sign-up
// verification method checkboxes) is set and the phone isn't verified
// yet. Sends and checks the code through /api/send-mobile-otp and
// /api/verify-mobile-otp (MSG91) instead of Firebase's email link flow.
function VerifyMobileGate({ user, customer }) {
  const [phone, setPhone] = useState(customer.phone || "");
  const [otp, setOtp] = useState("");
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState(customer.phone || "");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const sentOnce = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function sendOtp(newPhone) {
    setSending(true);
    setErr("");
    setMsg("");
    try {
      const token = await user.getIdToken();
      const r = await fetch("/api/send-mobile-otp", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(newPhone ? { phone: newPhone } : {}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't send the code");
      if (d.phone) setPhone(d.phone);
      setMsg("Code sent! It should arrive within a minute.");
      setCooldown(30);
    } catch (e) {
      setErr(e.message || "Couldn't send the code. Please try again.");
    }
    setSending(false);
  }

  // Auto-send the first code the moment this screen mounts, so the user
  // doesn't have to press anything to get their initial OTP.
  useEffect(() => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    sendOtp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(e) {
    e.preventDefault();
    if (!otp.trim()) return;
    setVerifying(true);
    setErr("");
    setMsg("");
    try {
      const token = await user.getIdToken();
      const r = await fetch("/api/verify-mobile-otp", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ otp: otp.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "That code didn't match");
      window.location.reload();
    } catch (e2) {
      setErr(e2.message || "That code didn't match. Please check it and try again.");
    }
    setVerifying(false);
  }

  function saveNewPhone(e) {
    e.preventDefault();
    const next = phoneDraft.trim();
    if (!next || next === phone) {
      setEditingPhone(false);
      return;
    }
    setEditingPhone(false);
    sendOtp(next);
  }

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>📱</div>
        <h1>Verify your sign-up</h1>
        <p className="sub">Enter the one-time password sent to your mobile number.</p>

        {editingPhone ? (
          <form onSubmit={saveNewPhone} style={{ marginBottom: 14 }}>
            <input
              className="input" type="tel" value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              style={{ marginBottom: 8, textAlign: "center" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button type="submit" className="btn-primary-sm">Update &amp; resend</button>
              <button type="button" className="link-btn" onClick={() => { setEditingPhone(false); setPhoneDraft(phone); }}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <p style={{ marginBottom: 14 }}>
            <strong>{phone || "your number"}</strong>{" "}
            <button type="button" className="link-btn" onClick={() => { setPhoneDraft(phone); setEditingPhone(true); }}>
              Change
            </button>
          </p>
        )}

        <form onSubmit={verify}>
          <input
            className="input" type="text" inputMode="numeric" value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="Enter code"
            style={{ marginBottom: 8, textAlign: "center", letterSpacing: 2 }}
            autoFocus
          />
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            {cooldown > 0 ? (
              `Resend in ${cooldown}s`
            ) : (
              <button type="button" className="link-btn" onClick={() => sendOtp()} disabled={sending}>
                {sending ? "Sending…" : "Resend code"}
              </button>
            )}
          </p>
          <button className="btn-primary" style={{ width: "100%" }} disabled={verifying || !otp.trim()}>
            {verifying ? "Verifying…" : "Verify"}
          </button>
        </form>

        {msg && <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>{msg}</p>}
        {err && <p className="error" style={{ marginTop: 14 }}>{err}</p>}

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
  // useMe() (lib/useMe.js) shares this /api/me lookup with Nav (rendered
  // just below) instead of each firing its own duplicate request, and
  // starts a remount from the last known answer instead of a blank
  // "checking…" state.
  const { user, me } = useMe();
  const [customer, setCustomer] = useState(null); // null = loading
  const isSuper = me?.superAdmin === true;
  const isAccountAdmin = me?.isAccountAdmin === true;
  const accountId = me?.accountId || user?.uid || null;
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
    if (user === null) router.push("/sign-in");
  }, [user, router]);

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
    // Was the same dark, full-viewport .login-wrap the sign-in page uses —
    // fine for an actual takeover screen, but as a ~1-2s loading state
    // (waiting on auth + the customer doc) it read as the page going blank
    // and black. Keeping Nav visible on a light background here, the same
    // pattern AdminTabs.tsx and team/page.js already use for their own
    // loading states, makes the wait look like a normal in-page load
    // instead of a flash to a different screen.
    return (
      <div>
        <Nav />
        <div className="py-24 text-center text-slate-400">Loading…</div>
      </div>
    );
  }

  // Google sign-ins already have a verified email; only email/password
  // signups can need either gate — sometimes both, if a Super Admin has
  // both Email and Mobile enabled. Email clears first, then mobile.
  const { verifyEmailRequired, verifyMobileRequired } = deriveVerificationFlags(customer);
  if (verifyEmailRequired && !user.emailVerified) {
    return <VerifyEmailGate user={user} />;
  }
  if (verifyMobileRequired && !customer.phoneVerified) {
    return <VerifyMobileGate user={user} customer={customer} />;
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
    <Suspense
      fallback={
        <div>
          <Nav />
          <div className="py-24 text-center text-slate-400">Loading…</div>
        </div>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}

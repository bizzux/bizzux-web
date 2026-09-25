"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import Link from "next/link";
import { BUSINESS_TYPES } from "@/components/OnboardingModal";
import CheckoutSuccessModal from "@/components/CheckoutSuccessModal";
import TrialExpiredModal from "@/components/TrialExpiredModal";
import StartTrialModal from "@/components/StartTrialModal";
import Nav from "@/components/Nav";
import AccountTabs from "@/components/AccountTabs";
import { IconClock } from "@/components/Icons";
import { daysLeft, canAccessApps } from "@/lib/trial";
import { useMe } from "@/lib/useMe";
import { deriveVerificationFlags } from "@/lib/verification";
import { roleLabel } from "@/lib/roleLabel";

const APPS = [
  // `sso: true` means clicking this tile goes through /api/shop-sso instead
  // of a plain link, so the person lands there already signed in with the
  // right Owner/Shopkeeper role. Other apps fall back to a plain link until
  // they get the same treatment.
  { key: "juicechatjunction", name: "Bizzux Business", icon: "🏪", desc: "Run your sales, inventory, purchases, expenses and daily operations in one place.", live: true, url: "https://business.bizzux.com", sso: true },
  { key: "pos", name: "Bizzux POS", icon: "🧾", desc: "Dedicated billing counter — new sale, history & menu", live: true, url: "https://pos.bizzux.com", sso: true, ssoEndpoint: "/api/pos-sso" },
  { key: "notes", name: "Bizzux Notes", icon: "📝", desc: "Live meeting transcription & AI summaries", live: true, url: "https://notes.bizzux.com", sso: true, ssoEndpoint: "/api/app-sso?app=notes" },
  { key: "files", name: "Bizzux Files", icon: "🗂️", desc: "Upload or paste text files, then search across all of them", live: true, url: "https://files.bizzux.com", sso: true, ssoEndpoint: "/api/app-sso?app=files" },
  { key: "projects", name: "Bizzux Projects", icon: "🗒️", desc: "Projects and tasks on a Kanban board", live: true, url: "https://projects.bizzux.com", sso: true, ssoEndpoint: "/api/app-sso?app=projects" },
  { key: "crm", name: "Bizzux CRM", icon: "📇", desc: "Track leads, contacts, and deals through your sales pipeline", live: true, url: "https://crm.bizzux.com", sso: true, ssoEndpoint: "/api/app-sso?app=crm" },
  { key: "chat", name: "Bizzux Chat", icon: "💬", desc: "Team channels and direct messages", live: true, url: "https://chat.bizzux.com", sso: true, ssoEndpoint: "/api/app-sso?app=chat" },
  { key: "mail", name: "Bizzux Mail", icon: "📧", desc: "Your own @mail.bizzux.com inbox", live: true, url: "https://mail.bizzux.com", sso: true, ssoEndpoint: "/api/app-sso?app=mail" },
  // Personal finance tracker — its own separate Firebase project/auth (not
  // part of the shared Bizzux customer data), so it's a plain link rather
  // than an SSO hand-off like the apps above.
  { key: "paisatrack", name: "PaisaTrack", icon: "💸", desc: "Auto-tracks spending from GPay, PhonePe, bank apps & SMS", live: true, url: "https://paisatrack.bizzux.com" },
  // Shares this project's Firebase auth (same login works there), but has
  // its own standalone sign-in page rather than the SSO hand-off — plain
  // link like PaisaTrack above.
  { key: "assistant", name: "Bizzux Assistant", icon: "🗓️", desc: "Bills, loans, vehicle service & fuel — with reminders before anything's overdue", live: true, url: "https://assistant.bizzux.com" },
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

// Rule 8's view for a signed-in user who belongs to no organization yet.
//
// Shows every app straight away, ready to click, rather than a "create an
// organization" form first. A brand-new user doesn't know what an
// "organization" is or why they need one, and asking for it before they've
// seen a single app, then asking for the same name again in a second
// onboarding form, read as a paywall. Rule 1 still holds: nothing is
// created at login. The organization gets created only when someone opens
// an app that needs one, via QuickSetupModal: one name field (plus business
// type for Bizzux Business), then that app opens. Personal apps with their
// own sign-in (PaisaTrack, Assistant: plain links, no SSO) open right away
// and never need an organization at all.
//
// Also checks for a pending invite addressed to this exact email (see
// /api/my-pending-invite). Someone who signs in directly (e.g. Google)
// before opening the invite email would otherwise set up a brand-new,
// disconnected org instead of joining their team, so the invite is shown
// first with a direct Accept button, and the quick-setup modal repeats it.
function NoOrganizationDashboard() {
  const [setupApp, setSetupApp] = useState(null);
  const [pendingInvite, setPendingInvite] = useState(undefined); // undefined = checking, null = none
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await auth.currentUser.getIdToken();
        const r = await fetch("/api/my-pending-invite", { headers: { Authorization: "Bearer " + token } });
        const d = await r.json();
        if (!cancelled) setPendingInvite(r.ok ? d.invite : null);
      } catch {
        if (!cancelled) setPendingInvite(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function acceptInvite() {
    setAccepting(true);
    setAcceptError("");
    try {
      const token = await auth.currentUser.getIdToken();
      const r = await fetch("/api/team/accept", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ invite: pendingInvite.token }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't accept that invite.");
      window.location.reload();
    } catch (e) {
      setAcceptError(e.message);
      setAccepting(false);
    }
  }

  function openApp(a) {
    if (!a.sso) {
      window.open(a.url, "_blank", "noopener,noreferrer");
      return;
    }
    setSetupApp(a);
  }

  const u = auth.currentUser;
  const firstName = ((u && (u.displayName || u.email)) || "").split(/[@\s]/)[0];

  return (
    <div>
      <Nav />
      <AccountTabs active="dashboard" isAccountAdmin={false} isSuper={false} roleLabel="" />
      <div className="dash-body">
        <h1 className="dash-heading">Welcome to Bizzux{firstName ? `, ${firstName}` : ""}!</h1>
        <p className="dash-sub">Pick an app to get started. Try every app free after a quick mobile verification, no card needed.</p>

        {pendingInvite && (
          <div className="card" style={{ marginBottom: 20, background: "#f0fdf4", borderColor: "#bbf7d0" }}>
            <h3 style={{ marginTop: 0, marginBottom: 4 }}>You've been invited!</h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              Join <strong>{pendingInvite.orgName}</strong> to use Bizzux with your team. You can accept right here.
            </p>
            <button className="btn-primary-sm" onClick={acceptInvite} disabled={accepting}>
              {accepting ? "Joining…" : `Accept invite to ${pendingInvite.orgName}`}
            </button>
            {acceptError && <p className="error" style={{ marginTop: 8 }}>{acceptError}</p>}
          </div>
        )}

        <div className="app-grid">
          {APPS.filter((a) => a.live && a.url).map((a) => (
            <button
              key={a.key} type="button" onClick={() => openApp(a)}
              className="app-tile"
              style={{ textAlign: "left", border: "1px solid var(--line)" }}
            >
              <div className="app-tile-icon">{a.icon}</div>
              <div className="app-tile-name">{a.name}</div>
              <div className="app-tile-status live">Open app →</div>
            </button>
          ))}
        </div>

        {pendingInvite === null && (
          <p className="muted" style={{ fontSize: 13, marginTop: 20 }}>
            Joining your team's Bizzux? Open the invite link they emailed you instead.
          </p>
        )}
      </div>

      {setupApp && (
        <QuickSetupModal
          app={setupApp}
          pendingInvite={pendingInvite}
          onAcceptInvite={acceptInvite}
          onClose={() => setSetupApp(null)}
        />
      )}
    </div>
  );
}

// Best guess from the browser, so quick setup doesn't have to ask. Both can
// be changed later; this just avoids a wrong default like INR for a Dubai shop.
function detectLocale() {
  let timezone = "Asia/Kolkata";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
  } catch {}
  const currency =
    timezone === "Asia/Dubai" ? "AED"
    : timezone === "Europe/London" ? "GBP"
    : timezone.startsWith("America/") ? "USD"
    : "INR";
  return { timezone, currency };
}

// The only setup step a new user sees. It's asked when they first open a
// company app, so the question has an obvious reason. Creates the
// organization, then opens the app they clicked.
function QuickSetupModal({ app, pendingInvite, onAcceptInvite, onClose }) {
  const askBusinessType = app.key === "juicechatjunction";
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("shop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Enter your business name");
      return;
    }
    // Opened synchronously, inside the click, then pointed at the app once
    // its sign-in link is ready. Opening it after the awaits below would be
    // treated as an unrequested pop-up and blocked.
    const win = window.open("about:blank", "_blank");
    setBusy(true);
    setError("");
    try {
      const token = await auth.currentUser.getIdToken();
      const { timezone, currency } = detectLocale();
      const r = await fetch("/api/organizations", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: name.trim(),
          timezone,
          currency,
          // POS is the shop billing counter, so opening it implies a shop.
          businessType: askBusinessType ? businessType : app.key === "pos" ? "shop" : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't set up your business");

      // Email/mobile verification is only enforced by the dashboard's
      // gates, not by the SSO hand-off, so an account that still has to
      // verify goes back to the dashboard (which now shows the gate)
      // instead of straight into the app.
      const cSnap = await getDoc(doc(db, "customers", auth.currentUser.uid));
      const c = cSnap.exists() ? cSnap.data() : {};
      const v = deriveVerificationFlags(c);
      if ((v.verifyEmailRequired && !auth.currentUser.emailVerified) || (v.verifyMobileRequired && !c.phoneVerified)) {
        if (win) win.close();
        window.location.reload();
        return;
      }
      // New businesses start with the free trial not yet started: the
      // dashboard asks for mobile verification first, then opens this app.
      if (c.status === "trial_pending") {
        if (win) win.close();
        window.location.href = "/dashboard?startTrial=" + encodeURIComponent(app.key);
        return;
      }

      const s = await fetch(app.ssoEndpoint || "/api/shop-sso", { headers: { Authorization: "Bearer " + token } });
      const sd = await s.json();
      if (!s.ok) throw new Error(sd.error || "Your business is set up, but " + app.name + " couldn't open. Try it again from the dashboard.");

      if (win) {
        win.opener = null;
        win.location.href = sd.url;
        window.location.reload();
      } else {
        window.location.href = sd.url;
      }
    } catch (e2) {
      if (win) win.close();
      setError(e2.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="onboarding-hi">{app.icon} {app.name}</div>
        <h2 style={{ marginBottom: 4 }}>What's your business called?</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Just this once, then {app.name} opens. It's also how your team will see you when you invite them.
        </p>

        {pendingInvite && (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13 }}>
            You already have an invite to <strong>{pendingInvite.orgName}</strong>. If that's your workplace,{" "}
            <button type="button" className="link-btn" onClick={onAcceptInvite}>join it instead</button>.
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <div style={{ marginBottom: 14 }}>
            <label className="label">Business name *</label>
            <input
              className="input" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Thilak Traders" autoFocus required
            />
          </div>
          {askBusinessType && (
            <div style={{ marginBottom: 14 }}>
              <label className="label">What kind of business is it?</label>
              <select className="input" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
                {BUSINESS_TYPES.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </div>
          )}
          <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
            Free trial after a quick mobile verification, no card needed. You can change the name later in your Profile.
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-outline-dark" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? "Opening…" : `Open ${app.name}`}</button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}

// Asked once, the first time an owner opens Bizzux Business when their org
// was set up from some other app (whose quick setup doesn't ask this).
// bizzux-shop only takes the business type on its first sign-in, so it has
// to be settled before that hand-off.
function BusinessTypeModal({ user, app, onClose, onSaved }) {
  const [businessType, setBusinessType] = useState("shop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    // Same pop-up-blocker reasoning as QuickSetupModal.
    const win = window.open("about:blank", "_blank");
    setBusy(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const r = await fetch("/api/onboarding", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ businessTypeOnly: true, businessType }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save that");
      onSaved(businessType);

      const s = await fetch(app.ssoEndpoint || "/api/shop-sso", { headers: { Authorization: "Bearer " + token } });
      if (s.status === 402) throw new Error("Your trial has ended. Choose a plan to keep using Bizzux apps.");
      const sd = await s.json();
      if (!s.ok) throw new Error(sd.error || "Couldn't open " + app.name + " right now");
      if (win) {
        win.opener = null;
        win.location.href = sd.url;
      } else {
        window.location.href = sd.url;
      }
      onClose();
    } catch (e2) {
      if (win) win.close();
      setError(e2.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="onboarding-hi">🏪 Bizzux Business</div>
        <h2 style={{ marginBottom: 4 }}>What kind of business is it?</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>So Bizzux Business shows the right tools for you.</p>
        <form onSubmit={submit} noValidate>
          <div style={{ marginBottom: 16 }}>
            <select className="input" value={businessType} onChange={(e) => setBusinessType(e.target.value)} autoFocus>
              {BUSINESS_TYPES.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-outline-dark" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Continue"}</button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}

// Rule 9's switcher — only ever renders anything once a user actually
// belongs to 2+ organizations (today that's rare: the only way in is
// accepting a team invite while already owning your own organization), so
// this is a no-op for the common single-org case. Switching reloads the
// page rather than trying to live-patch every already-loaded piece of
// organization-scoped state on this screen.
function OrgSwitcher() {
  const [organizations, setOrganizations] = useState(null);
  const [current, setCurrent] = useState(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await auth.currentUser.getIdToken();
        const r = await fetch("/api/organizations", { headers: { Authorization: "Bearer " + token } });
        const d = await r.json();
        setOrganizations(d.organizations || []);
        setCurrent(d.currentOrganizationId || null);
      } catch {
        setOrganizations([]);
      }
    })();
  }, []);

  if (!organizations || organizations.length < 2) return null;

  async function switchTo(organizationId) {
    setSwitching(true);
    try {
      const token = await auth.currentUser.getIdToken();
      await fetch("/api/organizations", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch", organizationId }),
      });
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  }

  return (
    <div style={{ margin: "8px 0 4px" }}>
      <label className="label" style={{ marginRight: 8 }}>Organization</label>
      <select
        className="input" style={{ display: "inline-block", width: "auto", fontSize: 13 }}
        value={current || ""} disabled={switching}
        onChange={(e) => switchTo(e.target.value)}
      >
        {organizations.map((o) => (
          <option key={o.organizationId} value={o.organizationId}>{o.name} ({o.role})</option>
        ))}
      </select>
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
  // Set to the Bizzux Business app entry while BusinessTypeModal is open.
  const [businessTypeApp, setBusinessTypeApp] = useState(null);
  // Phone-verified trial start (org status "trial_pending"): the app the
  // person was trying to open, or {} when started from the banner.
  const [trialApp, setTrialApp] = useState(null);
  const [trialDays, setTrialDays] = useState(null);

  useEffect(() => {
    if (customer?.status !== "trial_pending") return;
    fetch("/api/pricing")
      .then((r) => r.json())
      .then((d) => setTrialDays(d.trialDays || null))
      .catch(() => {});
    const key = searchParams.get("startTrial");
    if (key) {
      setTrialApp(APPS.find((a) => a.key === key) || {});
      router.replace("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.status]);

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

  // Catches a bookmarked/direct /dashboard visit after an admin-created
  // login was flagged to force a password change — the redirect right
  // after sign-in (app/(saas)/sign-in/page.js) only covers the moment of
  // signing in itself.
  useEffect(() => {
    if (!me) return;
    if (me.mustChangePassword) {
      router.replace("/change-password");
    } else if (me.twoFactorRequired && !me.twoFactorEnabled) {
      router.replace("/setup-2fa");
    } else if (me.twoFactorEnabled && sessionStorage.getItem("2fa_verified") !== "true") {
      router.replace("/verify-2fa");
    }
  }, [me, router]);

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

  // Bizzux rule 1/8: a login is free and can exist without any
  // organization. /api/me's hasAccount already tells us this (resolveAccount
  // failing means no customers/ and no memberships/ doc) — checked BEFORE
  // the customer-doc-dependent logic below, because an empty {} customer
  // object (what a nonexistent doc reads back as) would otherwise satisfy
  // canAccessApps({}) as an eternally-valid trial. See NoOrganizationDashboard.
  if (user && me && me.hasAccount === false) {
    return <NoOrganizationDashboard />;
  }

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
  // (past_due/cancelled) plan with the same friendly modal. Super Admin
  // always bypasses this, same as /api/shop-sso already treats them as
  // unlimited access regardless of their own account's trial/plan status.
  const appsLocked = !isSuper && !canAccessApps(customer);
  const trialPending = !isSuper && status === "trial_pending";

  async function openApp(a) {
    if (trialPending) {
      // Plain-link personal apps (own sign-in) never needed a business
      // trial; everything else waits for the phone-verified trial.
      if (!a.sso && !a.internal) window.open(a.url, "_blank", "noopener,noreferrer");
      else setTrialApp(a);
      return;
    }
    if (appsLocked) {
      setShowLockedModal(true);
      return;
    }
    if (a.internal) {
      router.push(a.url);
      return;
    }
    if (!a.sso) {
      window.open(a.url, "_blank", "noopener,noreferrer");
      return;
    }
    // Org was set up from another app's quick setup, which doesn't ask for
    // a business type. Ask now, before bizzux-shop's first sign-in seeds it.
    if (a.key === "juicechatjunction" && isOwner && customer.businessTypePending) {
      setBusinessTypeApp(a);
      return;
    }
    setOpeningKey(a.key);
    try {
      const token = await user.getIdToken();
      const r = await fetch(a.ssoEndpoint || "/api/shop-sso", { headers: { Authorization: "Bearer " + token } });
      // The server enforces the same access rule (defense in depth, in case
      // this account's trial/plan lapsed after the page loaded) and answers
      // 402 when it does — surface the same friendly modal rather than a
      // raw alert for that case too.
      const d = await r.json();
      if (r.status === 402) {
        if (d.code === "TRIAL_NOT_STARTED") setTrialApp(a);
        else if (d.code === "APP_NOT_IN_PLAN") {
          if (confirm(d.error + "\n\nSee plans now?")) router.push("/pricing");
        } else setShowLockedModal(true);
        return;
      }
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
      <AccountTabs active="dashboard" isAccountAdmin={isAccountAdmin} isSuper={isSuper} roleLabel={isSuper ? "Platform " + (me?.platformRole === "OWNER" ? "Owner" : "Admin") : roleLabel(me)} />

      {trialPending && (
        <div className="trial-banner">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconClock className="w-4 h-4" />
            Start your {trialDays ? `${trialDays}-day ` : ""}free trial: verify your mobile number and every app unlocks. No card needed.
          </span>
          <button type="button" className="trial-banner-cta" onClick={() => setTrialApp({})}>Start free trial →</button>
        </div>
      )}
      {!isSuper && status === "trial" && !expired && remaining !== null && (
        <div className="trial-banner">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconClock className="w-4 h-4" />
            Free trial: all apps unlocked for {remaining} more day{remaining === 1 ? "" : "s"}. No card needed.
          </span>
          {/* Only in the last week. Shown (and animated) from day one, it
              read as "you have to pay before you can use this", and new
              users were reaching out about being asked for a subscription.
              Keyed on `remaining` so the CTA remounts (and its two-burst
              animation replays) whenever the day-count changes. */}
          {remaining <= 7 && (
            <Link key={"trial-cta-" + remaining} href="/pricing" className="trial-banner-cta">Choose a plan →</Link>
          )}
        </div>
      )}
      {/* Super Admin always has full access (see appsLocked above), so
          showing "trial has wrapped up" here — while every app tile
          actually says "Open app" — reads as a bug rather than a status
          message. Their own customers/ record can genuinely still be
          expired (e.g. a real trial that lapsed before they were made
          Super Admin); it just shouldn't be surfaced as a blocker. */}
      {!isSuper && expired && (
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
          Welcome{customer.companyName ? `, ${customer.companyName}` : ""}!
        </h1>
        <OrgSwitcher />
        <p className="dash-sub" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className={"status-pill " + (status === "trial_pending" ? "trial" : status)}>
            {status === "trial" ? "Free trial" : status === "trial_pending" ? "Trial not started" : status === "active" ? "Active" : "Expired"}
          </span>
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
          ) : (status === "trial" && !expired) || trialPending ? null : (
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
            const tileLocked = a.live && appsLocked && !trialPending;
            const content = (
              <>
                <div className="app-tile-icon">{a.icon}</div>
                <div className="app-tile-name">{a.name}</div>
                <div className={"app-tile-status" + (a.live && !tileLocked ? " live" : "")}>
                  {!a.live ? a.desc : tileLocked ? "Trial ended, choose a plan" : opening ? "Opening…" : trialPending && a.sso ? "Start free trial →" : "Open app →"}
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

      {/* OnboardingModal used to pop up here on an owner's first visit.
          Setup is now the single question asked when someone first opens
          a company app (QuickSetupModal); a second form asking for the
          same name again was one of the things confusing new users. */}
      {businessTypeApp && (
        <BusinessTypeModal
          user={user} app={businessTypeApp}
          onClose={() => setBusinessTypeApp(null)}
          onSaved={(businessType) => setCustomer((c) => ({ ...c, businessType, businessTypePending: false }))}
        />
      )}

      {showCheckoutSuccess && (
        <CheckoutSuccessModal planName={customer.planName} onClose={() => setShowCheckoutSuccess(false)} />
      )}

      {showLockedModal && (
        <TrialExpiredModal status={status} onClose={() => setShowLockedModal(false)} />
      )}

      {trialApp && (
        <StartTrialModal
          appName={trialApp.name}
          trialDays={trialDays}
          defaultPhone={customer.phone}
          onClose={() => setTrialApp(null)}
          onStarted={() => reloadCustomer(accountId).catch(() => {})}
          onOpenApp={trialApp.key ? () => { const a = trialApp; setTrialApp(null); openApp(a); } : undefined}
        />
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

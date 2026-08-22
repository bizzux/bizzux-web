"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Container, Eyebrow, CTAButton } from "@/components/Section";
import {
  IconWallet, IconUsers, IconCheck, IconClock, IconX, IconShare,
  IconUserCircle, IconGift, IconSwap,
} from "@/components/Icons";

// The Partners program: refer Bizzux to a new customer with your own code,
// they get a discount, you earn a one-time commission once their first
// payment goes through. See lib/referral.js and the "Reseller / Partner
// program" comments in app/api/checkout/route.js and the webhook handlers
// for how a code actually gets applied and a commission credited.
//
// This one page covers both the pitch (signed out) and, once approved, the
// Partner's own dashboard (referral code, share link, running earnings) —
// the same flip-on-auth-state pattern already used by Nav's Sign in/Sign
// up -> Profile slot.
type Rates = { resellerDiscountPercent: number; resellerCommissionPercent: number };
type ResellerMe =
  | { registered: false }
  | {
      registered: true;
      status: "pending" | "approved" | "rejected" | "suspended";
      referralCode: string;
      fullName: string;
      totalReferrals: number;
      totalEarnings: number;
      pendingPayout: number;
      paidOut: number;
    };

async function api(path: string, token: string, method = "GET", body?: any) {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

// A light card sitting on the page's normal background below the
// referral-code panel (that panel and these tiles both now sit outside the
// navy hero, see the -mt-* overlap wrapper above). Each tile keeps its own
// circular flat-color icon badge (accentClass) rather than a shared
// gradient square, echoing the reference layout's varied per-tile accents.
function statTile(label: string, value: string, Icon: any, accentClass: string) {
  return (
    <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm text-center" key={label}>
      <div className={`w-9 h-9 rounded-full ${accentClass} flex items-center justify-center mx-auto mb-2`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="text-xl font-bold text-ink">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

// A "ghost-light" outline pill (white border, white text, translucent
// white hover fill) — the same treatment CTAButton's ghost-light variant
// uses for buttons that sit directly on a brand-gradient background (see
// components/Section.tsx), since this now sits on the gradient referral-code
// panel rather than a white one.
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can fail (older browser, permissions) — the
          // value is still visible and selectable, so this is non-fatal.
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/40 text-white hover:bg-white/10 transition-colors text-xs font-semibold px-3 py-1.5 whitespace-nowrap"
    >
      {copied ? "Copied!" : "Copy code"}
    </button>
  );
}

// Sits next to the share link. On a phone or any browser that supports the
// Web Share API, tapping it opens the device's own native share sheet
// (WhatsApp, Messages, Email, etc.) pre-filled with the link — exactly the
// "options to share" a Partner is asking for. Falls back to copying the
// link to the clipboard on browsers without that API (most desktop
// browsers today).
function ShareButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    const nav = typeof navigator !== "undefined" ? (navigator as any) : null;
    if (nav?.share) {
      try {
        await nav.share({ title: "Join Bizzux with my referral code", url: value });
        return;
      } catch {
        // Share sheet dismissed/cancelled, or share isn't actually usable
        // here — fall through to the clipboard copy below instead.
      }
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Non-fatal — the link is still visible and selectable on the page.
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Share this link"
      className="inline-flex items-center gap-1.5 rounded-full border border-white/40 text-white hover:bg-white/10 transition-colors text-xs font-semibold px-3 py-1.5 whitespace-nowrap"
    >
      <IconShare className="w-3.5 h-3.5" />
      {copied ? "Copied!" : "Share link"}
    </button>
  );
}

// A themed status card, matching the gradient-icon-badge language used
// everywhere else on the site (the emailSetupItems cards on
// /custom-solutions, the "Bizzux Shop is live" panel on the homepage) —
// used for every state where there's nothing to do but wait or read a
// message: pending review, rejected, suspended. "tone" picks the badge
// gradient and the card's accent border: pending reads as in-progress
// (amber/orange, matching the site's warm accent), blocked reads as an
// actual stop state using the same red the admin app already uses for
// "expired" status pills (app/bzx-app.css's .status-pill.expired), rather
// than a flat, low-contrast gray that didn't read as anything in particular.
function StatusCard({
  tone, Icon, title, children,
}: {
  tone: "pending" | "blocked";
  Icon: any;
  title: string;
  children: React.ReactNode;
}) {
  const badgeClass =
    tone === "pending"
      ? "bg-gradient-to-br from-amber-400 to-orange-500"
      : "bg-gradient-to-br from-rose-500 to-red-600";
  const borderClass = tone === "pending" ? "border-amber-100" : "border-red-100";
  return (
    <div className={`text-center bg-white rounded-2xl border ${borderClass} shadow-sm p-10 max-w-lg mx-auto`}>
      <div className={`w-16 h-16 rounded-full ${badgeClass} text-white flex items-center justify-center mx-auto mb-5 shadow-md`}>
        <Icon className="w-7 h-7" />
      </div>
      <h2 className="text-xl font-bold mb-2 text-ink">{title}</h2>
      <p className="text-sm font-medium text-slate-700">{children}</p>
    </div>
  );
}

export default function PartnersPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [rates, setRates] = useState<Rates | null>(null);
  const [reseller, setReseller] = useState<ResellerMe | null>(null);
  const [form, setForm] = useState({
    fullName: "", phone: "", businessName: "",
    payoutMethod: "upi", upiId: "", accountHolder: "", accountNumber: "", ifsc: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  // Phone verification for the application form — separate from the phone
  // number an applicant's own Bizzux account may already have verified at
  // signup, since a Partner can want their commission-payout contact number
  // to be a different one and Super Admin approval alone doesn't catch a
  // mistyped/fake number. otpPhone freezes the exact number a code was sent
  // to, so editing form.phone afterwards can't silently carry over a stale
  // "verified" state for a number that was never actually checked.
  const [otpSent, setOtpSent] = useState(false);
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpErr, setOtpErr] = useState("");

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = setInterval(() => setOtpCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [otpCooldown]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/reseller/rates");
        setRates(await res.json());
      } catch {
        setRates({ resellerDiscountPercent: 10, resellerCommissionPercent: 20 });
      }
    })();
  }, []);

  useEffect(() => {
    if (!user) { setReseller(null); return; }
    (async () => {
      try {
        const token = await user.getIdToken();
        const data = await api("/api/reseller/me", token);
        setReseller(data);
        if (data.registered) {
          setForm((f) => ({ ...f, fullName: data.fullName || f.fullName }));
        }
      } catch {
        setReseller({ registered: false });
      }
    })();
  }, [user]);

  // Editing the phone number after a code was sent (or after it was
  // verified) invalidates whatever was checked before — otpPhone no longer
  // matches form.phone, so phoneVerified/otpSent reset and the applicant
  // has to verify the new number before they can submit.
  function onPhoneChange(value: string) {
    setForm((f) => ({ ...f, phone: value }));
    if (value !== otpPhone) {
      setPhoneVerified(false);
      setOtpSent(false);
      setOtpCode("");
    }
  }

  async function sendOtp() {
    if (!user || !form.phone.trim()) return;
    setSendingOtp(true);
    setOtpErr("");
    try {
      const token = await user.getIdToken();
      await api("/api/reseller/send-otp", token, "POST", { phone: form.phone.trim() });
      setOtpPhone(form.phone.trim());
      setOtpSent(true);
      setOtpCooldown(30);
    } catch (e: any) {
      setOtpErr(e.message);
    }
    setSendingOtp(false);
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !otpCode.trim()) return;
    setVerifyingOtp(true);
    setOtpErr("");
    try {
      const token = await user.getIdToken();
      await api("/api/reseller/verify-otp", token, "POST", { phone: otpPhone, otp: otpCode.trim() });
      setPhoneVerified(true);
    } catch (e2: any) {
      setOtpErr(e2.message);
    }
    setVerifyingOtp(false);
  }

  async function submitApplication(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setErr("");
    try {
      const token = await user.getIdToken();
      const data = await api("/api/reseller/apply", token, "POST", form);
      setReseller({
        registered: true,
        status: data.status,
        referralCode: data.referralCode,
        fullName: form.fullName,
        totalReferrals: 0,
        totalEarnings: 0,
        pendingPayout: 0,
        paidOut: 0,
      });
    } catch (e2: any) {
      setErr(e2.message);
    }
    setSubmitting(false);
  }

  const discountPercent = rates?.resellerDiscountPercent ?? 10;
  const commissionPercent = rates?.resellerCommissionPercent ?? 20;
  const shareLink = reseller?.registered ? `https://bizzux.com/pricing?ref=${reseller.referralCode}` : "";

  return (
    <>
      <section className="pt-12 pb-6 md:pb-8 bg-navy text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-40" style={{
          background: "radial-gradient(50% 50% at 80% 20%, rgba(163,230,53,0.2) 0%, transparent 60%)"
        }} />
        <Container className="relative">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-2">
            <div className="max-w-xl">
              <Eyebrow light>Partners</Eyebrow>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
                Refer Bizzux. Your customer saves.
                <br />
                <span className="text-brand-cyan">You earn.</span>
              </h1>
              <p className="text-slate-300">
                Give your customers {discountPercent}% off their first payment and earn a {commissionPercent}%
                commission when they pay.
              </p>
            </div>
            {/* "refer a friend, earn a reward" illustration: two person
                badges with a swap arrow between them, a gift badge below
                center — purely decorative, hidden on narrow screens where
                there's no room for it next to the headline. */}
            <div className="hidden md:block relative w-40 h-28 shrink-0 self-center">
              <div className="absolute top-0 left-0 w-14 h-14 rounded-full bg-white/10 border border-white/15 flex items-center justify-center">
                <IconUserCircle className="w-7 h-7 text-white" />
              </div>
              <IconSwap className="absolute top-4 left-16 w-8 h-8 text-brand-cyan" />
              <div className="absolute top-0 right-0 w-14 h-14 rounded-full bg-white/10 border border-white/15 flex items-center justify-center">
                <IconUserCircle className="w-7 h-7 text-white" />
              </div>
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-brand-cyan/20 border border-brand-cyan/40 flex items-center justify-center">
                <IconGift className="w-5 h-5 text-brand-cyan" />
              </div>
            </div>
          </div>

          {/* Extra bottom room only when the approved dashboard below is
              about to overlap this section's tail — see the -mt-* wrapper
              right after this section closes. Without this spacer the navy
              background would end too early and get clipped by the white
              panel's own top corners. */}
          {user && reseller && reseller.registered && reseller.status === "approved" && (
            <div className="h-16 md:h-20" />
          )}
        </Container>
      </section>

      {/* The approved Partner's own dashboard (referral code, share link,
          running stats) sits OUTSIDE the navy section on purpose, pulled up
          with a negative margin so only its top half overlaps the hero's
          dark background — the rest of it, and the stat tiles below it,
          sit on the page's normal light background instead of navy
          continuing all the way down. */}
      {user && reseller && reseller.registered && reseller.status === "approved" && (
        <div className="px-6 -mt-16 md:-mt-20 relative z-10">
          <Container className="!px-0">
            <div className="bg-gradient-to-br from-brand-tealDark to-brand-blueDark rounded-2xl p-6 sm:p-8 grid sm:grid-cols-2 gap-6 sm:gap-0 divide-y sm:divide-y-0 sm:divide-x divide-white/25 mb-6 shadow-xl shadow-slate-900/10">
              <div className="sm:pr-8 pb-6 sm:pb-0 text-center sm:text-left">
                <p className="text-xs font-semibold text-white mb-1.5">Your referral code</p>
                <p className="text-2xl font-extrabold text-white tracking-widest mb-3">{reseller.referralCode}</p>
                <CopyButton value={reseller.referralCode} />
              </div>
              <div className="sm:pl-8 pt-6 sm:pt-0 text-center sm:text-left">
                <p className="text-xs font-semibold text-white mb-1.5">Your referral link</p>
                <p className="text-sm text-white font-mono break-all mb-3">{shareLink}</p>
                <ShareButton value={shareLink} />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-4">
              {[
                statTile("People referred", String(reseller.totalReferrals), IconUsers, "bg-brand-tealDark"),
                statTile("Total earnings", `₹${reseller.totalEarnings.toLocaleString("en-IN")}`, IconWallet, "bg-brand-blueDark"),
                statTile("Pending payout", `₹${reseller.pendingPayout.toLocaleString("en-IN")}`, IconWallet, "bg-indigo-500"),
                statTile("Total paid", `₹${reseller.paidOut.toLocaleString("en-IN")}`, IconCheck, "bg-brand-cyanDark"),
              ]}
            </div>
          </Container>
        </div>
      )}

      <section className="pt-8 pb-14 md:pt-10">
        <Container className="max-w-3xl">
          {user === undefined && <p className="text-center text-slate-500">Loading…</p>}

          {user === null && (
            <div className="text-center">
              <p className="text-slate-600 mb-6">Sign in to apply, it takes less than a minute.</p>
              <CTAButton href="/sign-in?mode=signup">Sign in to apply</CTAButton>
            </div>
          )}

          {user && reseller === null && <p className="text-center text-slate-500">Loading…</p>}

          {user && reseller && !reseller.registered && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 max-w-xl mx-auto">
              <h2 className="text-xl font-bold mb-1">Apply to become a Partner</h2>
              <p className="text-sm text-slate-500 mb-6">
                A Super Admin reviews every application before your referral code goes live.
              </p>
              <form onSubmit={submitApplication} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Full name</label>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Phone</label>
                  <p className="text-xs text-slate-500 mb-1.5">
                    We verify this with a one-time code so commission payouts always have a working contact number.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                      value={form.phone} onChange={(e) => onPhoneChange(e.target.value)}
                      disabled={phoneVerified}
                      required
                    />
                    {phoneVerified ? (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-green-50 text-green-700 text-xs font-semibold px-3 whitespace-nowrap">
                        <IconCheck className="w-3.5 h-3.5" /> Verified
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={sendOtp}
                        disabled={sendingOtp || !form.phone.trim() || (otpSent && form.phone.trim() === otpPhone && otpCooldown > 0)}
                        className="shrink-0 rounded-lg border border-slate-200 text-xs font-semibold px-3 py-2 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                      >
                        {sendingOtp
                          ? "Sending…"
                          : otpSent && form.phone.trim() === otpPhone
                          ? (otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Resend code")
                          : "Send code"}
                      </button>
                    )}
                  </div>

                  {otpSent && !phoneVerified && form.phone.trim() === otpPhone && (
                    <div className="mt-2.5 flex gap-2">
                      <input
                        type="text" inputMode="numeric"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tracking-widest"
                        placeholder="Enter code"
                        value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/[^\d]/g, ""))}
                      />
                      <button
                        type="button"
                        onClick={verifyOtp}
                        disabled={verifyingOtp || !otpCode.trim()}
                        className="shrink-0 rounded-lg bg-ink text-white text-xs font-semibold px-4 py-2 hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                      >
                        {verifyingOtp ? "Checking…" : "Confirm code"}
                      </button>
                    </div>
                  )}
                  {otpErr && <p className="text-xs text-red-600 mt-1.5">{otpErr}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Business name (optional)</label>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">How should we pay your commission?</label>
                  <div className="flex gap-4 text-sm mb-3">
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={form.payoutMethod === "upi"} onChange={() => setForm({ ...form, payoutMethod: "upi" })} />
                      UPI
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={form.payoutMethod === "bank"} onChange={() => setForm({ ...form, payoutMethod: "bank" })} />
                      Bank transfer
                    </label>
                  </div>
                  {form.payoutMethod === "upi" ? (
                    <input
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      placeholder="yourname@upi" value={form.upiId} onChange={(e) => setForm({ ...form, upiId: e.target.value })} required
                    />
                  ) : (
                    <div className="space-y-2">
                      <input
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder="Account holder name" value={form.accountHolder}
                        onChange={(e) => setForm({ ...form, accountHolder: e.target.value })} required
                      />
                      <input
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder="Account number" value={form.accountNumber}
                        onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} required
                      />
                      <input
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder="IFSC code" value={form.ifsc}
                        onChange={(e) => setForm({ ...form, ifsc: e.target.value })} required
                      />
                    </div>
                  )}
                </div>
                <button
                  className="w-full h-10 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white text-sm font-semibold px-5 hover:opacity-90 transition-opacity disabled:opacity-60"
                  disabled={submitting}
                >
                  {submitting ? "Submitting…" : "Submit application"}
                </button>
                {err && <p className="text-sm text-red-600">{err}</p>}
              </form>
            </div>
          )}

          {user && reseller && reseller.registered && reseller.status === "pending" && (
            <StatusCard tone="pending" Icon={IconClock} title="Application under review">
              Thanks for applying. We&apos;ll activate your referral code as soon as it&apos;s reviewed, usually within a
              day or two.
            </StatusCard>
          )}

          {user && reseller && reseller.registered && (reseller.status === "rejected" || reseller.status === "suspended") && (
            <StatusCard tone="blocked" Icon={IconX} title={reseller.status === "rejected" ? "Application not approved" : "Partner account suspended"}>
              Get in touch with us if you think this isn&apos;t right.
            </StatusCard>
          )}

          {/* The approved state's own dashboard (referral code, share link,
              stats) renders in the overlap block right after the hero
              section above instead of here — nothing left to show in this
              white section for that state. */}
        </Container>
      </section>

      <section className="py-14 pb-24 bg-slate-50 text-center">
        <Container className="max-w-xl">
          <h2 className="text-xl font-bold mb-3">Questions about the Partner program?</h2>
          <p className="text-slate-600 mb-6">Reach out and we&apos;ll walk you through how it works.</p>
          <Link href="/contact" className="text-brand-blue font-semibold hover:underline">Contact us →</Link>
        </Container>
      </section>
    </>
  );
}

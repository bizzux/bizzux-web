"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";

// Available to every signed-in account — organization owner, team member,
// or Platform Admin/Owner alike, since the underlying twoFactor/{uid}
// record is keyed on the uid alone (see lib/twoFactor.js). Platform
// Admin/Owner logins are exactly the ones most worth protecting this way:
// email accounts get phished/reused far more often than an authenticator
// app gets compromised.
async function authedFetch(path, body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

export default function TwoFactorSettings({ enabled, method, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // "choose" (pick email or authenticator) -> "email-verify" / "totp-verify"
  const [step, setStep] = useState("idle");
  const [code, setCode] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [totpSecret, setTotpSecret] = useState("");

  function reset() {
    setStep("idle");
    setCode("");
    setQrDataUrl(null);
    setError("");
  }

  async function startEmailSetup() {
    setBusy(true);
    setError("");
    try {
      await authedFetch("/api/2fa/send-email-code");
      setStep("email-verify");
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  async function startTotpSetup() {
    setBusy(true);
    setError("");
    try {
      const d = await authedFetch("/api/2fa/totp/start");
      setQrDataUrl(d.qrDataUrl);
      setTotpSecret(d.secret);
      setStep("totp-verify");
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  async function confirmSetup(setupMethod) {
    setBusy(true);
    setError("");
    try {
      await authedFetch("/api/2fa/verify", { code, setup: true, method: setupMethod });
      reset();
      onChanged && onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  async function disable() {
    if (!confirm("Turn off two-factor authentication?")) return;
    setBusy(true);
    setError("");
    try {
      await authedFetch("/api/2fa/disable");
      onChanged && onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  if (enabled) {
    return (
      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginBottom: 10, fontSize: 14.5 }}>Two-factor authentication</h3>
        <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
          Enabled via {method === "totp" ? "an authenticator app" : "email codes"}.
        </p>
        {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{error}</p>}
        <button className="btn-outline-dark" disabled={busy} onClick={disable}>
          {busy ? "Turning off…" : "Turn off two-factor authentication"}
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3 style={{ marginBottom: 10, fontSize: 14.5 }}>Two-factor authentication</h3>
      <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
        Add a second step at sign-in, on top of your password. Recommended for every account, especially
        Platform Admin/Owner logins.
      </p>

      {step === "idle" && (
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button className="btn-small" disabled={busy} onClick={startEmailSetup}>📧 Use email codes</button>
          <button className="btn-small" disabled={busy} onClick={startTotpSetup}>📱 Use an authenticator app</button>
        </div>
      )}

      {step === "email-verify" && (
        <div>
          <p style={{ fontSize: 13.5, marginBottom: 8 }}>Enter the code we just emailed you to turn this on.</p>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input" style={{ maxWidth: 160 }} inputMode="numeric" maxLength={6}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000"
            />
            <button className="btn-primary" disabled={busy || code.length !== 6} onClick={() => confirmSetup("email")}>
              {busy ? "Confirming…" : "Confirm"}
            </button>
            <button className="link-btn" onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {step === "totp-verify" && (
        <div>
          <p style={{ fontSize: 13.5, marginBottom: 8 }}>
            Scan this with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code it shows.
          </p>
          {qrDataUrl && <img src={qrDataUrl} alt="Scan with your authenticator app" style={{ marginBottom: 8, border: "1px solid var(--line)", borderRadius: 8 }} />}
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 10, fontFamily: "monospace" }}>
            Can&apos;t scan? Enter this key manually: {totpSecret}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input" style={{ maxWidth: 160 }} inputMode="numeric" maxLength={6}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000"
            />
            <button className="btn-primary" disabled={busy || code.length !== 6} onClick={() => confirmSetup("totp")}>
              {busy ? "Confirming…" : "Confirm"}
            </button>
            <button className="link-btn" onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 10 }}>{error}</p>}
    </div>
  );
}

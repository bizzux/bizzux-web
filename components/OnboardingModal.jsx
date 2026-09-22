"use client";

import { useState } from "react";

// Zoho-style "Getting Started" wizard, shown once on an account owner's
// first visit to the dashboard (customers/{uid}.onboarded !== true).
const CURRENCIES = [
  { code: "INR", label: "India (₹ INR)" },
  { code: "USD", label: "United States ($ USD)" },
  { code: "GBP", label: "United Kingdom (£ GBP)" },
  { code: "AED", label: "UAE (د.إ AED)" },
];

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"];

// Sales-relevant context, not just "nice to have" — Super Admin's customer
// detail panel (components/SuperAdminPanel.jsx) surfaces these so a rep
// following up on a trial knows who they're calling and why, the same
// reasoning behind capturing companyName/employeeCount below.
const USE_CASES = [
  { value: "work", label: "Work" },
  { value: "team", label: "Team / organization" },
  { value: "personal", label: "Personal" },
];

// Controls which admin tabs/public page a customer gets in Bizzux Shop —
// "shop" (retail/food POS) is the original, default experience; the other
// three unlock the Enquiry -> Quotation -> Invoice billing module instead
// (see bizzux-shop's app/admin/page.js, gated on settings.businessType).
const BUSINESS_TYPES = [
  { value: "shop", label: "Shop (retail / food counter, POS)" },
  { value: "travel", label: "Travel agency" },
  { value: "medical", label: "Medical / clinic" },
  { value: "services", label: "General services (quotes & invoices)" },
];

export default function OnboardingModal({ user, organizationName, onDone }) {
  // The org name was already collected one screen ago, in
  // CreateOrganizationModal — pre-fill it here (still editable, in case
  // they want a different display name for the company vs. the org) so
  // this wizard doesn't make someone type the same name twice in a row.
  const [companyName, setCompanyName] = useState(organizationName || "");
  const [useCase, setUseCase] = useState("work");
  const [jobTitle, setJobTitle] = useState("");
  const [employeeCount, setEmployeeCount] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [currency, setCurrency] = useState("INR");
  const [businessType, setBusinessType] = useState("shop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save(body) {
    setBusy(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const r = await fetch("/api/onboarding", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save that");
      setSaved(true);
      // Save succeeded — refresh the dashboard's copy of the customer doc so
      // this modal unmounts. If that refresh itself fails (e.g. a Firestore
      // read error), don't leave the button stuck on "Setting up…" forever —
      // the "saved" message below tells the person what to do next.
      await onDone();
    } catch (e) {
      console.error("Onboarding save failed:", e);
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    if (!companyName.trim()) {
      setError("Company name is required");
      return;
    }
    save({ companyName, useCase, jobTitle, employeeCount, timezone, language: "English", currency, businessType });
  }

  const firstName = (user.displayName || user.email || "").split(/[@\s]/)[0];

  return (
    <div className="modal-overlay">
      <div className="modal onboarding-modal">
        <button className="modal-skip" type="button" onClick={() => save({ skip: true })} disabled={busy}>
          Skip
        </button>
        <div className="onboarding-hi">Hi {firstName} 👋</div>
        <h2 style={{ marginBottom: 4 }}>Set up your Bizzux account</h2>
        <p className="sub" style={{ marginBottom: 22 }}>Just a few details to get your workspace ready.</p>

        <form onSubmit={submit} noValidate>
          <div style={{ marginBottom: 14 }}>
            <label className="label">What will you use Bizzux for?</label>
            <div className="row" style={{ gap: 8 }}>
              {USE_CASES.map((u) => (
                <button
                  key={u.value}
                  type="button"
                  className={u.value === useCase ? "btn-primary-sm" : "btn-outline-dark"}
                  style={{ flex: 1, padding: "8px 6px", fontSize: 13 }}
                  onClick={() => setUseCase(u.value)}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label className="label">Company name</label>
            <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoFocus />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label className="label">Job title</label>
            <input
              className="input" value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Marketing director, Business owner"
            />
          </div>

          <div className="row" style={{ marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Employee count</label>
              <input
                className="input" value={employeeCount}
                onChange={(e) => setEmployeeCount(e.target.value)}
                placeholder="e.g. 1-10"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Currency</label>
              <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label className="label">Time zone</label>
            <select className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="label">What kind of business is this?</label>
            <select className="input" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
              {BUSINESS_TYPES.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </div>

          <button className="btn-primary" style={{ width: "100%" }} disabled={busy}>
            {busy ? "Setting up…" : "Get started"}
          </button>
          {error && <p className="error">{error}</p>}
          {saved && !error && (
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              Saved! If this doesn&apos;t close on its own,{" "}
              <button type="button" className="link-btn" onClick={() => window.location.reload()}>
                refresh the page
              </button>.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

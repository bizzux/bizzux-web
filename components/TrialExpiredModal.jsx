"use client";

import Link from "next/link";
import { IconClock } from "@/components/Icons";

// Shown when someone whose trial has ended (or whose subscription has
// lapsed) tries to open a live app from the dashboard. openApp() in
// dashboard/page.js checks canAccessApps() (lib/trial.js) before it ever
// calls /api/shop-sso, so this is the first thing they see instead of the
// app just failing to open — the account/dashboard itself stays reachable,
// only the live app tiles are gated.
export default function TrialExpiredModal({ status, onClose }) {
  const lapsed = status === "past_due" || status === "cancelled";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ textAlign: "center", maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            width: 56, height: 56, borderRadius: "50%", margin: "0 auto 16px",
            background: "#fef2f2", color: "var(--red)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <IconClock className="w-6 h-6" />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
          {lapsed ? "Your plan needs attention" : "Your trial period has ended"}
        </h2>
        <p className="muted" style={{ marginBottom: 24, lineHeight: 1.55 }}>
          {lapsed
            ? "Your subscription isn't active right now. Choose a plan to keep accessing your Bizzux apps."
            : "Choose a plan to pay and continue accessing this app."}
        </p>
        <Link href="/pricing" className="btn-primary" style={{ width: "100%", display: "flex", justifyContent: "center" }}>
          Choose a plan →
        </Link>
        <button className="link-btn" style={{ display: "block", margin: "14px auto 0" }} onClick={onClose}>
          Maybe later
        </button>
      </div>
    </div>
  );
}

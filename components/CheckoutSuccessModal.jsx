"use client";

import { useEffect } from "react";

// Shown right after a successful payment (dashboard/page.js triggers this
// off the ?checkout=success param that /api/checkout/route.js's Stripe
// success_url and PricingPlans.tsx's Razorpay handler both redirect to).
// Confetti is loaded dynamically so it never blocks the congratulations
// message itself from showing — if it fails to load for any reason (slow
// connection, ad blocker, whatever), the modal still renders fine without it.
export default function CheckoutSuccessModal({ planName, onClose }) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: confetti } = await import("canvas-confetti");
        if (cancelled) return;
        confetti({ particleCount: 130, spread: 100, origin: { y: 0.55 } });
        const end = Date.now() + 2200;
        (function frame() {
          if (cancelled) return;
          confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0, y: 0.7 } });
          confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1, y: 0.7 } });
          if (Date.now() < end) requestAnimationFrame(frame);
        })();
      } catch {
        // Confetti is a nice-to-have — nothing to fall back to, the
        // congratulations message below gets the point across on its own.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ textAlign: "center", maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 48, marginBottom: 8, lineHeight: 1 }}>🎉</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Payment successful!</h2>
        <p className="muted" style={{ marginBottom: 24, lineHeight: 1.55 }}>
          {planName ? (
            <>
              You&apos;re all set on the <strong>{planName}</strong> plan. Thanks for choosing Bizzux, we&apos;re
              excited to have you on board!
            </>
          ) : (
            <>Your subscription is now active. Thanks for choosing Bizzux, we&apos;re excited to have you on board!</>
          )}
        </p>
        <button className="btn-primary" style={{ width: "100%" }} onClick={onClose}>
          Let&apos;s go
        </button>
      </div>
    </div>
  );
}

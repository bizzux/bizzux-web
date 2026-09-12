"use client";

import { useState } from "react";
import { GoogleAuthProvider, signInWithPopup, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

// Google sign-in here is ONLY for verifying "a real person with a real
// Google account wrote this" — deliberately does NOT call /api/claim the
// way app/(saas)/sign-in does, so leaving a review never creates a
// customers/{uid} SaaS account or starts a trial for a casual site visitor.
export default function ReviewForm() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [signingIn, setSigningIn] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function signIn() {
    setError("");
    setSigningIn(true);
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      setUser(result.user);
    } catch {
      setError("That didn't go through. Mind giving it another try?");
    }
    setSigningIn(false);
  }

  async function submit() {
    if (!user || rating === 0 || text.trim().length < 10) return;
    setSubmitting(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const r = await fetch("/api/reviews", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: user.displayName || "Anonymous",
          photoUrl: user.photoURL || null,
          rating,
          text: text.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not submit your review");
      setDone(true);
    } catch (e: any) {
      setError(e?.message || "Could not submit your review");
    }
    setSubmitting(false);
  }

  if (done) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 text-green-800 text-sm p-5 text-center">
        Thanks! Your review is in — it'll appear here once our team reviews it.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 max-w-lg mx-auto">
      <p className="font-semibold mb-1">Leave a review</p>
      <p className="text-sm text-slate-500 mb-4">
        Sign in with Google so it's really you — reviews are checked before they go live.
      </p>

      {!user ? (
        <button
          type="button"
          onClick={signIn}
          disabled={signingIn}
          className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-full border border-slate-300 text-sm font-semibold hover:border-brand-blue disabled:opacity-60"
        >
          {signingIn ? "Signing in…" : "Continue with Google"}
        </button>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4">
            {user.photoURL && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full" />
            )}
            <span className="text-sm text-slate-700">{user.displayName}</span>
          </div>

          <div className="flex gap-1 mb-3 text-2xl" onMouseLeave={() => setHoverRating(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHoverRating(n)}
                onClick={() => setRating(n)}
                className="leading-none"
                aria-label={n + " star"}
              >
                <span className={(hoverRating || rating) >= n ? "text-amber-400" : "text-slate-200"}>★</span>
              </button>
            ))}
          </div>

          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3"
            rows={3}
            placeholder="What's it been like using Bizzux?"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || rating === 0 || text.trim().length < 10}
            className="w-full inline-flex items-center justify-center h-10 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold disabled:opacity-50"
            style={{ color: "#fff" }}
          >
            {submitting ? "Submitting…" : "Submit review"}
          </button>
        </>
      )}
    </div>
  );
}

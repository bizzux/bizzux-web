"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

// Nav plus every account page (Dashboard, Profile, Team, Super Admin) used
// to each independently subscribe to onAuthStateChanged and fetch /api/me
// on their own — so a single page render fired that same request two or
// three times in parallel, and every fresh client-side navigation started
// over from a blank "checking…" state even though the exact same answer
// had just been fetched moments earlier (Nav in particular isn't in a
// shared layout, so it fully remounts on every route change — see
// Nav.tsx). This hook centralizes both: a module-level cache lets a new
// mount render the last known answer immediately instead of waiting on a
// fresh round trip, and an in-flight promise is shared so concurrent
// callers (e.g. Nav and the page it's rendered on) collapse into one
// network request instead of several.
let cachedUser; // undefined = never resolved this tab yet
let cachedMe = null; // last successful /api/me payload (or {} on error)
let inFlight = null;

export function useMe() {
  const [user, setUser] = useState(() =>
    cachedUser !== undefined ? cachedUser : (auth.currentUser ?? undefined)
  );
  const [me, setMe] = useState(cachedMe);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      cachedUser = u;
      setUser(u);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) {
      cachedMe = null;
      setMe(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        if (!inFlight) {
          inFlight = fetch("/api/me", { headers: { Authorization: "Bearer " + token } })
            .then((r) => r.json())
            .finally(() => {
              inFlight = null;
            });
        }
        const d = await inFlight;
        if (!cancelled) {
          cachedMe = d;
          setMe(d);
        }
      } catch {
        if (!cancelled) {
          cachedMe = {};
          setMe({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { user, me };
}

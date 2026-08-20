"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Nav from "@/components/Nav";
import TrialExpiredModal from "@/components/TrialExpiredModal";
import { canAccessApps } from "@/lib/trial";
import { useMe } from "@/lib/useMe";

// featured: true -> also shown, once, in the untitled top row.
// `url`/`sso` mirror dashboard/page.js's APPS entries for the same app keys
// — needed here so an already-signed-in visitor's "Try now" click can open
// the app directly (see openApp() below) instead of only ever linking to
// sign-up.
const CATEGORIES = [
  {
    id: "retail-food",
    title: "Retail & Food",
    sub: "Run the day-to-day of your shop, counter, or kitchen.",
    apps: [
      { key: "juicechatjunction", name: "Bizzux Shop", icon: "🏪", desc: "POS, menu, inventory, and shop management for food & retail counters.", live: true, featured: true, url: "https://shop.bizzux.com", sso: true },
      { key: "orders", name: "Bizzux Orders", icon: "📋", desc: "Take and track orders from counter, phone, or online.", live: false, featured: false },
    ],
  },
  {
    id: "point-of-sale",
    title: "Point of Sale",
    sub: "Fast checkout tools for counters and storefronts.",
    apps: [
      { key: "pos", name: "Bizzux POS", icon: "🧾", desc: "A fast, simple point-of-sale for any counter or checkout.", live: false, featured: true },
    ],
  },
  {
    id: "finance",
    title: "Finance",
    sub: "Keep the books straight without the busywork.",
    apps: [
      { key: "books", name: "Bizzux Books", icon: "📒", desc: "Accounting and invoicing for small, growing businesses.", live: false, featured: true },
      { key: "payroll", name: "Bizzux Payroll", icon: "💰", desc: "Simple payroll for small teams, done in minutes.", live: false, featured: false },
    ],
  },
  {
    id: "operations",
    title: "Operations",
    sub: "Track what's coming in and going out.",
    apps: [
      { key: "inventory", name: "Bizzux Inventory", icon: "📦", desc: "Stock, materials, and supply tracking in real time.", live: false, featured: false },
      { key: "vendors", name: "Bizzux Vendors", icon: "🚚", desc: "Manage vendors, purchase orders, and payments.", live: false, featured: false },
    ],
  },
  {
    id: "customers",
    title: "Customers",
    sub: "Keep every relationship organized in one place.",
    apps: [
      { key: "crm", name: "Bizzux CRM", icon: "👥", desc: "Track leads, customers, and follow-ups without spreadsheets.", live: false, featured: true },
      { key: "support", name: "Bizzux Support", icon: "🎧", desc: "A simple helpdesk to manage customer questions.", live: false, featured: false },
    ],
  },
  {
    id: "online",
    title: "Online Presence",
    sub: "Get your business online without hiring a developer.",
    apps: [
      { key: "sites", name: "Bizzux Sites", icon: "🌐", desc: "A simple website builder made for small businesses.", live: false, featured: false },
    ],
  },
];

// authState: "checking" (auth not resolved yet) | "out" | "in"
function AppCard({ a, authState, opening, onTryNow }) {
  const signedIn = authState === "in";
  return (
    <div className="app-card2">
      <div className={"apps-panel-icon" + (a.live ? "" : " locked")} style={{ marginBottom: 2 }}>{a.icon}</div>
      <h4>
        {a.name}
        {!a.live && <span className="apps-panel-soon">Soon</span>}
      </h4>
      <p>{a.desc}</p>
      {a.live ? (
        signedIn ? (
          <button type="button" className="btn-primary" onClick={() => onTryNow(a)} disabled={opening}>
            {opening ? "Opening…" : "Try now"}
          </button>
        ) : (
          <Link href={`/sign-in?mode=signup&app=${encodeURIComponent(a.name)}`} className="btn-primary">Try now</Link>
        )
      ) : (
        <span className="btn-outline-dark" style={{ opacity: 0.6, cursor: "default" }}>Coming soon</span>
      )}
    </div>
  );
}

export default function AllAppsPage() {
  const [q, setQ] = useState("");

  // Mirrors dashboard/page.js's sign-in-aware "Try now" flow: a visitor
  // who's already signed in shouldn't be sent through sign-up again just to
  // reach an app they can already open — this resolves their auth + trial /
  // plan status here and, on click, opens the app directly (with the same
  // SSO hand-off and trial-expired gate dashboard uses). useMe() (lib/useMe.js)
  // shares its /api/me lookup with Nav instead of firing a duplicate one.
  const { user, me } = useMe();
  const accountId = me?.accountId || user?.uid || null;
  const [customer, setCustomer] = useState(null);
  const [openingKey, setOpeningKey] = useState(null);
  const [showLockedModal, setShowLockedModal] = useState(false);

  useEffect(() => {
    if (!user || !accountId) {
      setCustomer(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "customers", accountId));
        if (!cancelled) setCustomer(snap.exists() ? snap.data() : {});
      } catch {
        if (!cancelled) setCustomer({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, accountId]);

  const authState = user === undefined ? "checking" : user === null ? "out" : "in";
  // Until the customer doc has loaded, treat access as gated so a click
  // can't slip through before we know the real trial/plan status.
  const appsLocked = authState === "in" ? customer === null || !canAccessApps(customer) : false;

  async function openApp(a) {
    if (!user) return;
    if (customer === null || appsLocked) {
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

  const term = q.trim().toLowerCase();
  const matches = (a) =>
    !term || a.name.toLowerCase().includes(term) || a.desc.toLowerCase().includes(term);

  const featured = useMemo(
    () => CATEGORIES.flatMap((c) => c.apps.filter((a) => a.featured)).filter(matches),
    [term]
  );

  const categorized = useMemo(
    () =>
      CATEGORIES.map((c) => ({ ...c, apps: c.apps.filter(matches) })).filter((c) => c.apps.length > 0),
    [term]
  );

  const nothingFound = featured.length === 0 && categorized.length === 0;

  return (
    <>
      <Nav />

      <header className="apps-hero">
        <h1>Every tool your business needs</h1>
        <p>One account. Try any app free, keep the ones that fit.</p>
        <div className="apps-search-box">
          <span>🔍</span>
          <input placeholder="Search apps…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </header>

      <div className="apps-layout">
        <aside className="apps-sidebar">
          {featured.length > 0 && <a href="#featured">Featured Apps</a>}
          {categorized.map((c) => (
            <a href={"#" + c.id} key={c.id}>{c.title}</a>
          ))}
        </aside>

        <div className="apps-main">
          {nothingFound && <p className="muted">No apps match "{q}".</p>}

          {featured.length > 0 && (
            <div className="apps-category" id="featured">
              <div className="apps-cards-grid featured-grid">
                {featured.map((a) => (
                  <AppCard a={a} key={a.key} authState={authState} opening={openingKey === a.key} onTryNow={openApp} />
                ))}
              </div>
            </div>
          )}

          {categorized.map((c) => (
            <div className="apps-category" id={c.id} key={c.id}>
              <h2 className="apps-category-title">{c.title}</h2>
              <p className="apps-category-sub">{c.sub}</p>
              <div className="apps-cards-grid">
                {c.apps.map((a) => (
                  <AppCard a={a} key={a.key} authState={authState} opening={openingKey === a.key} onTryNow={openApp} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showLockedModal && (
        <TrialExpiredModal status={customer?.status || "trial"} onClose={() => setShowLockedModal(false)} />
      )}
    </>
  );
}

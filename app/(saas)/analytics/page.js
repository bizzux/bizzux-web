"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Analytics moved from its own standalone page into a sub-tab of /admin
// (see AdminTabs.tsx + components/AnalyticsPanel.jsx) so it lives alongside
// Super Admin (SaaS) and Career applications under one Super Admin section.
// This route is kept as a redirect so any existing bookmarks/links to
// /analytics still land somewhere useful instead of 404ing.
export default function AnalyticsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin");
  }, [router]);

  return <div className="login-wrap"><p style={{ color: "#fff" }}>Redirecting…</p></div>;
}

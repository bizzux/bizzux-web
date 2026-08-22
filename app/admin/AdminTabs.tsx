"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import SuperAdminPanel from "@/components/SuperAdminPanel";
import Nav from "@/components/Nav";
import AccountTabs from "@/components/AccountTabs";
import { IconDownload } from "@/components/Icons";
import { useMe } from "@/lib/useMe";

// Super Admin (SaaS) is the default/first tab, so SuperAdminPanel is
// imported normally — it's needed on the very first render either way.
// Analytics is the third tab and often never opened in a given visit, so
// it's loaded on demand instead of padding out every /admin page load with
// its charting code.
const AnalyticsPanel = dynamic(() => import("@/components/AnalyticsPanel"), {
  loading: () => <div className="py-12 text-center text-slate-400">Loading…</div>,
});

type Application = {
  id: string;
  createdAt?: string;
  fullName?: string;
  course?: string;
  email?: string;
  mobile?: string;
  college?: string;
  area?: string;
  linkedin?: string;
  portfolio?: string;
  resumeBlobPath?: string | null;
  resumeFileName?: string | null;
};

// Combines bizzux.com's existing Career Applications tool, apps.bizzux.com's
// Super Admin panel, and the former standalone /analytics page under one
// /admin route, as three sub-tabs — Super Admin (SaaS) is first/default,
// since that's the primary reason a Super Admin lands here, then Career
// applications, then Analytics. This page is gated the same way every other
// admin surface is: signed-in Firebase user + Super Admin (SUPER_ADMIN_EMAIL),
// same isSuper flag AccountTabs uses to decide whether to show the "Super
// Admin" tab at all.
export default function AdminTabs() {
  const router = useRouter();
  // useMe() (lib/useMe.js) shares this /api/me lookup with Nav instead of
  // each firing its own duplicate request, and starts a remount from the
  // last known answer instead of a blank "checking…" state.
  const { user, me } = useMe();
  const isSuper = me ? me.superAdmin === true : null; // null = checking role
  const isAccountAdmin = me?.isAccountAdmin === true;
  const [tab, setTab] = useState<"saas" | "career" | "analytics">("saas");
  const [apps, setApps] = useState<Application[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (user === null) router.push("/sign-in");
  }, [user, router]);

  useEffect(() => {
    if (!user || isSuper !== true) return;
    (async () => {
      try {
        const t = await user.getIdToken();
        const r = await fetch("/api/admin/career-applications", { headers: { Authorization: "Bearer " + t } });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load applications.");
        setApps(d.apps || []);
      } catch (e: any) {
        setLoadError(e?.message || "Could not load applications.");
      }
    })();
  }, [user, isSuper]);

  // Resumes live in a private Blob store (see /api/careers), so there's no
  // public URL a plain <a href> can point to — a Bearer token is required,
  // which only a JS fetch can attach. This fetches the file through the
  // Super-Admin-gated /api/admin/resume-file route, then hands the browser
  // a temporary object URL to actually trigger the download/save-as dialog.
  async function downloadResume(a: Application) {
    if (!user) return;
    setDownloadingId(a.id);
    setDownloadError(null);
    try {
      const t = await user.getIdToken();
      const r = await fetch("/api/admin/resume-file?id=" + a.id, { headers: { Authorization: "Bearer " + t } });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "Could not download the resume.");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.resumeFileName || "resume";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setDownloadError(e?.message || "Could not download the resume.");
    }
    setDownloadingId(null);
  }

  if (user === undefined || isSuper === null) {
    return (
      <div>
        <Nav />
        <div className="py-12 text-center text-slate-400">Loading…</div>
      </div>
    );
  }

  if (!isSuper) {
    return (
      <div>
        <Nav />
        <AccountTabs active="admin" isAccountAdmin={isAccountAdmin} isSuper={false} />
        <div className="py-12 text-center text-slate-500">You don&apos;t have access to this page.</div>
      </div>
    );
  }

  return (
    <>
      <Nav />
      <AccountTabs active="admin" isAccountAdmin={isAccountAdmin} isSuper={true} />
      <section className="pt-4 pb-6 bg-slate-50 min-h-[45vh]">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">Super Admin</h1>
            <p className="text-sm text-slate-500">
              {tab === "saas" ? "Bizzux SaaS platform" : tab === "career" ? `${apps.length} career application${apps.length === 1 ? "" : "s"}` : "Subscriptions and revenue across every organization"}
            </p>
          </div>

          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
          <button
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${tab === "saas" ? "bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white shadow-sm" : "text-slate-800"}`}
            onClick={() => setTab("saas")}
          >
            Super Admin (SaaS)
          </button>
          <button
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${tab === "career" ? "bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white shadow-sm" : "text-slate-800"}`}
            onClick={() => setTab("career")}
          >
            Career applications
          </button>
          <button
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${tab === "analytics" ? "bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white shadow-sm" : "text-slate-800"}`}
            onClick={() => setTab("analytics")}
          >
            Analytics
          </button>
          </div>
        </div>

        {tab === "career" && (
          <>
            {loadError && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-4">
                {loadError}
              </div>
            )}
            {downloadError && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-4">
                {downloadError}
              </div>
            )}

            <div className="overflow-x-auto bg-white rounded-xl border border-slate-100 shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Applied</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3">College</th>
                    <th className="px-4 py-3">Area of interest</th>
                    <th className="px-4 py-3">Links</th>
                    <th className="px-4 py-3">Resume</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((a) => (
                    <tr key={a.id} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                        {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "N/A"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{a.fullName}</div>
                        <div className="text-slate-500">{a.course || "N/A"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{a.email}</div>
                        <div className="text-slate-500">{a.mobile}</div>
                      </td>
                      <td className="px-4 py-3">{a.college || "N/A"}</td>
                      <td className="px-4 py-3">{a.area || "N/A"}</td>
                      <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                        {a.linkedin && (
                          <a href={a.linkedin} target="_blank" rel="noopener noreferrer" className="text-brand-blue hover:underline">
                            LinkedIn
                          </a>
                        )}
                        {a.portfolio && (
                          <a href={a.portfolio} target="_blank" rel="noopener noreferrer" className="text-brand-blue hover:underline">
                            Portfolio
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {a.resumeBlobPath ? (
                          <button
                            type="button"
                            onClick={() => downloadResume(a)}
                            disabled={downloadingId === a.id}
                            title={a.resumeFileName || "Download resume"}
                            className="inline-flex items-center gap-1.5 max-w-[190px] text-brand-teal font-medium hover:underline disabled:opacity-60"
                          >
                            <IconDownload className="w-4 h-4 shrink-0" />
                            <span className="truncate">
                              {downloadingId === a.id ? "Downloading…" : (a.resumeFileName || "Download")}
                            </span>
                          </button>
                        ) : a.resumeFileName ? (
                          <span className="text-amber-600" title={`"${a.resumeFileName}" was selected but the upload failed. Ask the applicant to resend it, or check Blob storage config.`}>
                            Upload failed
                          </span>
                        ) : (
                          <span className="text-slate-400">No file</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {apps.length === 0 && !loadError && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                        No applications yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "saas" && (
          <div className="bzx-app" style={{ minHeight: 0, background: "transparent" }}>
            <SuperAdminPanel />
          </div>
        )}

        {tab === "analytics" && <AnalyticsPanel user={user} />}
      </div>
      </section>
    </>
  );
}

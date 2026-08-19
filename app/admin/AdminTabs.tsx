"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import SuperAdminPanel from "@/components/SuperAdminPanel";
import Nav from "@/components/Nav";
import AccountTabs from "@/components/AccountTabs";

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
  resumeSignedUrl?: string | null;
};

// Combines bizzux.com's existing Career Applications tool with
// apps.bizzux.com's Super Admin panel under one /admin route (they used to
// collide on the same path in the two separate codebases). /admin used to
// have its own separate cookie/ADMIN_PASSWORD password gate on top of this
// (middleware.ts) — that's been removed, so this page is now gated the
// same way every other admin surface is: signed-in Firebase user +
// Super Admin (SUPER_ADMIN_EMAIL), same isSuper flag AccountTabs uses to
// decide whether to show the "Admin" tab at all.
export default function AdminTabs() {
  const router = useRouter();
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = checking auth
  const [isSuper, setIsSuper] = useState<boolean | null>(null); // null = checking role
  const [tab, setTab] = useState<"career" | "saas">("career");
  const [apps, setApps] = useState<Application[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.push("/sign-in");
        return;
      }
      setUser(u);
    });
    return unsub;
  }, [router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const t = await user.getIdToken();
        const r = await fetch("/api/me", { headers: { Authorization: "Bearer " + t } });
        const d = await r.json();
        setIsSuper(d.superAdmin === true);
      } catch {
        setIsSuper(false);
      }
    })();
  }, [user]);

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
        <AccountTabs active="admin" isSuper={false} />
        <div className="py-12 text-center text-slate-500">You don&apos;t have access to this page.</div>
      </div>
    );
  }

  return (
    <>
      <Nav />
      <AccountTabs active="admin" isSuper={true} />
      <section className="py-12 bg-slate-50 min-h-[70vh]">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Admin</h1>
            <p className="text-sm text-slate-500">
              {tab === "career" ? `${apps.length} career application${apps.length === 1 ? "" : "s"}` : "Bizzux SaaS platform"}
            </p>
          </div>
        </div>

        <div className="flex gap-1 mb-8 bg-slate-100 p-1 rounded-lg w-fit">
          <button
            className={`px-4 py-2 rounded-md text-sm font-semibold ${tab === "career" ? "bg-white text-brand-blue shadow-sm" : "text-slate-500"}`}
            onClick={() => setTab("career")}
          >
            Career applications
          </button>
          <button
            className={`px-4 py-2 rounded-md text-sm font-semibold ${tab === "saas" ? "bg-white text-brand-blue shadow-sm" : "text-slate-500"}`}
            onClick={() => setTab("saas")}
          >
            Super Admin (SaaS)
          </button>
        </div>

        {tab === "career" && (
          <>
            {loadError && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-4">
                {loadError}
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
                        {a.resumeSignedUrl ? (
                          <a href={a.resumeSignedUrl} target="_blank" rel="noopener noreferrer" className="text-brand-teal font-medium hover:underline">
                            Download
                          </a>
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
      </div>
      </section>
    </>
  );
}

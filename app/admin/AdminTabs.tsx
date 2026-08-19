"use client";

import { useState } from "react";
import LogoutButton from "./LogoutButton";
import SuperAdminPanel from "@/components/SuperAdminPanel";

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
// collide on the same path in the two separate codebases). Each tab keeps
// its own, separate auth: Career Applications is gated by the page-level
// cookie session (middleware.ts, unchanged); Super Admin is gated inside
// SuperAdminPanel by Firebase Auth + SUPER_ADMIN_EMAIL.
export default function AdminTabs({
  apps,
  loadError,
}: {
  apps: Application[];
  loadError: string | null;
}) {
  const [tab, setTab] = useState<"career" | "saas">("career");

  return (
    <section className="py-12 bg-slate-50 min-h-[70vh]">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Admin</h1>
            <p className="text-sm text-slate-500">
              {tab === "career" ? `${apps.length} career application${apps.length === 1 ? "" : "s"}` : "Bizzux SaaS platform"}
            </p>
          </div>
          <LogoutButton />
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
  );
}

import { getDb, getBucket } from "@/lib/firebaseAdmin";
import LogoutButton from "./LogoutButton";

export const dynamic = "force-dynamic";

async function getApplications() {
  const db = getDb();
  const snap = await db.collection("careerApplications").orderBy("createdAt", "desc").get();
  const bucket = getBucket();

  return Promise.all(
    snap.docs.map(async (doc) => {
      const data = doc.data() as any;
      let resumeSignedUrl: string | null = null;
      if (data.resumeUrl) {
        try {
          const [url] = await bucket.file(data.resumeUrl).getSignedUrl({
            action: "read",
            expires: Date.now() + 15 * 60 * 1000,
          });
          resumeSignedUrl = url;
        } catch {
          resumeSignedUrl = null;
        }
      }
      return { id: doc.id, ...data, resumeSignedUrl };
    })
  );
}

export default async function AdminPage() {
  let apps: any[] = [];
  let loadError: string | null = null;
  try {
    apps = await getApplications();
  } catch (e: any) {
    loadError = e?.message || "Could not load applications.";
  }

  return (
    <section className="py-12 bg-slate-50 min-h-[70vh]">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Career applications</h1>
            <p className="text-sm text-slate-500">{apps.length} total</p>
          </div>
          <LogoutButton />
        </div>

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
                    {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{a.fullName}</div>
                    <div className="text-slate-500">{a.course || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{a.email}</div>
                    <div className="text-slate-500">{a.mobile}</div>
                  </td>
                  <td className="px-4 py-3">{a.college || "—"}</td>
                  <td className="px-4 py-3">{a.area || "—"}</td>
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
      </div>
    </section>
  );
}

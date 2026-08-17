import { getDb, getBucket } from "@/lib/firebaseAdmin";
import AdminTabs from "./AdminTabs";

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

// Career-applications data fetch is unchanged from before the merge — only
// the rendering moved into AdminTabs, which now also hosts the Super Admin
// (SaaS) tab alongside it. See app/admin/AdminTabs.tsx.
export default async function AdminPage() {
  let apps: any[] = [];
  let loadError: string | null = null;
  try {
    apps = await getApplications();
  } catch (e: any) {
    loadError = e?.message || "Could not load applications.";
  }

  return <AdminTabs apps={apps} loadError={loadError} />;
}

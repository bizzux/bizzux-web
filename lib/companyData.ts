import { adminDb } from "@/lib/firebaseAdmin";

// Team and reviews are managed from /admin (Team / Reviews tabs) and shown
// on several Company pages (About, Leadership, Reviews, Customers). Every
// page that renders them must also be listed in COMPANY_DATA_PATHS so the
// admin APIs refresh it after a write — otherwise it stays frozen at build.
export const COMPANY_DATA_PATHS = ["/about", "/leadership", "/reviews", "/customers"];

export type TeamMember = {
  id: string;
  name: string;
  role?: string;
  bio?: string;
  photoUrl?: string | null;
  isCEO?: boolean;
};

export type Review = {
  id: string;
  name: string;
  photoUrl?: string | null;
  rating: number;
  text: string;
};

export async function getTeam(): Promise<TeamMember[]> {
  try {
    const snap = await adminDb().collection("team").orderBy("order", "asc").get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamMember);
  } catch {
    return [];
  }
}

// Filtering in JS instead of where("status","==","approved").orderBy
// ("createdAt") avoids needing a composite Firestore index just for this one
// query — fine at a marketing site's review volume.
export async function getApprovedReviews(limit = 12): Promise<Review[]> {
  try {
    const snap = await adminDb().collection("reviews").orderBy("createdAt", "desc").limit(100).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as Review & { status?: string })
      .filter((r) => r.status === "approved")
      .slice(0, limit);
  } catch {
    return [];
  }
}

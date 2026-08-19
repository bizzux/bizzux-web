import AdminTabs from "./AdminTabs";

// Career-applications data used to be fetched here, server-side, and passed
// down as a prop — but that ran before any auth check (this route was only
// gated by the old cookie/ADMIN_PASSWORD middleware, which has been
// removed). AdminTabs now fetches its own data client-side from
// /api/admin/career-applications, after confirming the signed-in Firebase
// user is a Super Admin — the same requireSuperAdmin() check the rest of
// the admin APIs use. See that route + AdminTabs.tsx.
export default function AdminPage() {
  return <AdminTabs />;
}

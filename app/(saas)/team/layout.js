import AdminShell from "@/components/admin/AdminShell";

// Every Admin Center page (/team and, through the host routing, /users /apps /teams /roles /organizations /security) shares this frame.
export default function TeamLayout({ children }) {
  return <AdminShell>{children}</AdminShell>;
}

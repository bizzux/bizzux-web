"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/lib/useMe";

// Platform Owners/Admins are internal staff running the company, not
// prospects shopping for a plan — the marketing homepage (pricing CTAs,
// "start free trial", featured apps) has nothing for them. Renders nothing;
// its only job is to bounce a signed-in Platform Admin straight to the
// console they actually need. Auth is client-only in this app (no session
// cookie/middleware), so this has to run client-side rather than as a
// server redirect.
export default function SuperAdminHomeRedirect() {
  const { me } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (me?.superAdmin === true) {
      router.replace("/admin");
    }
  }, [me, router]);

  return null;
}

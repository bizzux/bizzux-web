"use client";
// Shared access gate for Admin Center list screens: redirects signed-out people to sign-in and shows a clear message to non-administrators.
// The server enforces the same rule on every API call; this only decides what to render.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/lib/useMe";

export function useAdminGate() {
  const router = useRouter();
  const { user, me } = useMe();
  useEffect(() => { if (user === null) router.push("/sign-in"); }, [user, router]);
  const state = !user || !me ? "loading" : me.isAccountAdmin ? "ok" : "denied";
  return { user, me, state, canAssignAdmin: me?.superAdmin === true || (me?.orgPermissions || []).includes("roles.assign_admin") };
}

export function GateMessage({ state }) {
  if (state === "loading") return <p className="muted">Loading…</p>;
  if (state === "denied") return <p>You don&apos;t have access to this page. It is for company owners and admins.</p>;
  return null;
}

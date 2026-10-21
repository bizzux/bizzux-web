"use client";
// Client-side helpers so the shared /team pages work on both hosts: on admin.* they link to admin paths and back to www with absolute URLs;
// on www they keep today's relative links. The server never trusts any of this; it only decides which URL a link points at.
import { useSyncExternalStore } from "react";

const WWW = process.env.NEXT_PUBLIC_WWW_ORIGIN || "https://www.bizzux.com";
const subscribe = () => () => {};
const clientIsAdmin = () => /^admin\./.test(window.location.hostname);

// false on the server and during hydration, then the real answer: no hydration mismatch.
export function useIsAdminHost() {
  return useSyncExternalStore(subscribe, clientIsAdmin, () => false);
}

export function wwwHrefFor(isAdminHost, path) {
  return isAdminHost ? WWW + path : path;
}

export const ADMIN_NAV = [
  { key: "team", label: "Users", admin: "/users", legacy: "/team" },
  { key: "team-groups", label: "Teams", admin: "/teams", legacy: "/team/groups" },
  { key: "team-apps", label: "Apps", admin: "/apps", legacy: "/team/apps" },
  { key: "team-roles", label: "Roles", admin: "/roles", legacy: "/team/roles" },
  { key: "team-orgs", label: "Organizations", admin: "/organizations", legacy: "/team/organizations" },
  { key: "team-security", label: "Security", admin: "/security", legacy: "/team/security" },
];

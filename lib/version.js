// Bizzux versioning standard: Version (MAJOR.MINOR.PATCH, bumped by hand
// in package.json when a release actually ships) + Build (a sequential
// integer, auto-incremented per production deploy — see
// scripts/bump-build.mjs) + Release date (stored separately, never folded
// into the version string). Client- and server-safe.
import pkg from "../package.json";

export const APP_VERSION = pkg.version;
export const BUILD_NUMBER = process.env.NEXT_PUBLIC_BUILD_NUMBER || "dev";
export const RELEASE_DATE = process.env.NEXT_PUBLIC_RELEASE_DATE || null;

// Internal/admin display: "v0.1.0 | Build 23 | 19-Sep-2026"
export function internalVersionLabel() {
  const parts = [`v${APP_VERSION}`, `Build ${BUILD_NUMBER}`];
  if (RELEASE_DATE) parts.push(RELEASE_DATE);
  return parts.join(" | ");
}

// Customer-facing display: "Version 0.1.0" — never shows build number or
// release date to a customer.
export function customerVersionLabel() {
  return `Version ${APP_VERSION}`;
}

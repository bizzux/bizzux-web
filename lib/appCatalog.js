// The canonical list of Bizzux apps for the OrganizationAppSubscription /
// AppAssignment model (lib/appAccess.js). Client- and server-safe on
// purpose (no Firebase-admin import) so both the Team > Apps UI and the
// server routes share one definition. Deliberately a NEW, independent id
// scheme from the older per-app keys scattered elsewhere (Shop's
// "juicechatjunction", appUsage's "notes"/"files"/"projects") — those
// predate this model and aren't touched by Phase 2; reconciling them is a
// later phase's problem once this model is actually wired into access
// control.
export const APPS = [
  { id: "bizzux-projects", name: "Bizzux Projects" },
  { id: "bizzux-business", name: "Bizzux Business" },
  { id: "bizzux-pos", name: "Bizzux POS" },
  { id: "bizzux-notes", name: "Bizzux Notes" },
  { id: "bizzux-files", name: "Bizzux Files" },
];

export const APP_IDS = APPS.map((a) => a.id);

export function appName(appId) {
  return APPS.find((a) => a.id === appId)?.name || appId;
}

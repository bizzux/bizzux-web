import { PROFILES } from "./roles";

// Shared "what's this person's role" label — client-safe, no imports.
// Matches the wording already used on /profile (previously computed inline
// as `me.isOwner ? "Owner" : me.profile`), extended to prefer the new
// organizationRole distinction (Organization Owner / Organization Admin)
// so plain business-role team members (Manager/Staff/Viewer, etc.) read as
// their actual role rather than being lumped in with "admin" language.
export function roleLabel(me) {
  if (!me) return "";
  if (me.organizationRole === "ORGANIZATION_OWNER") return "Organization Owner";
  if (me.organizationRole === "ORGANIZATION_ADMIN") return "Organization Admin";
  // me.profile is the stored value (e.g. "Staff/Shopkeeper") — show its
  // current display label, not the raw stored string, so renaming a
  // label doesn't require touching every already-stored team record.
  if (me.profile) return PROFILES.find((p) => p.value === me.profile)?.label || me.profile;
  return me.isOwner ? "Owner" : "Team member";
}

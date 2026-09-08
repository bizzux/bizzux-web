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
  if (me.profile) return me.profile;
  return me.isOwner ? "Owner" : "Team member";
}

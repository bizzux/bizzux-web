// What the Admin Center treats as an Admin-level change, and the confirmation it asks for, shared by the user details drawer and the Users table
// so both word it the same way.
import { ADMIN_PROFILES, isAdminLevelChange } from "@/lib/adminStaging";

export { ADMIN_PROFILES };
export const ROLE_LABEL = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member", VIEWER: "Viewer" };

// Options for useConfirm's ask() when the change makes someone an Admin (or takes Admin away), naming the person and the old and new values; null when
// the change is not Admin-level and needs no confirmation. Leave the profile arguments out when only the organization role changes.
export function adminChangeDialog({ person, curRole, nextRole, curProfile = "", nextProfile = curProfile, profileLabel = (v) => v || "Not set" }) {
  const roleChanged = nextRole !== curRole;
  const profChanged = nextProfile !== curProfile;
  const { toAdmin, any } = isAdminLevelChange({ curRole, nextRole, curProfile, nextProfile });
  if (!any) return null;
  return {
    title: "Confirm Admin-level change", tone: "warning", confirmLabel: "Confirm change",
    body: (
      <>
        <p>You are about to change access for <b>{person}</b>:</p>
        <ul>
          {roleChanged && <li>Organization role: <b>{ROLE_LABEL[curRole] || curRole}</b> → <b>{ROLE_LABEL[nextRole] || nextRole}</b></li>}
          {profChanged && <li>Business profile: <b>{profileLabel(curProfile)}</b> → <b>{profileLabel(nextProfile)}</b></li>}
        </ul>
        <p>{toAdmin ? "Admins can manage users and app access in this company." : "This takes away their ability to manage users and app access."}</p>
      </>
    ),
  };
}

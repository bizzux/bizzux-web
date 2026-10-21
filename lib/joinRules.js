// Pure rules for organization join requests and who may decide them. No I/O.
export const MEMBERS_APPROVE = "members.approve";
export const ORG_PERMISSIONS = [MEMBERS_APPROVE];
export const REQUEST_TTL_DAYS = 14;
export const MAX_REQUESTS_PER_DAY = 5;
export const MESSAGE_MAX = 300;

// approver = { isOwner, role: OWNER|ADMIN|MEMBER|VIEWER, status, permissions: string[] }
// The company Owner can always decide. An Organization Admin only with an explicit grant of members.approve (given by the Owner).
// Managers, members and viewers never can unless a future explicit delegation adds a permission.
export function approverCan(a) {
  if (!a || (a.status && a.status !== "active")) return false;
  if (a.isOwner || a.role === "OWNER") return true;
  return a.role === "ADMIN" && Array.isArray(a.permissions) && a.permissions.includes(MEMBERS_APPROVE);
}

// A join can never create an Owner or Global Admin. An Admin approver cannot create another Admin (no escalation above their own level).
export function assignableProfiles(a) {
  if (!approverCan(a)) return [];
  return a.isOwner || a.role === "OWNER" ? ["Admin", "Manager", "Staff/Shopkeeper", "Viewer/Auditor"] : ["Manager", "Staff/Shopkeeper", "Viewer/Auditor"];
}

export const joinRequestId = (organizationId, uid) => organizationId + "_" + uid;
export const cleanCode = (c) => { const v = String(c || "").trim().toUpperCase(); return /^BZ[A-Z0-9]{6}$/.test(v) ? v : ""; };
export const cleanMessage = (m) => String(m || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, MESSAGE_MAX);

export function decisionProblem({ approver, approverUid, request, decision, profile, nowMs }) {
  if (!request) return "Request not found";
  if (!["approve", "reject"].includes(decision)) return "Unknown decision";
  if (!approverCan(approver)) return "You are not allowed to decide join requests for this company.";
  if (request.requesterUid === approverUid) return "You cannot decide your own request.";
  if (request.status !== "pending") return "This request has already been decided.";
  if (request.expiresAtMs && nowMs > request.expiresAtMs) return "This request has expired. Ask them to request again.";
  if (decision === "approve" && !assignableProfiles(approver).includes(profile)) return "You cannot assign that role.";
  return null;
}

// Who sees the request: owner + admins holding the grant. memberships = [{userId, role, status, permissions}]
export function eligibleApprovers(organizationId, memberships) {
  const ids = new Set([organizationId]);
  for (const m of memberships) if (approverCan({ ...m, isOwner: false })) ids.add(m.userId);
  return [...ids].slice(0, 20);
}

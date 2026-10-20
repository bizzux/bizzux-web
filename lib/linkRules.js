// Pure rules for company link requests (no database imports, so they can be unit tested).
export const LINK_TTL_DAYS = 7;
export const MAX_REQUESTS_PER_HOUR = 10;

// "" when this request may still be answered by `uid` now, otherwise the reason.
export function linkRequestProblem(r, uid, now = Date.now()) {
  if (!r) return "That request no longer exists.";
  if (r.targetUid !== uid) return "That request is not for you.";
  if (r.status !== "pending") return "That request has already been answered.";
  const exp = r.expiresAt?.toMillis ? r.expiresAt.toMillis() : Number(r.expiresAt) || 0;
  if (!exp || exp < now) return "That request has expired. Ask the company admin to send it again.";
  return "";
}

export const linkRequestId = (organizationId, targetUid) => `${organizationId}_${targetUid}`;

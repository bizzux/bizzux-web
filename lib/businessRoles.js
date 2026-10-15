// "What is your role in your company?" — the person's real job, NOT their Bizzux permissions
// (those are the workspace role and per-app roles). Stored as the key.
export const BUSINESS_ROLES = [
  { key: "owner", label: "Business Owner / Founder" },
  { key: "director", label: "Director / Executive" },
  { key: "manager", label: "Manager / Department Head" },
  { key: "hr_admin", label: "HR / Administration" },
  { key: "it_admin", label: "IT Administrator" },
  { key: "employee", label: "Employee" },
  { key: "consultant", label: "Consultant / External Service Provider" },
  { key: "other", label: "Other" },
];
export const BUSINESS_ROLE_KEYS = BUSINESS_ROLES.map((r) => r.key);
export const cleanBusinessRole = (v) => (BUSINESS_ROLE_KEYS.includes(v) ? v : "");
export const businessRoleLabel = (k) => BUSINESS_ROLES.find((r) => r.key === k)?.label || "";

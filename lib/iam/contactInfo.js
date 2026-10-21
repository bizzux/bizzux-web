// Optional, purely descriptive profile information stored with a person's company record. Same shape the invite flow already stores
// (/api/team "invite" contactInfo). None of it gates access or feeds any role or permission logic.
export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contractor", "Intern"];
const t = (v, n) => String(v || "").trim().slice(0, n);
export function cleanContactInfo(ci) {
  const x = ci && typeof ci === "object" ? ci : {};
  return {
    jobTitle: t(x.jobTitle, 100), department: t(x.department, 100), employmentType: EMPLOYMENT_TYPES.includes(x.employmentType) ? x.employmentType : "",
    office: t(x.office, 100), officePhone: t(x.officePhone, 40), faxNumber: t(x.faxNumber, 40), mobilePhone: t(x.mobilePhone, 40),
    streetAddress: t(x.streetAddress, 200), city: t(x.city, 100), state: t(x.state, 100), zip: t(x.zip, 20), country: t(x.country, 100),
  };
}

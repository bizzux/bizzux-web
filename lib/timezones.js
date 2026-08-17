// Full IANA time zone list via the built-in Intl API — no hand-maintained
// data to get stale or incomplete. Intl.supportedValuesOf('timeZone') is
// supported in all modern evergreen browsers and Node 18+; the short
// fallback list below only kicks in on something old enough not to have it,
// so the field never renders empty.
const FALLBACK_TIMEZONES = [
  "Pacific/Midway", "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Denver",
  "America/Chicago", "America/New_York", "America/Sao_Paulo", "Atlantic/Azores", "Europe/London",
  "Europe/Paris", "Europe/Berlin", "Europe/Moscow", "Africa/Cairo", "Africa/Johannesburg", "Asia/Dubai",
  "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Singapore", "Asia/Shanghai",
  "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney", "Pacific/Auckland",
];

export function getTimezones() {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      const zones = Intl.supportedValuesOf("timeZone");
      if (Array.isArray(zones) && zones.length > 0) return zones;
    }
  } catch {
    // fall through to the static list below
  }
  return FALLBACK_TIMEZONES;
}

// Human-friendly label with the current UTC offset, e.g. "Asia/Kolkata
// (UTC+05:30)" — makes a 400-entry dropdown actually scannable.
export function formatTimezoneLabel(tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date());
    const offset = parts.find((p) => p.type === "timeZoneName")?.value || "";
    return offset ? `${tz} (${offset})` : tz;
  } catch {
    return tz;
  }
}

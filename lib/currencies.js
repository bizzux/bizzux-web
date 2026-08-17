// Full ISO 4217 currency code list via the built-in Intl API, same reasoning
// as lib/timezones.js — Intl.supportedValuesOf('currency') is supported in
// all modern evergreen browsers and Node 18+. The fallback list below only
// kicks in on something old enough not to have it.
const FALLBACK_CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "AED", "AUD", "CAD", "SGD", "JPY", "CNY", "CHF", "ZAR", "SAR", "QAR", "KWD",
  "BHD", "OMR", "PKR", "BDT", "LKR", "NPR", "MYR", "IDR", "PHP", "THB", "VND", "KRW", "NZD", "BRL", "MXN",
  "NGN", "KES", "EGP",
];

export function getCurrencyCodes() {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      const codes = Intl.supportedValuesOf("currency");
      if (Array.isArray(codes) && codes.length > 0) return codes;
    }
  } catch {
    // fall through to the static list below
  }
  return FALLBACK_CURRENCIES;
}

// Human-friendly label, e.g. "INR — Indian Rupee". Falls back to the bare
// code if Intl.DisplayNames can't resolve a name for it (some ISO 4217
// codes, e.g. precious metals like XAU, have no display name).
export function formatCurrencyLabel(code) {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "currency" });
    const name = dn.of(code);
    return name && name !== code ? `${code} — ${name}` : code;
  } catch {
    return code;
  }
}

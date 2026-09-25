// The ONLY place Bizzux's starting prices live in code. They are seed values:
// lib/pricing.js writes them into Firestore (pricingPlans/, appPricing/,
// pricingSettings/config) the first time anything reads pricing, and from
// then on Firestore is the source of truth, edited in
// Global Admin → Billing & Pricing. Changing a number here does NOT change a
// live price once it has been seeded. Nothing else in the app should ever
// contain a literal price.

export const DEFAULT_PRICING_PLANS = [
  {
    planCode: "APP",
    planName: "Bizzux App",
    planType: "APP",
    tagline: "One Bizzux application of your choice",
    description: "Pick the one app your business needs today. Add more or move to the Suite any time.",
    currency: "INR",
    monthlyPricePerUser: 599,
    annualPricePerUser: 5990,
    monthlyBillingEnabled: true,
    annualBillingEnabled: true,
    discountLabel: "Save 17%",
    offerText: "2 Months Free",
    badge: "",
    ctaLabel: "Choose an App",
    active: true,
    displayOrder: 1,
  },
  {
    planCode: "SUITE",
    planName: "Bizzux Suite",
    planType: "SUITE",
    tagline: "Complete Business Management Software Suite",
    description: "All included Bizzux business applications under one subscription.",
    currency: "INR",
    monthlyPricePerUser: 999,
    annualPricePerUser: 9990,
    monthlyBillingEnabled: true,
    annualBillingEnabled: true,
    discountLabel: "Save 17%",
    offerText: "2 Months Free",
    badge: "BEST VALUE",
    ctaLabel: "Get Bizzux Suite",
    active: true,
    displayOrder: 2,
  },
];

// Apps start with no price of their own — they inherit the Bizzux App plan
// price until an admin turns on a per-app override. `appKey` matches the
// keys the dashboard, SSO routes and appUsage stamps already use.
export const DEFAULT_APP_PRICING = [
  { appKey: "juicechatjunction", appName: "Bizzux Business", icon: "🏪", description: "Sales, inventory, purchases, expenses and daily operations." },
  { appKey: "pos", appName: "Bizzux POS", icon: "🧾", description: "A fast billing counter: new sale, history and menu." },
  { appKey: "crm", appName: "Bizzux CRM", icon: "📇", description: "Leads, contacts and deals through your sales pipeline." },
  { appKey: "projects", appName: "Bizzux Projects", icon: "🗒️", description: "Projects and tasks on a Kanban board." },
  { appKey: "notes", appName: "Bizzux Notes", icon: "📝", description: "Live meeting transcription and AI summaries." },
  { appKey: "files", appName: "Bizzux Files", icon: "🗂️", description: "Upload, name and search your transcripts and notes." },
  { appKey: "chat", appName: "Bizzux Chat", icon: "💬", description: "Team channels and direct messages." },
  { appKey: "mail", appName: "Bizzux Mail", icon: "📧", description: "Your own @mail.bizzux.com inbox." },
].map((a, i) => ({
  ...a,
  pricingPlanId: "APP",
  overrideEnabled: false,
  monthlyPriceOverride: null,
  annualPriceOverride: null,
  individualPurchaseEnabled: true,
  suiteIncluded: true,
  active: true,
  displayOrder: i + 1,
}));

export const DEFAULT_PRICING_SETTINGS = {
  // Estimated INR -> USD rate for the pricing page's USD view and Stripe
  // charges. Admin-editable in Billing & Pricing.
  usdRate: 83,
  maxUsersPerCheckout: 500,
};

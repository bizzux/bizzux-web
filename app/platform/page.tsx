import { Container, Eyebrow, CTAButton } from "@/components/Section";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bizzux Platform — All-in-One Business Management Software",
  description:
    "Bizzux is the all-in-one business management software for small businesses and SMBs — CRM, invoicing, scheduling, inventory, and HR in one platform.",
};

const features = [
  {
    title: "New Sale (Point of Sale)",
    problem: "“I don’t have a proper record of what I sold today.”",
    outcome:
      "Tap items from a categorized menu, cart auto-totals, capture Cash/UPI payment, even backdate a late entry. Every sale logged in seconds — no manual math.",
  },
  {
    title: "Sales History",
    problem: "“I can’t prove my numbers to a bank or tax officer.”",
    outcome:
      "Filter by date range and payment type, search by item, export to CSV or PDF. A complete audit trail ready for GST filing or loan applications.",
  },
  {
    title: "Menu / Item Management",
    problem: "“Prices and stock live in my head — hard to hand off to staff.”",
    outcome:
      "Every item has a category, price, tax rate, photo, and stock toggle. Anyone at the counter can sell accurately without memorizing anything.",
  },
  {
    title: "Purchases",
    problem: "“I don’t really know what my ingredients are costing me.”",
    outcome:
      "Record every raw-material purchase — it flows automatically into inventory and expenses, feeding straight into your profit number.",
  },
  {
    title: "Expenses (OpEx / CapEx)",
    problem: "“I don’t separate what I spend monthly from what I spend once.”",
    outcome:
      "Expenses split into OpEx / CapEx tabs with recurring-cost flags and category breakdowns — the exact inputs for a real break-even calculation.",
  },
  {
    title: "Inventory",
    problem: "“I run out of key items, or over-buy and it goes bad.”",
    outcome:
      "Live stock levels, automatic low-stock alerts, and expiry tracking. Fewer lost sales, less waste.",
  },
  {
    title: "Summary Dashboard",
    problem: "“I genuinely don’t know if I made money today.”",
    outcome:
      "Total sales and net profit side-by-side, a vs.-yesterday comparison, and an action-needed panel — real profit, visible the moment you log in.",
  },
  {
    title: "Analytics",
    problem: "“I don’t know what’s actually working in my business.”",
    outcome:
      "Average order value, best day, peak hour, sales by weekday, and payment-method split — business intelligence you can act on immediately.",
  },
];

export default function PlatformPage() {
  return (
    <>
      <section className="pt-20 pb-16 bg-gradient-to-b from-teal-50/60 to-white">
        <Container className="text-center">
          <Eyebrow>Bizzux Platform</Eyebrow>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6">
            Everything your business runs on. In one app.
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto mb-10">
            Bizzux turns a shop that used to run on memory, a notebook, and a cash tin
            into a shop that runs on real numbers — without asking the owner to
            become an accountant.
          </p>
          <CTAButton href="/contact">Start Your Free Trial</CTAButton>
        </Container>
      </section>

      <section className="py-20 border-t border-slate-100">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-3xl font-bold mb-4">Problem, feature, outcome</h2>
            <p className="text-slate-600">
              Every screen in Bizzux maps to a piece of financial literacy most small
              business owners are never taught.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-100 p-6 bg-white shadow-sm">
                <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-sm text-slate-500 italic mb-3">{f.problem}</p>
                <p className="text-sm text-slate-700">{f.outcome}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 bg-slate-50 border-t border-slate-100">
        <Container>
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-3xl font-bold mb-4">Who it&apos;s for</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              ["Small businesses & solopreneurs", "One simple system instead of six subscriptions."],
              ["Growing SMBs (10–100 employees)", "Outgrown spreadsheets, need real workflow tools."],
              ["Agencies & service businesses", "Managing multiple clients, projects, and deliverables at once."],
            ].map(([title, desc]) => (
              <div key={title} className="bg-white rounded-xl p-6 border border-slate-100 text-center">
                <h3 className="font-semibold mb-2">{title}</h3>
                <p className="text-sm text-slate-600">{desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 text-center border-t border-slate-100">
        <Container>
          <h2 className="text-3xl font-bold mb-4">Start your free trial</h2>
          <p className="text-slate-600 mb-8">No credit card required.</p>
          <CTAButton href="/contact">Get Started with Bizzux</CTAButton>
        </Container>
      </section>
    </>
  );
}

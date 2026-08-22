"use client";

import { useState } from "react";

const businessTypes = [
  "Juice / beverage shop",
  "Café / bakery / snack shop",
  "Restaurant / fast food",
  "Retail / provision store",
  "Other",
];

export default function ContactForm() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Something went wrong");
      setStatus("success");
      form.reset();
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Something went wrong");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-brand-teal/30 bg-teal-50 p-8 text-center">
        <h3 className="font-semibold text-lg mb-2">Thanks, we&apos;ve got it.</h3>
        <p className="text-sm text-slate-600">Our team will reach out to schedule your demo shortly.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="name">Name</label>
          <input required id="name" name="name" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="business">Business name</label>
          <input required id="business" name="business" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="mobile">Mobile number</label>
          <input required type="tel" id="mobile" name="mobile" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="businessType">Business type</label>
          <select id="businessType" name="businessType" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal">
            {businessTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="shops">Number of shops</label>
        <input id="shops" name="shops" type="number" min={1} defaultValue={1} className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="challenge">Current challenge</label>
        <textarea id="challenge" name="challenge" rows={3} placeholder="e.g. tracking daily profit, managing stock, too many separate apps" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="preferredTime">Preferred demo time</label>
        <input id="preferredTime" name="preferredTime" placeholder="e.g. weekday evenings" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
      </div>
      {status === "error" && <p className="text-sm text-red-600">{errorMsg}</p>}
      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full h-10 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white font-semibold px-6 text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {status === "loading" ? "Sending…" : "Request a demo"}
      </button>
    </form>
  );
}

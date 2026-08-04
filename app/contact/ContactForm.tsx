"use client";

import { useState } from "react";

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
      <div className="rounded-xl border border-brand/30 bg-teal-50 p-8 text-center">
        <h3 className="font-semibold text-lg mb-2">Thanks — we&apos;ve got it.</h3>
        <p className="text-sm text-slate-600">We&apos;ll get back to you shortly.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="name">Name</label>
          <input required id="name" name="name" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="email">Email</label>
          <input required type="email" id="email" name="email" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="business">Business name (optional)</label>
        <input id="business" name="business" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="interest">I&apos;m interested in</label>
        <select id="interest" name="interest" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
          <option value="platform">Bizzux Platform (free trial)</option>
          <option value="custom">Custom Software Development</option>
          <option value="other">Something else</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="message">Message</label>
        <textarea id="message" name="message" rows={4} className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
      </div>
      {status === "error" && (
        <p className="text-sm text-red-600">{errorMsg}</p>
      )}
      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-full bg-brand text-white font-semibold px-6 py-3 text-sm hover:bg-brand-dark transition-colors disabled:opacity-60"
      >
        {status === "loading" ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

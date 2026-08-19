"use client";

import { useState } from "react";

const areas = [
  "Frontend development",
  "Backend and cloud development",
  "AI/ML and agentic AI",
  "UI/UX design",
  "Business analysis",
  "Digital marketing and sales",
  "Quality assurance",
];

export default function CareersForm() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    const form = e.currentTarget;
    const formData = new FormData(form);

    try {
      const res = await fetch("/api/careers", { method: "POST", body: formData });
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
        <h3 className="font-semibold text-lg mb-2">Application received.</h3>
        <p className="text-sm text-slate-600">Thanks for your interest in Bizzux. Our team will review and reach out.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" encType="multipart/form-data">
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="fullName">Full name</label>
          <input required id="fullName" name="fullName" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="email">Email address</label>
          <input required type="email" id="email" name="email" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="mobile">Mobile number</label>
          <input required type="tel" id="mobile" name="mobile" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="college">College / university</label>
          <input id="college" name="college" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="course">Course and year of study</label>
          <input id="course" name="course" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="area">Area of interest</label>
          <select id="area" name="area" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal">
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="linkedin">LinkedIn profile</label>
          <input id="linkedin" name="linkedin" type="url" placeholder="https://linkedin.com/in/..." className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="portfolio">Portfolio / GitHub link</label>
          <input id="portfolio" name="portfolio" type="url" placeholder="https://github.com/..." className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="why">Why do you want to join Bizzux?</label>
        <textarea id="why" name="why" rows={4} className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="resume">Upload resume (PDF or DOCX)</label>
        <input
          id="resume"
          name="resume"
          type="file"
          accept=".pdf,.doc,.docx"
          className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-slate-100 file:px-4 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
        />
      </div>
      {status === "error" && <p className="text-sm text-red-600">{errorMsg}</p>}
      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-full bg-gradient-to-r from-brand-teal to-brand-blue text-white font-semibold px-6 py-3 text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {status === "loading" ? "Submitting…" : "Apply for Internship"}
      </button>
    </form>
  );
}

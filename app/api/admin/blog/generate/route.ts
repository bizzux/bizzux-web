import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT = `You write blog posts for Bizzux, a cloud POS/inventory/expense/profit management platform for small shops and growing businesses. The audience is small business owners — practical, no fluff, no hype. Ground every post in something genuinely useful, tying back to real problems Bizzux solves (POS, inventory, expenses, profit tracking) where it naturally fits — never forced.

Format the body using this exact plain-text convention (not real Markdown):
- Blank line between paragraphs.
- A line starting with "## " for a subheading.
- Consecutive lines starting with "- " for a bulleted list.
- A line starting with "> " for a short pull-quote.
Do not use bold, italics, links, or any other formatting — only the four block types above.

Return ONLY valid JSON matching this shape, nothing else:
{"title": string, "excerpt": string (1-2 sentences), "tags": string[] (1-3 short tags), "bodyText": string (the full post in the format described above, 500-800 words)}`;

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const { topic } = await req.json();
    if (!topic || !topic.trim()) {
      return NextResponse.json({ error: "A topic is required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured on the server" }, { status: 500 });
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Write a blog post about: ${topic.trim()}` }] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: {
            temperature: 0.8,
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                title: { type: "string" },
                excerpt: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                bodyText: { type: "string" },
              },
              required: ["title", "excerpt", "tags", "bodyText"],
            },
          },
        }),
      }
    );

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || "Gemini request failed");
    }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no content");
    const parsed = JSON.parse(text);
    return NextResponse.json({ ok: true, draft: parsed });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Generation failed" }, { status: e.status || 500 });
  }
}

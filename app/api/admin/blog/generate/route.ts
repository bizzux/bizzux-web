import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT = `You write blog posts published under the Bizzux Technologies brand (bizzux.com — "Build, Secure, Scale"). Bizzux covers two related tracks, and a given post belongs to ONE of them, not both forced together:

1. Small-business practical content — POS, inventory, expenses, profit tracking, running a shop day to day. Audience: small business owners. Ground it in real problems Bizzux's own platform solves where that's genuinely the topic — never force a product tie-in onto a post that isn't about this.
2. Cybersecurity / AI / technology thought-leadership — frameworks, standards (NIST, ISO, OWASP, MITRE, etc.), AI/agentic systems, cloud and application security, written to build authority and be genuinely useful to a technical or business-technology reader. No forced product pitch here — this track exists to demonstrate expertise, not to sell.

Match the tone and depth to whichever track the topic actually belongs to. Both are practical and no-fluff — explain real substance, not hype.

Format the body using this exact plain-text convention (not real Markdown):
- Blank line between paragraphs.
- A line starting with "## " for a subheading.
- Consecutive lines starting with "- " for a bulleted list.
- A line starting with "> " for a short pull-quote.
Do not use bold, italics, links, or any other formatting — only the four block types above.

Return ONLY valid JSON matching this shape, nothing else:
{"title": string, "excerpt": string (1-2 sentences), "tags": string[] (1-3 short tags), "bodyText": string (the full post in the format described above, 500-800 words)}`;

const IMAGE_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

You've been given an image (e.g. an infographic, chart, or diagram) instead of — or alongside — a topic. Look at what it actually shows and write the post about that specific content: explain the framework/data/concept it presents, in your own words, for a small business owner audience. Don't just describe "there is an infographic" — write as if explaining its content directly. If a topic/angle is also given, use it to steer the take.`;

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const { topic, imageBase64, imageMimeType } = await req.json();
    const hasTopic = typeof topic === "string" && topic.trim().length > 0;
    const hasImage = typeof imageBase64 === "string" && imageBase64.length > 0;
    if (!hasTopic && !hasImage) {
      return NextResponse.json({ error: "A topic or an image is required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured on the server" }, { status: 500 });
    }

    const parts: any[] = [];
    if (hasImage) {
      parts.push({ inlineData: { mimeType: imageMimeType || "image/png", data: imageBase64 } });
    }
    parts.push({
      text: hasTopic
        ? `Write a blog post about: ${topic.trim()}`
        : "Write a blog post based on what this image shows.",
    });

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          systemInstruction: { parts: [{ text: hasImage ? IMAGE_SYSTEM_PROMPT : SYSTEM_PROMPT }] },
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

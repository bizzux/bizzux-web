// SERVER ONLY. Turns a finished meeting transcript into a short summary +
// action-item list via Groq's OpenAI-compatible chat-completions endpoint
// (same provider the sibling jobgalax repo already uses for its free-tier
// Llama access). Never throws on a malformed model response — only on a
// real network/API failure — so a bad JSON parse degrades to "here's the
// raw text" instead of losing the whole meeting.
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

export async function summarizeTranscript(transcriptText, { title } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");

  const text = String(transcriptText || "").trim();
  if (!text) return { summary: "", actionItems: [] };

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You summarize business meeting transcripts. Reply ONLY with a JSON object " +
            'shaped exactly like {"summary": string, "actionItems": [{"text": string, "owner": string|null}]}. ' +
            "The summary should be 3-6 sentences covering what was discussed and decided. " +
            "Action items should be concrete next steps; infer an owner's name from the transcript " +
            "only if it's clearly stated, otherwise use null. If nothing actionable came up, return an empty array.",
        },
        {
          role: "user",
          content: `Meeting title: ${title || "Untitled meeting"}\n\nTranscript:\n${text}`,
        },
      ],
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error?.message || "Groq summarization request failed");
  }

  const raw = data?.choices?.[0]?.message?.content || "";
  try {
    const parsed = JSON.parse(raw);
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems
            .filter((a) => a && typeof a.text === "string" && a.text.trim())
            .map((a) => ({ text: a.text.trim(), owner: typeof a.owner === "string" ? a.owner : null }))
        : [],
    };
  } catch {
    // Model didn't return valid JSON despite response_format — fall back to
    // showing its raw reply as the summary rather than failing the meeting.
    return { summary: raw || "Summary generation returned an unexpected format.", actionItems: [] };
  }
}

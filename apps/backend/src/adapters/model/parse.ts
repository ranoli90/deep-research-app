export type ParsedAction = { type: string; rationale: string; query?: string };

const ALLOWED = new Set([
  "search",
  "fetch",
  "synthesize",
  "stop",
  "clarify",
  "compare",
  "calculate",
  "verify",
  "challenge",
  "replan",
  "extract_text",
]);

/** Nonbillable: parse a model action payload without calling a provider. */
export function parseActionJson(text: string): ParsedAction {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1]!.trim() : trimmed;
  let parsed: { type?: string; rationale?: string; query?: string; locator?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { type: "synthesize", rationale: "unparseable model output; finishing from stored evidence" };
  }
  const type = ALLOWED.has(parsed.type ?? "") ? parsed.type! : "synthesize";
  const query = parsed.query ?? parsed.locator;
  return { type, rationale: parsed.rationale ?? "model proposal", query };
}

export type UrlCitation = { url: string; title: string; snippet: string };

export function parseUrlCitations(message: {
  annotations?: { type?: string; url_citation?: { url?: string; title?: string; content?: string } }[];
}): UrlCitation[] {
  const out: UrlCitation[] = [];
  for (const a of message.annotations ?? []) {
    if (a.type !== "url_citation" || !a.url_citation?.url) continue;
    const url = a.url_citation.url;
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    out.push({
      url,
      title: a.url_citation.title || url,
      snippet: (a.url_citation.content ?? "").slice(0, 800),
    });
  }
  return out;
}

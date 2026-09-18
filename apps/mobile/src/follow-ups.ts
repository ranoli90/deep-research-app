import { editorialSections } from "./report-hierarchy";
import type { ReportBlock } from "./state";

export type FollowUpSuggestion = { id: string; label: string; prompt: string };

function shorten(text: string, max = 42): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trimEnd()}…`;
}

/** 1–3 follow-ups taken only from unresolved items, caveats, and named limitations. */
export function followUpSuggestions(input: {
  blocks: ReportBlock[];
  limitations?: string[];
}): FollowUpSuggestion[] {
  const sections = editorialSections(input.blocks);
  const unresolved = sections.find((section) => section.id === "unresolved")?.blocks ?? [];
  const caveats = sections.find((section) => section.id === "caveats")?.blocks ?? [];
  const items: { id: string; text: string }[] = [];
  for (const block of unresolved) items.push({ id: block.id, text: block.text.trim() });
  for (const block of caveats) items.push({ id: block.id, text: block.text.trim() });
  for (const [index, line] of (input.limitations ?? []).entries()) {
    const text = line.trim();
    if (text) items.push({ id: `limitation-${index}`, text });
  }
  const seen = new Set<string>();
  const out: FollowUpSuggestion[] = [];
  for (const item of items) {
    const key = item.text.toLowerCase();
    if (!item.text || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: item.id,
      label: shorten(item.text),
      prompt: item.text,
    });
    if (out.length === 3) break;
  }
  return out;
}

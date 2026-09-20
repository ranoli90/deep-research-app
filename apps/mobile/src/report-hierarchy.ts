import type { ReportBlock } from "./state";

export type ReportSectionId =
  | "answer"
  | "factors"
  | "comparison"
  | "caveats"
  | "unresolved"
  | "calculations"
  | "evidence"
  | "changes";

export type ReportSection = { id: ReportSectionId; title: string; blocks: ReportBlock[] };

const ORDER: ReportSectionId[] = [
  "answer",
  "factors",
  "comparison",
  "caveats",
  "unresolved",
  "calculations",
  "evidence",
  "changes",
];

const TITLES: Record<ReportSectionId, string> = {
  answer: "Answer",
  factors: "Deciding factors",
  comparison: "Comparison",
  caveats: "Caveats",
  unresolved: "Unresolved",
  calculations: "Calculations",
  evidence: "Supporting evidence",
  changes: "What changed",
};

function sectionFor(block: ReportBlock): ReportSectionId {
  const id = block.id.toLowerCase();
  if (id === "answer" || block.kind === "heading" && /answer/i.test(block.text)) return "answer";
  if (id === "constraints" || id === "eligibility") return "factors";
  if (id.includes("comparison") || id === "candidate-listing") return "comparison";
  if (id.includes("unresolved") || id.includes("limitation") || id.startsWith("disconfirm")) return "unresolved";
  if (id.includes("calculation") || id === "denominators") return "calculations";
  if (id.includes("change") || id === "revision") return "changes";
  if (block.kind === "caveat" || id.startsWith("contradiction")) return "caveats";
  if (id === "answer") return "answer";
  return "evidence";
}

/** Answer-first editorial grouping. Unknown blocks still appear, after the answer. */
export function editorialSections(blocks: ReportBlock[]): ReportSection[] {
  const buckets = new Map<ReportSectionId, ReportBlock[]>();
  for (const id of ORDER) buckets.set(id, []);
  const seen = new Set<string>();
  for (const block of blocks) {
    if (seen.has(block.id)) continue;
    seen.add(block.id);
    const section = sectionFor(block);
    buckets.get(section)!.push(block);
  }
  return ORDER
    .map((id) => ({ id, title: TITLES[id], blocks: buckets.get(id) ?? [] }))
    .filter((section) => section.blocks.length > 0);
}

export function reportOutline(sections: ReportSection[]): { id: string; title: string }[] {
  return sections.map((section) => ({ id: section.id, title: section.title }));
}

/** TOC only on long reports. Short answer-first pages stay uncluttered. */
export function reportNeedsOutline(sections: ReportSection[]): boolean {
  const blocks = sections.flatMap((section) => section.blocks);
  const chars = blocks.reduce((n, block) => n + block.text.length, 0);
  if (chars >= 900) return true;
  if (blocks.length >= 8) return true;
  return false;
}

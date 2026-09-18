/** Named evidence states. Never a fake confidence percent. */

export const UNCERTAINTY_STATES = [
  "verified",
  "supportable",
  "disputed",
  "partial",
  "unresolved",
  "inaccessible",
  "inference",
  "stale",
] as const;

export type UncertaintyState = (typeof UNCERTAINTY_STATES)[number];

const LABELS: Record<UncertaintyState, string> = {
  verified: "Verified",
  supportable: "Supportable",
  disputed: "Disputed",
  partial: "Partial",
  unresolved: "Unresolved",
  inaccessible: "Inaccessible",
  inference: "Inference",
  stale: "Outdated",
};

export function uncertaintyLabel(state: UncertaintyState): string {
  return LABELS[state];
}

export function isConfidencePercent(text: string): boolean {
  return /\b\d{1,3}\s?%\s*(confidence|certain|sure)\b/i.test(text) || /^\s*\d{1,3}%\s*$/.test(text.trim());
}

export function uncertaintyFromSource(source: {
  accessLevel: string;
  coverage?: string | null;
  warnings?: string[];
  exactText?: string;
}): UncertaintyState {
  const access = source.accessLevel.toLowerCase();
  const text = `${source.exactText ?? ""} ${(source.warnings ?? []).join(" ")}`.toLowerCase();
  if (access === "blocked" || access === "failed") return "inaccessible";
  if (/\b(outdated|stale|superseded|no longer current)\b/.test(text)) return "stale";
  if (/\b(disputed|contradict|conflict)\b/.test(text)) return "disputed";
  if (/\binference\b/.test(text) || /\bnot established fact\b/.test(text)) return "inference";
  if (/\bunresolved\b/.test(text)) return "unresolved";
  if (access === "snippet" || access === "abstract" || access === "partial-text" || source.coverage === "partial") {
    return "partial";
  }
  if (access === "full-text" && (source.coverage === "complete" || source.coverage == null)) return "supportable";
  if (access === "discovered" || access === "visual-inspected") return "partial";
  return "partial";
}

export function uncertaintyFromBlock(block: { kind: string; text: string; id?: string }): UncertaintyState | null {
  if (isConfidencePercent(block.text)) return null;
  const text = block.text.toLowerCase();
  if (block.kind === "caveat" && /\bunresolved\b/.test(text)) return "unresolved";
  if (/\binference \(not established fact\)/.test(text) || text.startsWith("inference")) return "inference";
  if (/\b(outdated|stale pricing|no longer current)\b/.test(text)) return "stale";
  if (/\b(disputed|contradict)\b/.test(text)) return "disputed";
  if (block.kind === "caveat") return "unresolved";
  return null;
}

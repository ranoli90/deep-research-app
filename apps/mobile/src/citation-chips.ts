import type { ReportBlock } from "./state";

/** First-appearance citation numbers. Never show raw passage UUIDs in the reader. */
export function citationNumbers(blocks: ReportBlock[]): Record<string, number> {
  const out: Record<string, number> = {};
  let n = 0;
  for (const block of blocks) {
    for (const id of block.citationIds) {
      if (!id.trim() || out[id] != null) continue;
      n += 1;
      out[id] = n;
    }
  }
  return out;
}

export function citationChipLabel(index: number, domain?: string | null): string {
  if (!Number.isSafeInteger(index) || index < 1) return "";
  const host = domain?.trim();
  return host ? `[${index}] · ${host}` : `[${index}]`;
}

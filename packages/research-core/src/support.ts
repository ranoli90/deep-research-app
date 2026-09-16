export type SupportDecision = "supports" | "contradicts" | "qualifies" | "context-only" | "unsupported";

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "were",
  "be",
  "as",
  "by",
  "with",
  "that",
  "this",
  "from",
  "at",
  "it",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.\- ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Passage must actually bear on the asserted fact. Mentioning an entity is not support.
 */
export function passageSupportsClaim(passageText: string, claimText: string): SupportDecision {
  const p = passageText.toLowerCase();
  const c = claimText.toLowerCase();

  if (/\bdoes not exist\b|\bno such (product|feature)\b|\bnot offered\b|\bno evidence that\b/.test(p) &&
      /\bexists\b|\bincludes\b|\boffers\b/.test(c) &&
      !/\bdoes not\b|\bno such\b|\bnot\b/.test(c)) {
    return "contradicts";
  }

  const claimNums = claimText.match(/-?\d+(?:\.\d+)?/g) ?? [];
  for (const n of claimNums) {
    if (n.length >= 2 && !p.includes(n)) {
      const entityHit = tokenize(claimText).some((t) => p.includes(t));
      if (entityHit) return "unsupported";
    }
  }

  const claimTokens = tokenize(claimText);
  const passageTokens = new Set(tokenize(passageText));
  if (claimTokens.length === 0) return "unsupported";
  const overlap = claimTokens.filter((t) => passageTokens.has(t)).length;
  const ratio = overlap / claimTokens.length;

  const assertsFact = /\b(is|are|was|were|equals|costs|includes|supports|requires|announced)\b/i.test(claimText);
  if (assertsFact && ratio < 0.35) return "context-only";
  if (ratio < 0.25) return "unsupported";
  if (/\bhowever\b|\bexcept\b|\bonly in\b|\blimited to\b/.test(p) && !/\bhowever\b|\bexcept\b|\bonly\b/.test(c)) {
    return "qualifies";
  }
  return "supports";
}

export function citationIdsExist(citationIds: string[], knownIds: Set<string>): string[] {
  return citationIds.filter((id) => !knownIds.has(id));
}

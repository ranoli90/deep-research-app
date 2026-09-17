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
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:[.\-][\p{L}\p{N}]+)*/gu) ?? [])
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Passage must actually bear on the asserted fact. Mentioning an entity is not support.
 */
export function passageSupportsClaim(passageText: string, claimText: string): SupportDecision {
  const p = passageText.toLowerCase();
  const c = claimText.toLowerCase();
  if (p.trim() === c.trim() && c.trim()) return "supports";

  const negated = /\b(?:not|never|no|cannot|can't|doesn't|isn't|unsupported)\b/;
  for (const sentence of passageText.split(/(?<=[.!?])\s+(?=\p{Lu})/u)) {
    if (negated.test(sentence.toLowerCase()) === negated.test(c)) continue;
    const content = tokenize(claimText).filter((t) => !negated.test(t));
    const overlap = content.filter((t) => tokenize(sentence).includes(t)).length;
    if (content.length && overlap / content.length >= 0.5) return "contradicts";
  }

  if (/\bdoes not exist\b|\bno such (product|feature)\b|\bnot offered\b|\bno evidence that\b/.test(p) &&
      /\bexists\b|\bincludes\b|\boffers\b/.test(c) &&
      !/\bdoes not\b|\bno such\b|\bnot\b/.test(c)) {
    return "contradicts";
  }

  const claimNums = claimText.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const passageNums = new Set(passageText.match(/-?\d+(?:\.\d+)?/g) ?? []);
  for (const n of claimNums) {
    if (!passageNums.has(n)) return "unsupported";
  }

  const claimTokens = tokenize(claimText);
  const passageTokens = new Set(tokenize(passageText));
  if (claimTokens.length === 0) return "unsupported";
  const overlap = claimTokens.filter((t) => passageTokens.has(t)).length;
  const ratio = overlap / claimTokens.length;

  const passageScoped = /\b(adults? over \d+|adults only|children|one population|this sample)\b/i.test(passageText);
  const claimUniversal = /\b(everyone|all patients|the general population|unqualified)\b/i.test(claimText);
  if (passageScoped && claimUniversal) return "qualifies";
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

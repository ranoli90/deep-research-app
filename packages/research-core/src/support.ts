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
const QUALIFICATION = /\b(?:however|except|only|limited to|unless|subject to|may|might|could)\b/;
/** Qualifications must attach to the asserted statement, not merely occur somewhere on a page.
 * Explicit discourse references remain conservative; this is not a general coreference resolver.
 */
function relevantQualification(passage:string,claim:string):boolean {
  if(QUALIFICATION.test(claim.toLowerCase()))return false;
  const terms=tokenize(claim).filter((t)=>!['does','not','never','cannot','only','may','might','could'].includes(t))
    .map((t)=>t.replace(/s$/u,''));
  return passage.split(/(?<=[.!?])\s+|\n+/u).some((sentence)=>{
    const lower=sentence.toLowerCase().trim();
    if(!QUALIFICATION.test(lower))return false;
    if(/^(?:however|except|unless|only|subject to|this (?:result|finding|support|capability)|it\b|these\b)/u.test(lower))return true;
    const words=new Set(tokenize(sentence).map((t)=>t.replace(/s$/u,'')));
    return terms.length>0 && terms.every((t)=>words.has(t));
  });
}

export function passageSupportsClaim(passageText: string, claimText: string): SupportDecision {
  const p = passageText.toLowerCase();
  const c = claimText.toLowerCase();
  if (p.trim() === c.trim() && c.trim()) return "supports";

  const negated = /\b(?:not|never|no|cannot|can't|doesn't|isn't|unsupported)\b/;
  const claimed = c.replace(/[.!?]+$/u, "").trim();
  const sentences = passageText.split(/(?<=[.!?])\s+(?=\p{Lu})/u);
  for (const sentence of sentences) {
    const stated = sentence.toLowerCase().replace(/[.!?]+$/u, "").trim();
    if (claimed && (stated === claimed || stated.startsWith(`${claimed},`) || stated.startsWith(`${claimed} which`))) {
      if (relevantQualification(passageText, claimText)) return "qualifies";
      return "supports";
    }
  }
  for (const sentence of sentences) {
    const sentenceN = sentence.toLowerCase();
    if (negated.test(sentenceN) === negated.test(c)) continue;
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
  const absenceClaim = /\b(not (?:included|part of)|no longer|removed from|is not in|deprecated)\b/i.test(claimText);
  const absencePassage = /\b(no longer part of|removed in|removed from|not part of|is not part of|deprecated)\b/i.test(passageText);
  if (absenceClaim && absencePassage) return "supports";
  if (relevantQualification(passageText,claimText)) return "qualifies";
  // Overlap is useful for rejecting unrelated text, never for proving entailment.
  // Accept a complete literal statement or this narrow, meaning-preserving passive form.
  // Other paraphrases await a substantive scoped assessment rather than an optimistic score.
  const canonical = (text: string): string => {
    const normalized = text.trim().toLowerCase().replace(/\s+/gu, " ").replace(/[.!?]$/, "");
    const passive = normalized.match(/^(.+) is supported by ([\p{L}\p{N} .&-]+)$/u);
    return passive ? `${passive[2]} supports ${passive[1]}` : normalized;
  };
  const asserted = canonical(claimText);
  if (passageText.split(/(?<=[.!?])\s+(?=\p{Lu})/u).some((sentence) => canonical(sentence) === asserted)) return "supports";
  return "context-only";
}

export function citationIdsExist(citationIds: string[], knownIds: Set<string>): string[] {
  return citationIds.filter((id) => !knownIds.has(id));
}

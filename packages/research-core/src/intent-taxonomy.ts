import type { TaskFamily } from "@deep/contracts";

/** Deterministic family label for one-sentence questions. Never rewrites the question. */
export function inferTaskFamily(question: string): TaskFamily {
  const q = question.toLowerCase();
  if (/\b(tax|filing deadline|employment law|which law applies|legal status|jurisdiction|statutes?|regulations?)\b/i.test(q)) {
    return "legal_jurisdiction";
  }
  if (/\b(compatib|works with|support(s|ed)?\s+(postgres|python|node|ios|android)|vs\.?|versus)\b/i.test(q)
    && /\b(version|\d+\.\d+|postgres|library|sdk|api|extension)\b/i.test(q)) {
    return "technical_comparison";
  }
  if (/\b(current|latest|as of now|today|right now|this week)\b/i.test(q)
    && /\b(rate|price|score|population|number|who is|what is the)\b/i.test(q)) {
    return "current_fact";
  }
  if (/\b(buy|purchase|laptop|phone|notebook|recommend|cheapest|best)\b/i.test(q)
    && !/\b(tax|law|filing)\b/i.test(q)) {
    return "underspecified_purchase";
  }
  if (/\b(why|how does|what is known|causes? of|explain)\b/i.test(q)) {
    return "open_ended_research";
  }
  if (/\b(compare|vs\.?|versus|difference between)\b/i.test(q)) {
    return "technical_comparison";
  }
  return "other";
}

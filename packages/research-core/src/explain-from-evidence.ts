import type { ReportBlock } from "@deep/contracts";
import { sourceCannotEscalatePrivilege, sourceLooksLikeInjection } from "./injection.js";
import { locateUniqueQuote } from "./model-span-resolution.js";
import { isReportSectionLabel } from "./citations.js";
import { passageSupportsClaim, tokenize } from "./support.js";

export const EXPLAIN_FROM_EXISTING_EVIDENCE_VERSION = "explain-from-existing-evidence.v1";

/** Honest incomplete copy. Do not treat this as a new research conclusion. */
export const EXPLAIN_EVIDENCE_INCOMPLETE =
  "The current report does not establish that point. Existing owned evidence does not support this explanation.";

const QUESTION_FUNCTION = new Set([
  "why",
  "not",
  "did",
  "didn",
  "didnt",
  "you",
  "your",
  "explain",
  "what",
  "does",
  "mean",
  "how",
  "choose",
  "chosen",
  "pick",
  "picked",
  "instead",
  "please",
  "because",
  "about",
  "this",
  "that",
  "report",
]);

export type ExplainEvidenceClaim = {
  id: string;
  text: string;
  passageIds: readonly string[];
};

export type ExplainEvidencePassage = {
  id: string;
  exactText: string;
};

export type ExplainFromExistingEvidenceInput = {
  message: string;
  blocks: readonly Pick<ReportBlock, "id" | "text" | "claimIds" | "citationIds">[];
  claims: readonly ExplainEvidenceClaim[];
  passages: readonly ExplainEvidencePassage[];
};

export type ExplainFromExistingEvidenceResult = {
  version: typeof EXPLAIN_FROM_EXISTING_EVIDENCE_VERSION;
  answer: string;
  citationPassageIds: string[];
  evidenceComplete: boolean;
};

function focusTerms(message: string): string[] {
  return tokenize(message).filter((t) => !QUESTION_FUNCTION.has(t));
}

function relevantToFocus(text: string, focus: readonly string[]): boolean {
  if (!focus.length) return false;
  const tokens = new Set(tokenize(text).map(stemTerm));
  return focus.some((term) => tokens.has(stemTerm(term)));
}

function sharesEveryFocus(text: string, focus: readonly string[]): boolean {
  const tokens = new Set(tokenize(text).map(stemTerm));
  return focus.every((term) => tokens.has(stemTerm(term)));
}

const stemTerm = (term: string): string => term.replace(/s$/u, "");

function usableExplanationText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || isReportSectionLabel(trimmed)) return false;
  return !sourceLooksLikeInjection(trimmed) && sourceCannotEscalatePrivilege(trimmed) === null;
}

/** Assertion shapes a follow-up can request. A statement must carry the requested shape. */
type ExplanationMode = "cause" | "duration" | "comparison" | "conditional" | "current" | "historical";

const CAUSE_REQUEST = /\b(?:why|how did|how come|reason|reasons|cause[sd]?)\b/iu;
const CAUSE_STATEMENT =
  /\b(?:because|due to|led to|leading to|result(?:ed|s|ing)? in|caused|driven by|as a result|owing to|attributable to|thanks to|stems? from|accounted for)\b/iu;
const DURATION =
  /\b(?:how long|how many (?:years?|months?|weeks?|days?|hours?|minutes?)|duration|lasted|lasting|lasts?|spanned|spanning)\b|\b\d+(?:\.\d+)?\s*(?:years?|months?|weeks?|days?|hours?|minutes?|seconds?)\b/iu;
const COMPARISON =
  /\b(?:compare|compared|versus|vs\.?|difference|better|worse|faster|slower|cheaper|more expensive|higher|lower|greater|less than|than)\b/iu;
const CONDITIONAL = /\b(?:if|unless|provided that|only when|depending on|subject to|in the event|under what conditions)\b/iu;
const CURRENT = /\b(?:current(?:ly)?|now|today|latest|as of|right now|this (?:year|month|week|quarter)|up to date|up-to-date)\b/iu;
const HISTORICAL = /\b(?:historically|formerly|previously|originally|founded|established|was|were)\b|\bin (?:1[0-9]|20)\d{2}\b|\bsince (?:1[0-9]|20)\d{2}\b/iu;

/** A clause's requested explanation obligation. `requireAllFocus` is the narrow why-not reason case. */
type ExplanationObligation = {
  focus: string[];
  requiredModes: readonly ExplanationMode[];
  requireAllFocus: boolean;
};

/** Split only at real clause joins: a question auxiliary or wh-word must start the next clause. */
const CLAUSE_JOIN =
  /\s+\b(?:and|but|also|plus)\b\s+(?=(?:does|do|did|is|are|was|were|can|could|will|would|should|has|have|had|how|why|what|when|where|which|who|whether|if)\b)/giu;

function explanationObligations(message: string): ExplanationObligation[] {
  const clauses = message
    .split(/[?;]+/u)
    .flatMap((sentence) => sentence.split(CLAUSE_JOIN))
    .map((clause) => clause.trim())
    .filter(Boolean);
  const list = clauses.length ? clauses : [message.trim()];
  return list.map((clause) => {
    const focus = focusTerms(clause);
    const modes: ExplanationMode[] = [];
    if (CAUSE_REQUEST.test(clause)) modes.push("cause");
    if (DURATION.test(clause)) modes.push("duration");
    if (COMPARISON.test(clause)) modes.push("comparison");
    if (CONDITIONAL.test(clause)) modes.push("conditional");
    if (CURRENT.test(clause)) modes.push("current");
    if (HISTORICAL.test(clause)) modes.push("historical");
    // "Why not <subject>?" names a candidate and asks for its reason; a grounded
    // statement about that exact subject is inspectable context. Other cause
    // questions (why did X happen) still require a causal statement.
    const whyNot = /\bwhy\s+(?:not|didn'?t|don'?t|doesn'?t)\b/iu.test(clause);
    const requireAllFocus = whyNot && modes.length === 1 && modes[0] === "cause";
    return { focus, requiredModes: requireAllFocus ? [] : modes, requireAllFocus };
  });
}

function statementModes(text: string): Set<ExplanationMode> {
  const modes = new Set<ExplanationMode>();
  if (CAUSE_STATEMENT.test(text)) modes.add("cause");
  if (DURATION.test(text)) modes.add("duration");
  if (COMPARISON.test(text)) modes.add("comparison");
  if (CONDITIONAL.test(text)) modes.add("conditional");
  if (CURRENT.test(text)) modes.add("current");
  if (HISTORICAL.test(text)) modes.add("historical");
  return modes;
}

function obligationRelevant(text: string, obligation: ExplanationObligation): boolean {
  return relevantToFocus(text, obligation.focus);
}

/** A grounded statement satisfies an obligation only when it carries every requested shape.
 * Lexical overlap with the subject is context, never proof that the requested explanation is covered.
 */
function statementSatisfies(text: string, obligation: ExplanationObligation): boolean {
  if (!obligation.focus.length || !obligationRelevant(text, obligation)) return false;
  if (obligation.requireAllFocus) return sharesEveryFocus(text, obligation.focus);
  const modes = statementModes(text);
  return obligation.requiredModes.every((mode) => modes.has(mode));
}

function passageGroundsText(passageText: string, claimText: string): boolean {
  if (passageSupportsClaim(passageText, claimText) === "supports") return true;
  return locateUniqueQuote(passageText, claimText.trim(), { flexibleWhitespace: true }) !== null;
}

function supportingPassageIds(
  text: string,
  candidateIds: readonly string[],
  passages: ReadonlyMap<string, ExplainEvidencePassage>,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of candidateIds) {
    if (seen.has(id)) continue;
    const passage = passages.get(id);
    if (!passage) continue;
    if (!passageGroundsText(passage.exactText, text)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Answer a follow-up from owned report blocks/claims and supporting passage exact texts.
 * Never mutates a brief, invents facts, or treats retrieved injection as permission.
 */
export function explainFromExistingEvidence(input: ExplainFromExistingEvidenceInput): ExplainFromExistingEvidenceResult {
  const obligations = explanationObligations(input.message);
  const owned = new Map(input.passages.map((p) => [p.id, p]));
  const claimsById = new Map(input.claims.map((c) => [c.id, c]));
  const selected: { text: string; citationPassageIds: string[] }[] = [];
  const usedClaims = new Set<string>();
  const relevant = (text: string) => obligations.some((obligation) => obligationRelevant(text, obligation));

  for (const block of input.blocks) {
    if (!usableExplanationText(block.text)) continue;
    const mapped = block.claimIds.map((id) => claimsById.get(id)).filter((c): c is ExplainEvidenceClaim => Boolean(c));
    const relevantBlock = relevant(block.text) || mapped.some((c) => relevant(c.text));
    if (!relevantBlock) continue;
    const candidateIds = [...block.citationIds, ...mapped.flatMap((c) => c.passageIds)];
    const supporting = supportingPassageIds(block.text, candidateIds, owned);
    if (!supporting.length) continue;
    selected.push({ text: block.text.trim(), citationPassageIds: supporting });
    for (const claim of mapped) usedClaims.add(claim.id);
  }

  for (const claim of input.claims) {
    if (usedClaims.has(claim.id) || !usableExplanationText(claim.text) || !relevant(claim.text)) continue;
    const supporting = supportingPassageIds(claim.text, claim.passageIds, owned);
    if (!supporting.length) continue;
    selected.push({ text: claim.text.trim(), citationPassageIds: supporting });
  }

  if (!selected.length) {
    return {
      version: EXPLAIN_FROM_EXISTING_EVIDENCE_VERSION,
      answer: EXPLAIN_EVIDENCE_INCOMPLETE,
      citationPassageIds: [],
      evidenceComplete: false,
    };
  }

  const citationPassageIds: string[] = [];
  const seenCite = new Set<string>();
  for (const item of selected) {
    for (const id of item.citationPassageIds) {
      if (seenCite.has(id)) continue;
      seenCite.add(id);
      citationPassageIds.push(id);
    }
  }

  // Related grounded statements stay inspectable, but `evidenceComplete` is true
  // only when every requested explanation obligation is actually covered.
  const evidenceComplete = obligations.every((obligation) =>
    selected.some((item) => statementSatisfies(item.text, obligation)),
  );

  return {
    version: EXPLAIN_FROM_EXISTING_EVIDENCE_VERSION,
    answer: selected.map((item) => item.text).join("\n"),
    citationPassageIds,
    evidenceComplete,
  };
}

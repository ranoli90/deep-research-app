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
  const tokens = new Set(tokenize(text).map((t) => t.replace(/s$/u, "")));
  return focus.some((term) => tokens.has(term.replace(/s$/u, "")));
}

function usableExplanationText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || isReportSectionLabel(trimmed)) return false;
  return !sourceLooksLikeInjection(trimmed) && sourceCannotEscalatePrivilege(trimmed) === null;
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
  const focus = focusTerms(input.message);
  const owned = new Map(input.passages.map((p) => [p.id, p]));
  const claimsById = new Map(input.claims.map((c) => [c.id, c]));
  const selected: { text: string; citationPassageIds: string[] }[] = [];
  const usedClaims = new Set<string>();

  for (const block of input.blocks) {
    if (!usableExplanationText(block.text)) continue;
    const mapped = block.claimIds.map((id) => claimsById.get(id)).filter((c): c is ExplainEvidenceClaim => Boolean(c));
    const relevant = relevantToFocus(block.text, focus) || mapped.some((c) => relevantToFocus(c.text, focus));
    if (!relevant) continue;
    const candidateIds = [...block.citationIds, ...mapped.flatMap((c) => c.passageIds)];
    const supporting = supportingPassageIds(block.text, candidateIds, owned);
    if (!supporting.length) continue;
    selected.push({ text: block.text.trim(), citationPassageIds: supporting });
    for (const claim of mapped) usedClaims.add(claim.id);
  }

  for (const claim of input.claims) {
    if (usedClaims.has(claim.id) || !usableExplanationText(claim.text) || !relevantToFocus(claim.text, focus)) continue;
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

  return {
    version: EXPLAIN_FROM_EXISTING_EVIDENCE_VERSION,
    answer: selected.map((item) => item.text).join("\n"),
    citationPassageIds,
    evidenceComplete: true,
  };
}

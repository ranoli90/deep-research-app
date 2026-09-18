import type { SourceClass } from "./source-strategy.js";
import { planSourceClass } from "./source-strategy.js";

export const EVIDENCE_NEEDS_VERSION = "evidence-needs.v1";

export type EvidenceNeedState = "missing" | "partial" | "satisfied" | "blocked" | "challenged";

export type EvidenceNeedAction =
  | { kind: "search"; sourceClass: SourceClass; queryHint: string; value: number }
  | { kind: "fetch"; reason: string; value: number }
  | { kind: "challenge"; target: string; value: number }
  | { kind: "stop"; reason: string; value: 0 };

export type EvidenceNeed = {
  id: string;
  version: typeof EVIDENCE_NEEDS_VERSION;
  criterionKey: string | null;
  question: string;
  wouldEstablish: string;
  preferredSourceClasses: SourceClass[];
  weakSubstitutes: SourceClass[];
  freshnessRequired: boolean;
  disconfirming: string;
  candidateScope: string | null;
  state: EvidenceNeedState;
  nextAction: EvidenceNeedAction;
  stopReason: string | null;
};

export function buildEvidenceNeeds(args: {
  originalQuestion: string;
  criterionKeys: string[];
  unresolvedCriterionKeys: string[];
  remainingBudgetMicro: number;
  nextCostMicro: number;
}): EvidenceNeed[] {
  const plan = planSourceClass(args.originalQuestion);
  const keys = args.criterionKeys.length ? args.criterionKeys : ["objective"];
  return keys.map((key) => {
    const unresolved = args.unresolvedCriterionKeys.includes(key) || key === "objective";
    const budgetBlocks = args.nextCostMicro > args.remainingBudgetMicro;
    const nextAction: EvidenceNeedAction = !unresolved
      ? { kind: "stop", reason: "need_satisfied", value: 0 }
      : budgetBlocks
        ? { kind: "stop", reason: "finishing_reserve", value: 0 }
        : { kind: "search", sourceClass: plan.primary, queryHint: args.originalQuestion, value: 80 };
    return {
      id: `need-${key}`,
      version: EVIDENCE_NEEDS_VERSION,
      criterionKey: key === "objective" ? null : key,
      question: args.originalQuestion,
      wouldEstablish: unresolved ? `Evidence that can settle ${key}` : `Already inspected for ${key}`,
      preferredSourceClasses: [plan.primary, ...plan.fallbacks],
      weakSubstitutes: ["community", "generic-web"],
      freshnessRequired: /\b(current|latest|today|price|now)\b/i.test(args.originalQuestion),
      disconfirming: `A primary source that contradicts the working answer for ${key}`,
      candidateScope: null,
      state: unresolved ? "missing" : "satisfied",
      nextAction,
      stopReason: nextAction.kind === "stop" ? nextAction.reason : null,
    };
  });
}

/** Highest-value unfinished need; never “coverage incomplete → another query” by itself. */
export function highestValueNeed(needs: EvidenceNeed[]): EvidenceNeed | null {
  const open = needs.filter((n) => n.nextAction.kind !== "stop");
  if (!open.length) return null;
  return [...open].sort((a, b) => b.nextAction.value - a.nextAction.value)[0] ?? null;
}

export type FalsificationState = {
  conclusionKey: string;
  wouldFalsify: string;
  likelySourceClass: SourceClass;
  challenged: boolean;
  changedConclusion: boolean | null;
};

export function falsificationForConclusion(args: {
  conclusionKey: string;
  conclusionText: string;
  originalQuestion: string;
}): FalsificationState {
  const plan = planSourceClass(args.originalQuestion);
  return {
    conclusionKey: args.conclusionKey,
    wouldFalsify: `Primary evidence that ${args.conclusionText.slice(0, 160)} is false, inapplicable, or outdated`,
    likelySourceClass: plan.primary,
    challenged: false,
    changedConclusion: null,
  };
}

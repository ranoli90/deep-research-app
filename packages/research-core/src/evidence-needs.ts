import type { ResearchModelOutput } from "@deep/contracts";
import type { SourceClass } from "./source-strategy.js";
import { planSourceClass } from "./source-strategy.js";
import { tightenCriterionSpan } from "./discovery-planning.js";

export const EVIDENCE_NEEDS_VERSION = "evidence-needs.v1";
export const CONCLUSION_CHALLENGE_VERSION = "conclusion-challenge.v1";

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

export type EvidenceNeedSignal = { criterionKey: string; freshnessUnmet: boolean; affectedCandidates: number; sourceQuality: "primary" | "secondary" | "weak" | "unknown"; nextCostMicro: number };

type BriefCriterion = ResearchModelOutput<"brief">["criteria"][number];

function queryHintFor(question: string, key: string, criteria: BriefCriterion[] | undefined): string {
  const criterion = criteria?.find((c) => c.key === key);
  if (!criterion) return question;
  const tight = tightenCriterionSpan(question, criterion);
  if (tight?.quote && tight.quote.trim() !== question.trim()) return tight.quote.trim();
  const quote = criterion.provenance?.quote?.trim();
  if (quote && quote !== question.trim()) return quote;
  return question;
}

export function buildEvidenceNeeds(args: {
  originalQuestion: string;
  criterionKeys: string[];
  unresolvedCriterionKeys: string[];
  remainingBudgetMicro: number;
  nextCostMicro: number;
  criteria?: BriefCriterion[];
  criterionSignals?: EvidenceNeedSignal[];
}): EvidenceNeed[] {
  const plan = planSourceClass(args.originalQuestion);
  const keys = args.criterionKeys.length ? args.criterionKeys : ["objective"];
  return keys.map((key) => {
    const unresolved = args.unresolvedCriterionKeys.includes(key) || key === "objective";
    const signal=args.criterionSignals?.find(s=>s.criterionKey===key);
    const criterion=args.criteria?.find(c=>c.key===key);
    const cost=signal?.nextCostMicro??args.nextCostMicro;
    const budgetBlocks = !Number.isSafeInteger(cost)||cost<0||cost > args.remainingBudgetMicro;
    const consequence=criterion?.importance==="hard"?60:30;
    const freshness=signal?.freshnessUnmet?25:0;
    const candidateImpact=Math.min(20,Math.max(0,signal?.affectedCandidates??0)*5);
    const qualityGap=signal?.sourceQuality==="primary"?0:signal?.sourceQuality==="secondary"?8:15;
    const value=Math.max(1,Math.round((consequence+freshness+candidateImpact+qualityGap)/(1+cost/Math.max(1,args.remainingBudgetMicro))));
    const hint = queryHintFor(args.originalQuestion, key, args.criteria);
    const nextAction: EvidenceNeedAction = !unresolved
      ? { kind: "stop", reason: "need_satisfied", value: 0 }
      : budgetBlocks
        ? { kind: "stop", reason: "finishing_reserve", value: 0 }
        : { kind: "search", sourceClass: plan.primary, queryHint: hint, value };
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

/** Keep durable query hints; update only the need whose criterion evidence changed. */
export function applyNeedEvidence(needs: EvidenceNeed[], criterionKey: string, settled: boolean): EvidenceNeed[] {
  return needs.map((n) => {
    if (n.criterionKey !== criterionKey && n.id !== `need-${criterionKey}`) return n;
    if (!settled) {
      return { ...n, state: n.state === "satisfied" ? "satisfied" : "partial" };
    }
    return {
      ...n,
      state: "satisfied",
      nextAction: { kind: "stop", reason: "need_satisfied", value: 0 },
      stopReason: "need_satisfied",
      wouldEstablish: `Already inspected for ${criterionKey}`,
    };
  });
}

export function updateNeedsFromCoverage(needs: EvidenceNeed[], args: {
  originalQuestion: string;
  criterionKeys: string[];
  unresolvedCriterionKeys: string[];
  remainingBudgetMicro: number;
  nextCostMicro: number;
  criteria?: BriefCriterion[];
  criterionSignals?: EvidenceNeedSignal[];
}): EvidenceNeed[] {
  const rebuilt = buildEvidenceNeeds(args);
  const prior = new Map(needs.map((n) => [n.id, n]));
  return rebuilt.map((next) => {
    const prev = prior.get(next.id);
    if (!prev) return next;
    if (next.nextAction.kind === "stop") {
      return { ...prev, state: next.state, nextAction: next.nextAction, stopReason: next.stopReason, wouldEstablish: next.wouldEstablish };
    }
    if (prev.nextAction.kind === "search" && next.nextAction.kind === "search") {
      return {
        ...prev,
        state: next.state,
        nextAction: { ...prev.nextAction, sourceClass: next.nextAction.sourceClass, value: next.nextAction.value },
        stopReason: null,
      };
    }
    return { ...prev, state: next.state, nextAction: next.nextAction, stopReason: next.stopReason };
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

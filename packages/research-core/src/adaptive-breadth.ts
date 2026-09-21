import { DEEP_DISCOVERY_CEILING, MAX_DISCOVERY_QUERIES } from "./discovery-planning.js";
import { isSimpleHistoricalLookup, type FreshnessCriterionInput, type FreshnessPolicy, type FreshnessPolicyVersion } from "./freshness.js";
import { independentConfirmationCount } from "./independence.js";
import type { StoredSource } from "./types.js";
import type { SourceClass } from "./source-strategy.js";

export const ADAPTIVE_BREADTH_VERSION = "evidence-value-breadth.v1";
export const DISCOVERY_HARD_CEILING = DEEP_DISCOVERY_CEILING;
export const SIMPLE_DISCOVERY_CEILING = MAX_DISCOVERY_QUERIES;
/** Two independent readable pages are enough to stop extra fetches on a past-tense public fact. */
export const HISTORICAL_FACT_READABLE_CONFIRMATIONS = 2;

const READABLE_ACCESS = new Set(["full-text", "partial-text"]);

/** Snippet hits stay queued. Cap/drain apply only to a simple historical lookup; mixed work keeps reading. */
export function furtherHistoricalSourceReadsNeeded(args: {
  question: string;
  sources: ReadonlyArray<StoredSource>;
  criteria?: ReadonlyArray<FreshnessCriterionInput>;
  policyVersion?: FreshnessPolicyVersion;
  restoredPolicy?: FreshnessPolicy;
  historicalLookupSatisfied?: boolean;
  readPhase?: "cap" | "drain";
}): boolean {
  if (!isSimpleHistoricalLookup({
    question: args.question,
    criteria: args.criteria,
    policyVersion: args.policyVersion,
    restoredPolicy: args.restoredPolicy,
  })) return true;
  if (args.historicalLookupSatisfied) return false;
  if ((args.readPhase ?? "cap") === "drain") return true;
  const readable = args.sources.filter((s) => READABLE_ACCESS.has(s.accessLevel));
  return independentConfirmationCount(readable) < HISTORICAL_FACT_READABLE_CONFIRMATIONS;
}

export type SearchCoverage = {
  version: typeof ADAPTIVE_BREADTH_VERSION;
  queriesAttempted: string[];
  sourceClassesAttempted: SourceClass[];
  blockedOrInaccessible: string[];
  unresolvedAbsence: string[];
  notFoundMeansNonexistence: false;
  freshnessUnmet?: boolean;
  unresolvedFreshnessCriteria?: string[];
};

export type BreadthDecision = {
  continue: boolean;
  reason: string;
  stopPolicy: string;
  coverage: SearchCoverage;
};

export function recordSearchCoverage(args: {
  queriesAttempted?: string[];
  sourceClassesAttempted?: SourceClass[];
  blockedOrInaccessible?: string[];
  unresolvedAbsence?: string[];
  freshnessUnmet?: boolean;
  unresolvedFreshnessCriteria?: string[];
}): SearchCoverage {
  return {
    version: ADAPTIVE_BREADTH_VERSION,
    queriesAttempted: args.queriesAttempted ?? [],
    sourceClassesAttempted: args.sourceClassesAttempted ?? [],
    blockedOrInaccessible: args.blockedOrInaccessible ?? [],
    unresolvedAbsence: args.unresolvedAbsence ?? [],
    notFoundMeansNonexistence: false,
    ...(args.freshnessUnmet ? { freshnessUnmet: true, unresolvedFreshnessCriteria: args.unresolvedFreshnessCriteria ?? [] } : {}),
  };
}

/**
 * Continue only while an unresolved consequential criterion can change the answer
 * and a distinct strategy remains. Hard ceilings stay. Absence is coverage, not nonexistence.
 */
export function evaluateDiscoveryContinuation(args: {
  unresolvedConsequential: boolean;
  distinctStrategyRemains: boolean;
  sources: StoredSource[];
  novelty: number;
  expectedInformationGain: "high" | "low" | "none";
  remainingBudgetMicro: number;
  nextCostMicro: number;
  freshnessUnmet: boolean;
  priorFailedQueries: number;
  queriesIssued: number;
  hardCeiling?: number;
  blockedOrInaccessible?: string[];
  sourceClassesAttempted?: SourceClass[];
  queriesAttempted?: string[];
  unresolvedAbsence?: string[];
}): BreadthDecision {
  const ceiling = args.hardCeiling ?? (args.unresolvedConsequential && args.distinctStrategyRemains
    ? DISCOVERY_HARD_CEILING
    : SIMPLE_DISCOVERY_CEILING);
  const coverage = recordSearchCoverage({
    queriesAttempted: args.queriesAttempted,
    sourceClassesAttempted: args.sourceClassesAttempted,
    blockedOrInaccessible: args.blockedOrInaccessible,
    unresolvedAbsence: args.unresolvedAbsence ?? (args.unresolvedConsequential ? ["consequential_criterion_unresolved"] : []),
  });
  const independent = independentConfirmationCount(args.sources);
  if (args.queriesIssued >= ceiling) {
    return { continue: false, reason: "hard_discovery_ceiling", stopPolicy: "safety_cap", coverage };
  }
  if (args.nextCostMicro > args.remainingBudgetMicro) {
    return { continue: false, reason: "budget_requires_finishing", stopPolicy: "budget_respected", coverage };
  }
  if (!args.unresolvedConsequential) {
    return { continue: false, reason: "simple_or_resolved_question", stopPolicy: "evidence_sufficient_or_low_decision_value", coverage };
  }
  if (!args.distinctStrategyRemains) {
    return { continue: false, reason: "no_distinct_source_strategy", stopPolicy: "low_decision_value", coverage };
  }
  if (args.expectedInformationGain === "none" && !args.freshnessUnmet) {
    return { continue: false, reason: "low_expected_information_gain", stopPolicy: "low_decision_value", coverage };
  }
  if (args.novelty <= 0 && independent > 0 && args.priorFailedQueries >= 1 && !args.freshnessUnmet) {
    return { continue: false, reason: "saturated_independent_evidence", stopPolicy: "low_decision_value", coverage };
  }
  return {
    continue: true,
    reason: args.freshnessUnmet ? "freshness_unmet_continue" : "unresolved_consequential_with_distinct_strategy",
    stopPolicy: "continue",
    coverage,
  };
}

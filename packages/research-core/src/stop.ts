import { canSpendExploration } from "./fences.js";
import { FIXTURE_SYNTH_COST_MICRO } from "@deep/contracts";
import { detectGaps } from "./gaps.js";
import { saturationReached } from "./policy.js";
import { unresolvedContradictions } from "./contradictions.js";
import { disconfirmationCompleted } from "./disconfirm.js";
import type { ControllerState, Gap } from "./types.js";

export type StopDecision = {
  shouldStop: boolean;
  reason: string;
  stopPolicy: string;
  synthesize: boolean;
};

function blockingOpen(gaps: Gap[]): Gap | undefined {
  return gaps.find((g) => g.importance === "blocking" && g.latestOutcome !== "resolved" && g.resolution !== "resolved");
}

function gapUnresolvable(gap: Gap): boolean {
  const attempts = gap.attempts ?? [];
  if (gap.latestOutcome === "inaccessible" || gap.latestOutcome === "blocked") return true;
  if (attempts.length >= 2 && attempts.every((a) => a.outcome === "no_progress" || a.outcome === "blocked")) return true;
  return false;
}

/**
 * Evidence-aware stop. Search-count is a safety cap, not the justification.
 */
export function evaluateStop(state: ControllerState): StopDecision {
  if (state.ablations?.disableEvidenceAwareStop) {
    if (saturationReached(state.searches) || state.searches.length >= 5) {
      return { shouldStop: true, reason: "ablation_search_quota", stopPolicy: "search_count", synthesize: true };
    }
  }

  const gaps = state.gaps.length ? state.gaps : detectGaps(state);
  const blocking = blockingOpen(gaps);
  const budgetExhausted = !canSpendExploration({
    totalBudgetMicro: state.budgetMicro,
    spentPlusReservedMicro: state.spentMicro,
    actionCostMicro: 5_000,
    isFinishingAction: false,
    finishingCostMicro: FIXTURE_SYNTH_COST_MICRO,
  });

  if (state.searches.length >= 8) {
    return {
      shouldStop: true,
      reason: blocking
        ? `safety_cap_with_unresolved_gap:${blocking.missingFact}`
        : "safety_cap_low_remaining_value",
      stopPolicy: blocking ? "inaccessible_or_unresolved_gap" : "low_decision_value",
      synthesize: true,
    };
  }

  if (budgetExhausted) {
    return {
      shouldStop: true,
      reason: "budget_requires_finishing",
      stopPolicy: "budget_respected",
      synthesize: true,
    };
  }

  if (saturationReached(state.searches)) {
    return {
      shouldStop: true,
      reason: "Repeated searches returned no novel source family or coverage progress",
      stopPolicy: "low_decision_value",
      synthesize: false,
    };
  }

  if (blocking && !gapUnresolvable(blocking)) {
    return { shouldStop: false, reason: "blocking_gap_open", stopPolicy: "continue", synthesize: false };
  }

  const unresolved = unresolvedContradictions(state);
  const verifyDone = (state.completedActionTypes ?? []).includes("verify");
  if (unresolved.length > 0 && !verifyDone && !state.ablations?.disableContradictionHandling) {
    return { shouldStop: false, reason: "contradiction_unhandled", stopPolicy: "continue", synthesize: false };
  }

  if (
    state.passages.length > 0 &&
    !disconfirmationCompleted(state) &&
    !state.ablations?.disableDisconfirmation &&
    (blocking === undefined || gapUnresolvable(blocking))
  ) {
    return { shouldStop: false, reason: "disconfirm_pending", stopPolicy: "continue", synthesize: false };
  }

  const reason = blocking
    ? `inaccessible_or_unresolved_gap:${blocking.missingFact}`
    : "decision_critical_gaps_resolved_or_unresolvable; high-impact claims supported or qualified; contradictions handled; remaining actions low expected value";
  return {
    shouldStop: true,
    reason,
    stopPolicy: blocking ? "inaccessible_or_unresolved_gap" : "evidence_sufficient_or_low_decision_value",
    synthesize: true,
  };
}

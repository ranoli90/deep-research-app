import {
  FIXTURE_FETCH_COST_MICRO,
  FIXTURE_SEARCH_COST_MICRO,
  FIXTURE_SYNTH_COST_MICRO,
} from "@deep/contracts";
import { neededClarifications } from "./brief.js";
import { detectContradictions, unresolvedContradictions } from "./contradictions.js";
import { disconfirmationCompleted, evaluateDisconfirmation, planDisconfirmation } from "./disconfirm.js";
import { canSpendExploration } from "./fences.js";
import { detectGaps, triedSourceType } from "./gaps.js";
import { isWeakSourceClass, PRIMARY_SOURCE_TYPES } from "./independence.js";
import { queryLeaksPrivate } from "./injection.js";
import { refreshDerived } from "./loop.js";
import { queryWithGeography, saturationReached } from "./policy.js";
import { deriveResearchQuestions } from "./questions.js";
import { evaluateStop } from "./stop.js";
import type { ControllerState, Gap, PolicyDecision, StoredSource } from "./types.js";

function base(state: ControllerState): Omit<PolicyDecision, "type" | "rationale"> {
  const actionId = `act-${state.basis.evidenceRevision + 1}`;
  return {
    actionId,
    runId: state.runId,
    briefRevision: state.brief.revision,
    coverageIds: [],
    arguments: {},
    estimatedMaxCostMicro: 0,
    sourceAccessConstraints: [],
    dedupeKey: actionId,
    privileged: false,
  };
}

function withReason(decision: PolicyDecision, selectionReason: string, extra?: Record<string, unknown>): PolicyDecision {
  return {
    ...decision,
    arguments: { ...decision.arguments, selectionReason, ...extra },
  };
}

function canPay(state: ControllerState, cost: number, finishing: boolean): boolean {
  return canSpendExploration({
    totalBudgetMicro: state.budgetMicro,
    spentPlusReservedMicro: state.spentMicro,
    actionCostMicro: cost,
    isFinishingAction: finishing,
    finishingCostMicro: FIXTURE_SYNTH_COST_MICRO,
  });
}

function leakOrSearch(state: ControllerState, query: string, decision: PolicyDecision): PolicyDecision {
  const leak = queryLeaksPrivate(query, state.privateCanaries);
  if (leak) {
    return {
      ...base(state),
      type: "stop",
      rationale: "private text cannot enter a public query",
      arguments: { reason: "private_query_blocked", selectionReason: "private_query_blocked" },
    };
  }
  return { ...decision, arguments: { ...decision.arguments, query } };
}

function blockingGap(gaps: Gap[]): Gap | undefined {
  return gaps.find((g) => g.importance === "blocking" && g.latestOutcome !== "resolved" && g.resolution !== "resolved");
}

function preferredUnfetched(state: ControllerState, needed?: string): StoredSource | undefined {
  const unfetched = state.sources.filter((s) => s.accessLevel === "discovered" || s.accessLevel === "snippet");
  if (needed) {
    const hit = unfetched.find((s) => s.sourceType === needed || PRIMARY_SOURCE_TYPES.has(s.sourceType ?? ""));
    if (hit) return hit;
  }
  return unfetched[0];
}

/**
 * Evidence-adaptive action selection. Next action depends on observed gaps,
 * source class, contradictions, and remaining value — not a fixed sequence
 * and not a scenario id.
 */
export function selectAdaptiveAction(state: ControllerState): PolicyDecision {
  refreshDerived(state);
  if (!state.questions?.length) state.questions = deriveResearchQuestions(state);
  state.contradictions = detectContradictions(state);
  state.gaps = detectGaps(state);

  const b = base(state);
  if (state.deleted) {
    return { ...b, type: "stop", rationale: "account or content deleted", arguments: { reason: "deleted", selectionReason: "deleted" } };
  }

  const clar = neededClarifications(state.brief);
  if (clar.length > 0 && state.phase === "preparing") {
    return withReason(
      { ...b, type: "clarify", rationale: "A blocking field is unspecified and would change the answer", arguments: { questions: clar } },
      "blocking_clarification",
    );
  }

  const gaps = state.gaps;
  const blocking = blockingGap(gaps);
  const neededType = blocking?.sourceTypeNeeded;
  const unfetchedPreferred = preferredUnfetched(state, neededType);

  if (unfetchedPreferred && neededType && (unfetchedPreferred.sourceType === neededType || PRIMARY_SOURCE_TYPES.has(unfetchedPreferred.sourceType ?? ""))) {
    if (!canPay(state, FIXTURE_FETCH_COST_MICRO, false)) {
      return withReason(
        { ...b, type: "synthesize", rationale: "budget requires finishing with available evidence", estimatedMaxCostMicro: FIXTURE_SYNTH_COST_MICRO },
        "budget_requires_finishing",
        { stopPolicy: "budget_respected" },
      );
    }
    return withReason(
      {
        ...b,
        type: "fetch",
        rationale: `Inspect the preferred source type (${unfetchedPreferred.sourceType ?? neededType}) before more weak sources`,
        arguments: { locator: unfetchedPreferred.locator, sourceId: unfetchedPreferred.id },
        estimatedMaxCostMicro: FIXTURE_FETCH_COST_MICRO,
        dedupeKey: `fetch:${unfetchedPreferred.locator}`,
        gapId: blocking?.id,
      },
      "inspect_preferred_source_before_generic_query",
    );
  }

  if (
    blocking &&
    neededType &&
    !triedSourceType(state, neededType) &&
    !state.ablations?.disableSourcePivot &&
    blocking.suggestedQuery &&
    state.searches.length < 8 &&
    state.sources.length > 0
  ) {
    const q = queryWithGeography(state, blocking.suggestedQuery);
    return leakOrSearch(
      state,
      q,
      withReason(
        {
          ...b,
          type: "search",
          rationale: `Decision-blocking gap: ${blocking.missingFact}. Switching source type to ${neededType}.`,
          arguments: {
            pivot: true,
            trigger: blocking.id,
            sourceTypeNeeded: neededType,
            pivotReason: `source class produced weak/duplicate/stale evidence; need ${neededType}`,
          },
          estimatedMaxCostMicro: FIXTURE_SEARCH_COST_MICRO,
          gapId: blocking.id,
          dedupeKey: `search:gap:${blocking.id}:${state.searches.length}`,
        },
        "blocking_gap_source_pivot",
        {
          pivot: true,
          trigger: blocking.id,
          sourceTypeNeeded: neededType,
          pivotReason: `source class produced weak/duplicate/stale evidence; need ${neededType}`,
        },
      ),
    );
  }

  const unfetched = state.sources.filter((s) => s.accessLevel === "discovered" || s.accessLevel === "snippet");
  const unfetchedAllWeak = unfetched.length > 0 && unfetched.every((s) => isWeakSourceClass(s) || WEAKISH(s));
  if (
    unfetchedAllWeak &&
    blocking &&
    neededType &&
    !triedSourceType(state, neededType) &&
    !state.ablations?.disableSourcePivot
  ) {
    const q = queryWithGeography(state, blocking.suggestedQuery ?? `${state.brief.originalQuestion} ${neededType}`);
    return leakOrSearch(
      state,
      q,
      withReason(
        {
          ...b,
          type: "search",
          rationale: `Remaining unfetched sources are the same weak class; pivoting to ${neededType}`,
          arguments: { pivot: true, trigger: blocking.id, sourceTypeNeeded: neededType },
          estimatedMaxCostMicro: FIXTURE_SEARCH_COST_MICRO,
          gapId: blocking.id,
          dedupeKey: `search:gap:${blocking.id}:${state.searches.length}`,
        },
        "skip_more_weak_fetches_pivot",
        {
          pivot: true,
          trigger: blocking.id,
          sourceTypeNeeded: neededType,
          pivotReason: `repeated weak source class; need ${neededType}`,
        },
      ),
    );
  }

  if (unfetched[0]) {
    if (!canPay(state, FIXTURE_FETCH_COST_MICRO, false)) {
      return withReason(
        { ...b, type: "synthesize", rationale: "budget requires finishing with available evidence", estimatedMaxCostMicro: FIXTURE_SYNTH_COST_MICRO },
        "budget_requires_finishing",
        { stopPolicy: "budget_respected" },
      );
    }
    return withReason(
      {
        ...b,
        type: "fetch",
        rationale: "Inspect an already-known source before another generic query",
        arguments: { locator: unfetched[0].locator, sourceId: unfetched[0].id },
        estimatedMaxCostMicro: FIXTURE_FETCH_COST_MICRO,
        dedupeKey: `fetch:${unfetched[0].locator}`,
      },
      "inspect_known_source",
    );
  }

  const popConstraint = state.constraints.find((c) => c.field === "population");
  if (popConstraint && !state.ablations?.disableSourcePivot) {
    const covered = state.sources.some(
      (s) => s.population && popConstraint.value.includes(s.population.split(" ")[0] ?? "\0"),
    );
    const pediatricish = state.sources.some((s) => (s.population ?? "").includes("child") || (s.population ?? "").includes("pediatric"));
    const wantsChild = /child|pediatric|under/i.test(popConstraint.value);
    if (wantsChild && !pediatricish && !covered && state.searches.length < 8) {
      const q = queryWithGeography(state, `${state.brief.originalQuestion} pediatric children population`);
      return leakOrSearch(
        state,
        q,
        withReason(
          {
            ...b,
            type: "search",
            rationale: "Initial dataset excludes the user's stated population; pivot source type",
            arguments: { pivot: true, trigger: "population-mismatch", sourceTypeNeeded: "population-specific" },
            estimatedMaxCostMicro: FIXTURE_SEARCH_COST_MICRO,
            gapId: "population",
            dedupeKey: `search:population:${state.searches.length}`,
          },
          "population_mismatch_pivot",
          { pivot: true, trigger: "population-mismatch", sourceTypeNeeded: "population-specific" },
        ),
      );
    }
  }

  const unresolved = unresolvedContradictions(state);
  const verifyDone = (state.completedActionTypes ?? []).includes("verify");
  if (unresolved.length > 0 && !verifyDone && !state.ablations?.disableContradictionHandling) {
    const c = unresolved[0]!;
    return withReason(
      {
        ...b,
        type: "verify",
        rationale: `Scope-check contradiction on ${c.dimension} before treating newest as correct`,
        arguments: {
          contradictionId: c.id,
          checks: ["date", "geography", "population", "version", "units"],
          possibleExplanation: c.possibleExplanation,
        },
        gapId: `gap-${c.id}`,
        dedupeKey: `verify:${c.id}`,
      },
      "unresolved_contradiction_requires_verify",
    );
  }

  if (
    state.passages.length > 0 &&
    !disconfirmationCompleted(state) &&
    !state.ablations?.disableDisconfirmation
  ) {
    const planned = planDisconfirmation(state);
    if (planned) {
      const alreadySearched = state.searches.some((s) => s.query === planned.searchStrategy);
      if (!alreadySearched && state.searches.length < 8 && canPay(state, FIXTURE_SEARCH_COST_MICRO, false)) {
        const q = queryWithGeography(state, planned.searchStrategy);
        return leakOrSearch(
          state,
          q,
          withReason(
            {
              ...b,
              type: "challenge",
              rationale: `Disconfirm material conclusion: ${planned.falsificationHypothesis}`,
              arguments: {
                query: q,
                targetConclusion: planned.targetConclusion,
                falsificationHypothesis: planned.falsificationHypothesis,
                disconfirm: true,
              },
              estimatedMaxCostMicro: FIXTURE_SEARCH_COST_MICRO,
              dedupeKey: `challenge:${planned.id}`,
            },
            "material_conclusion_disconfirm",
            { query: q, disconfirm: true, targetConclusion: planned.targetConclusion, falsificationHypothesis: planned.falsificationHypothesis },
          ),
        );
      }
      const evaluated = evaluateDisconfirmation(state, planned);
      return withReason(
        {
          ...b,
          type: "challenge",
          rationale: evaluated.impact,
          arguments: { ...evaluated, recordOnly: true },
          dedupeKey: `challenge-record:${evaluated.id}`,
        },
        "record_disconfirmation_result",
      );
    }
  }

  if (saturationReached(state.searches)) {
    return withReason(
      {
        ...b,
        type: "stop",
        rationale: "Repeated searches returned no novel source family or coverage progress",
        arguments: { reason: "diminishing_returns", stopPolicy: "low_decision_value" },
      },
      "diminishing_returns",
      { reason: "diminishing_returns", stopPolicy: "low_decision_value" },
    );
  }

  const uncovered = state.coverage.find((c) => c.status === "unstarted" || c.status === "investigating");
  const openQuestion = (state.questions ?? []).find((q) => q.status === "open" && q.importance !== "background");
  if ((uncovered || openQuestion) && state.searches.length < 8) {
    const query = queryWithGeography(state, uncovered?.question || openQuestion?.text || state.brief.originalQuestion);
    if (!canPay(state, FIXTURE_SEARCH_COST_MICRO, false)) {
      return withReason(
        {
          ...b,
          type: "synthesize",
          rationale: "reserve remaining budget for verification and writing",
          estimatedMaxCostMicro: FIXTURE_SYNTH_COST_MICRO,
        },
        "reserve_budget_for_writing",
        { stopPolicy: "budget_respected" },
      );
    }
    return leakOrSearch(
      state,
      query,
      withReason(
        {
          ...b,
          type: "search",
          rationale: "Investigate an uncovered required question",
          arguments: { coverageId: uncovered?.id ?? openQuestion?.id },
          estimatedMaxCostMicro: FIXTURE_SEARCH_COST_MICRO,
          coverageIds: uncovered ? [uncovered.id] : [],
          dedupeKey: `search:${uncovered?.id ?? openQuestion?.id}:${state.searches.length}`,
        },
        "uncovered_research_question",
        { coverageId: uncovered?.id ?? openQuestion?.id },
      ),
    );
  }

  const stop = evaluateStop(state);
  if (stop.shouldStop) {
    return withReason(
      {
        ...b,
        type: stop.synthesize ? "synthesize" : "stop",
        rationale: stop.reason,
        estimatedMaxCostMicro: stop.synthesize ? FIXTURE_SYNTH_COST_MICRO : 0,
        arguments: { reason: stop.stopPolicy, stopPolicy: stop.stopPolicy },
        dedupeKey: `finish:${stop.stopPolicy}:${state.basis.evidenceRevision}`,
      },
      stop.reason,
      { reason: stop.stopPolicy, stopPolicy: stop.stopPolicy },
    );
  }

  const blockingOpen = blocking;
  const stopReason = blockingOpen ? "inaccessible_or_unresolved_gap" : "evidence_sufficient_or_low_decision_value";
  return withReason(
    {
      ...b,
      type: "synthesize",
      rationale: blockingOpen
        ? `Write with localized uncertainty; blocking gap remains: ${blockingOpen.missingFact}`
        : "Authorized investigation has diminishing expected value; write from stored evidence",
      estimatedMaxCostMicro: FIXTURE_SYNTH_COST_MICRO,
      arguments: { reason: stopReason, stopPolicy: stopReason },
      dedupeKey: `finish:${stopReason}:${state.basis.evidenceRevision}`,
    },
    stopReason,
    { reason: stopReason, stopPolicy: stopReason },
  );
}

function WEAKISH(s: StoredSource): boolean {
  return WEAK_SOURCE_TYPES_LOCAL.has(s.sourceType ?? "") || isWeakSourceClass(s);
}

const WEAK_SOURCE_TYPES_LOCAL = new Set(["review-summary", "blog", "wire", "marketing", "aggregator", "community"]);

/** Back-compat name used by fixture adapter and tests. */
export function selectNextAction(state: ControllerState): PolicyDecision {
  return selectAdaptiveAction(state);
}

import {
  FIXTURE_FETCH_COST_MICRO,
  FIXTURE_SEARCH_COST_MICRO,
  FIXTURE_SYNTH_COST_MICRO,
} from "@deep/contracts";
import { neededClarifications } from "./brief.js";
import { canSpendExploration } from "./fences.js";
import { detectGaps, triedSourceType } from "./gaps.js";
import { queryLeaksPrivate } from "./injection.js";
import type { ControllerState, PolicyDecision, SearchTrace } from "./types.js";

export function saturationReached(searches: SearchTrace[]): boolean {
  if (searches.length < 2) return false;
  const last = searches.slice(-2);
  return last.every((s) => s.newFamilies === 0 && !s.coverageProgress);
}

/** Confirmed geography must appear in the public query so discovery cannot silently reuse another country's fixture. */
export function queryWithGeography(state: ControllerState, query: string): string {
  const geo = state.constraints.find((c) => c.field === "geography");
  const value = geo ? String(geo.value).trim() : "";
  if (!value) return query;
  if (query.toLowerCase().includes(value.toLowerCase())) return query;
  return `${query} ${value}`;
}

export function independentClusterCount(sources: { originCluster?: string; id: string }[]): number {
  const clusters = new Set<string>();
  for (const s of sources) {
    clusters.add(s.originCluster ?? `independent:${s.id}`);
  }
  return clusters.size;
}

export function selectNextAction(state: ControllerState): PolicyDecision {
  const actionId = `act-${state.basis.evidenceRevision + 1}`;
  const base = {
    actionId,
    runId: state.runId,
    briefRevision: state.brief.revision,
    coverageIds: [] as string[],
    arguments: {} as Record<string, unknown>,
    estimatedMaxCostMicro: 0,
    sourceAccessConstraints: [] as string[],
    dedupeKey: actionId,
    privileged: false,
  };

  if (state.deleted) {
    return { ...base, type: "stop", rationale: "account or content deleted", arguments: { reason: "deleted" } };
  }

  const clar = neededClarifications(state.brief);
  if (clar.length > 0 && state.phase === "preparing") {
    return {
      ...base,
      type: "clarify",
      rationale: "A blocking field is unspecified and would change the answer",
      arguments: { questions: clar },
    };
  }

  const unfetched = state.sources.filter(
    (s) => s.accessLevel === "discovered" || s.accessLevel === "snippet",
  );
  if (unfetched[0]) {
    const cost = FIXTURE_FETCH_COST_MICRO;
    if (
      !canSpendExploration({
        totalBudgetMicro: state.budgetMicro,
        spentPlusReservedMicro: state.spentMicro,
        actionCostMicro: cost,
        isFinishingAction: false,
        finishingCostMicro: FIXTURE_SYNTH_COST_MICRO,
      })
    ) {
      return { ...base, type: "synthesize", rationale: "budget requires finishing with available evidence", estimatedMaxCostMicro: FIXTURE_SYNTH_COST_MICRO };
    }
    return {
      ...base,
      type: "fetch",
      rationale: "Inspect an already-known source before another generic query",
      arguments: { locator: unfetched[0].locator, sourceId: unfetched[0].id },
      estimatedMaxCostMicro: cost,
      dedupeKey: `fetch:${unfetched[0].locator}`,
    };
  }

  const gaps = detectGaps(state);
  const blockingGap = gaps.find((g) => g.importance === "blocking" && g.suggestedQuery);
  if (blockingGap && blockingGap.sourceTypeNeeded && !triedSourceType(state, blockingGap.sourceTypeNeeded) && state.searches.length < 5) {
    const q = queryWithGeography(state, blockingGap.suggestedQuery!);
    const leak = queryLeaksPrivate(q, state.privateCanaries);
    if (leak) {
      return { ...base, type: "stop", rationale: "private text cannot enter a public query", arguments: { reason: "private_query_blocked" } };
    }
    return {
      ...base,
      type: "search",
      rationale: `Decision-blocking gap: ${blockingGap.missingFact}. Switching source type to ${blockingGap.sourceTypeNeeded}.`,
      arguments: { query: q, pivot: true, trigger: blockingGap.id, sourceTypeNeeded: blockingGap.sourceTypeNeeded },
      estimatedMaxCostMicro: FIXTURE_SEARCH_COST_MICRO,
      gapId: blockingGap.id,
      dedupeKey: `search:gap:${blockingGap.id}:${state.searches.length}`,
    };
  }

  const popConstraint = state.constraints.find((c) => c.field === "population");
  if (popConstraint) {
    const covered = state.sources.some(
      (s) => s.population && popConstraint.value.includes(s.population.split(" ")[0] ?? "\0"),
    );
    const pediatricish = state.sources.some((s) => (s.population ?? "").includes("child") || (s.population ?? "").includes("pediatric"));
    const wantsChild = /child|pediatric|under/i.test(popConstraint.value);
    if (wantsChild && !pediatricish && !covered && state.searches.length < 4) {
      const q = queryWithGeography(state, `${state.brief.originalQuestion} pediatric children population`);
      const leak = queryLeaksPrivate(q, state.privateCanaries);
      if (leak) {
        return { ...base, type: "stop", rationale: "private text cannot enter a public query", arguments: { reason: "private_query_blocked" } };
      }
      return {
        ...base,
        type: "search",
        rationale: "Initial dataset excludes the user's stated population; pivot source type",
        arguments: { query: q, pivot: true, trigger: "population-mismatch" },
        estimatedMaxCostMicro: FIXTURE_SEARCH_COST_MICRO,
        gapId: "population",
        dedupeKey: `search:population:${state.searches.length}`,
      };
    }
  }

  if (saturationReached(state.searches)) {
    return {
      ...base,
      type: "stop",
      rationale: "Repeated searches returned no novel source family or coverage progress",
      arguments: { reason: "diminishing_returns", stopPolicy: "low_decision_value" },
    };
  }

  const uncovered = state.coverage.find((c) => c.status === "unstarted" || c.status === "investigating");
  if (uncovered && state.searches.length < 5) {
    const query = queryWithGeography(state, uncovered.question || state.brief.originalQuestion);
    const leak = queryLeaksPrivate(query, state.privateCanaries);
    if (leak) {
      return {
        ...base,
        type: "stop",
        rationale: "private attachment text cannot be copied into a public search query",
        arguments: { reason: "private_query_blocked", canary: leak },
      };
    }
    const cost = FIXTURE_SEARCH_COST_MICRO;
    if (
      !canSpendExploration({
        totalBudgetMicro: state.budgetMicro,
        spentPlusReservedMicro: state.spentMicro,
        actionCostMicro: cost,
        isFinishingAction: false,
        finishingCostMicro: FIXTURE_SYNTH_COST_MICRO,
      })
    ) {
      return {
        ...base,
        type: "synthesize",
        rationale: "reserve remaining budget for verification and writing",
        estimatedMaxCostMicro: FIXTURE_SYNTH_COST_MICRO,
      };
    }
    return {
      ...base,
      type: "search",
      rationale: "Investigate an uncovered required question",
      arguments: { query, coverageId: uncovered.id },
      estimatedMaxCostMicro: cost,
      coverageIds: [uncovered.id],
      dedupeKey: `search:${uncovered.id}:${state.searches.length}`,
    };
  }

  const blockingOpen = gaps.find((g) => g.importance === "blocking");
  const stopReason = blockingOpen
    ? "inaccessible_or_unresolved_gap"
    : "evidence_sufficient_or_low_decision_value";
  return {
    ...base,
    type: "synthesize",
    rationale: blockingOpen
      ? `Write with localized uncertainty; blocking gap remains: ${blockingOpen.missingFact}`
      : "Authorized investigation has diminishing expected value; write from stored evidence",
    estimatedMaxCostMicro: FIXTURE_SYNTH_COST_MICRO,
    arguments: { reason: stopReason, stopPolicy: stopReason },
  };
}

export function searchDelta(
  previousFamilies: Set<string>,
  newFamilyIds: string[],
): { newFamilies: number; families: string[] } {
  let n = 0;
  for (const f of newFamilyIds) {
    if (!previousFamilies.has(f)) n += 1;
  }
  return { newFamilies: n, families: newFamilyIds };
}

import {
  FIXTURE_FETCH_COST_MICRO,
  FIXTURE_SEARCH_COST_MICRO,
  FIXTURE_SYNTH_COST_MICRO,
} from "@deep/contracts";
import { admitProposedAction } from "./admission.js";
import { selectNextAction } from "./policy.js";
import type { ControllerState, PolicyDecision } from "./types.js";

export type ControllerKind = "baseline" | "adaptive";

const MAX_BASELINE_FETCHES = 3;

function baseProposal(state: ControllerState, type: PolicyDecision["type"], extra: Partial<PolicyDecision>): PolicyDecision {
  const actionId = `act-${state.basis.evidenceRevision + 1}`;
  return {
    actionId,
    runId: state.runId,
    briefRevision: state.brief.revision,
    type,
    coverageIds: extra.coverageIds ?? [],
    arguments: extra.arguments ?? {},
    rationale: extra.rationale ?? "",
    estimatedMaxCostMicro: extra.estimatedMaxCostMicro ?? 0,
    sourceAccessConstraints: extra.sourceAccessConstraints ?? [],
    dedupeKey: extra.dedupeKey ?? actionId,
    privileged: false,
    gapId: extra.gapId,
  };
}

/**
 * Bounded live/baseline controller: one discovery search, inspect a few known
 * HTTP/catalog sources, then write. Not an adaptive engine.
 */
export function selectBaselineAction(state: ControllerState): PolicyDecision {
  const httpOrCatalog = state.sources.filter((s) => {
    const loc = s.locator ?? "";
    return loc.startsWith("http") || loc.startsWith("fixture://");
  });
  const unfetched = httpOrCatalog.filter((s) => s.accessLevel === "discovered" || s.accessLevel === "snippet");
  const fetchedCount = httpOrCatalog.length - unfetched.length;

  if (httpOrCatalog.length === 0 && state.searches.length === 0) {
    return baseProposal(state, "search", {
      rationale: "Live discovery of public sources for the task",
      arguments: { query: state.brief.originalQuestion },
      estimatedMaxCostMicro: FIXTURE_SEARCH_COST_MICRO,
      dedupeKey: `baseline-search:${state.runId}`,
    });
  }
  if (unfetched[0] && fetchedCount < MAX_BASELINE_FETCHES) {
    return baseProposal(state, "fetch", {
      rationale: "Inspect an already-known source before another paid search",
      arguments: { locator: unfetched[0].locator, sourceId: unfetched[0].id },
      estimatedMaxCostMicro: FIXTURE_FETCH_COST_MICRO,
      dedupeKey: `baseline-fetch:${unfetched[0].locator}`,
    });
  }
  return baseProposal(state, "synthesize", {
    rationale: "Write a bounded cited report from accessed evidence",
    estimatedMaxCostMicro: FIXTURE_SYNTH_COST_MICRO,
    dedupeKey: `baseline-synth:${state.runId}`,
  });
}

export function proposeControllerAction(state: ControllerState, kind: ControllerKind): PolicyDecision {
  const raw = kind === "baseline" ? selectBaselineAction(state) : selectNextAction(state);
  return admitProposedAction(state, raw);
}

import {
  ActionProposalSchema,
  ExecutableArguments,
  ActionTypeSchema,
  FIXTURE_FETCH_COST_MICRO,
  FIXTURE_SEARCH_COST_MICRO,
  FIXTURE_SYNTH_COST_MICRO,
} from "@deep/contracts";
import { canSpendExploration } from "./fences.js";
import { offCoverage, queryLeaksPrivate, rejectPrivilegedProposal } from "./injection.js";
import type { ControllerState, PolicyDecision } from "./types.js";

export type LiveSpendGate = {
  capMicro: number;
  usedMicro: number;
  estimatedMicro: number;
};

export type AdmitOptions = {
  seenDedupeKeys?: Iterable<string>;
  /**
   * Live provider spend is a separate ledger from the fixture run-budget reserve.
   * When set, estimatedMaxCostMicro is not compared to DEFAULT_RUN_BUDGET_MICRO.
   */
  liveSpend?: LiveSpendGate;
};

function liveCallPermitted(gate: LiveSpendGate): boolean {
  if (![gate.capMicro, gate.usedMicro, gate.estimatedMicro].every((v) => Number.isSafeInteger(v) && v >= 0)) return false;
  if (gate.capMicro <= 0) return false;
  return gate.capMicro - gate.usedMicro >= gate.estimatedMicro;
}

function runBudgetCostMicro(proposal: PolicyDecision, opts: AdmitOptions): number {
  // Internal exploration counters use server tariffs. Provider reservation is separately atomic.
  const tariff = proposal.type === "search" ? FIXTURE_SEARCH_COST_MICRO
    : proposal.type === "fetch" ? FIXTURE_FETCH_COST_MICRO
    : proposal.type === "synthesize" ? FIXTURE_SYNTH_COST_MICRO : 0;
  // An overestimate can conservatively reduce admission, but never waive the server tariff.
  return opts.liveSpend ? tariff : Math.max(tariff, proposal.estimatedMaxCostMicro ?? 0);
}

const UNAVAILABLE_CAPABILITIES = new Set(["extract_table", "inspect_visual"]);

function isAllowedLocator(locator: string): boolean {
  if (locator.startsWith("fixture://") || locator.startsWith("attachment://")) return true;
  if (/^(file|javascript|data|ftp):/i.test(locator)) return false;
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0|169\.254|metadata\.google/i.test(locator)) return false;
  return locator.startsWith("http://") || locator.startsWith("https://");
}

function asDecision(proposal: PolicyDecision, patch: Partial<PolicyDecision>): PolicyDecision {
  return { ...proposal, ...patch };
}

/**
 * Single application-owned admission gate. Model, fixture, and live baseline
 * proposals all pass through here before the worker may execute them.
 */
export function admitProposedAction(
  state: ControllerState,
  proposal: PolicyDecision,
  opts: AdmitOptions = {},
): PolicyDecision {
  const parsed = ActionProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    return asDecision(proposal, {
      type: "stop",
      rejectReason: "invalid_schema",
      rationale: "Proposal failed schema validation",
      arguments: { reason: "invalid_schema" },
    });
  }

  const typeParse = ActionTypeSchema.safeParse(proposal.type);
  if (UNAVAILABLE_CAPABILITIES.has(proposal.type)) {
    return asDecision(proposal, {
      type: "stop",
      rejectReason: "capability_unavailable",
      rationale: "table/visual extraction adapters are unavailable",
      arguments: { reason: "capability_unavailable", requested: proposal.type },
    });
  }
  if (!typeParse.success) {
    return asDecision(proposal, {
      type: "stop",
      rejectReason: "unauthorized_action",
      rationale: `action type ${proposal.type} is not a permitted research action`,
      arguments: { reason: "unauthorized_action", requested: proposal.type },
    });
  }

  const privileged = rejectPrivilegedProposal(proposal);
  if (privileged) {
    return asDecision(proposal, {
      type: "stop",
      rejectReason: privileged,
      rationale: privileged,
      arguments: { reason: "unauthorized_action", detail: privileged },
    });
  }

  if (state.deleted) {
    return asDecision(proposal, {
      type: "stop",
      rejectReason: "deleted",
      rationale: "account or content deleted",
      arguments: { reason: "deleted" },
    });
  }

  if (state.basis.cancellationEpoch > 0) {
    return asDecision(proposal, {
      type: "stop",
      rejectReason: "cancelled",
      rationale: "run is cancelled; no further actions",
      arguments: { reason: "cancelled" },
    });
  }

  if (proposal.runId !== state.runId) {
    return asDecision(proposal, { type: "stop", rejectReason: "wrong_run", rationale: "proposal belongs to another run", arguments: { reason: "wrong_run" } });
  }
  if (proposal.briefRevision !== state.brief.revision || proposal.briefRevision !== state.basis.briefRevision) {
    return asDecision(proposal, {
      type: "stop",
      rejectReason: "stale_revision",
      rationale: "proposal brief revision does not match the loaded run",
      arguments: { reason: "stale_revision" },
    });
  }

  const seen = new Set([...(state.issuedDedupeKeys ?? []), ...(opts.seenDedupeKeys ?? [])]);
  if (proposal.dedupeKey && seen.has(proposal.dedupeKey) && proposal.type !== "synthesize" && proposal.type !== "stop") {
    return asDecision(proposal, {
      type: "stop",
      rejectReason: "duplicate_action",
      rationale: "duplicate action suppressed",
      arguments: { reason: "duplicate_action", dedupeKey: proposal.dedupeKey },
    });
  }

  if (proposal.type === "fetch") {
    const locator = String(proposal.arguments.locator ?? "");
    if (!locator || !isAllowedLocator(locator)) {
      return asDecision(proposal, {
        type: "stop",
        rejectReason: "unsafe_url",
        rationale: "fetch locator is not an allowed fixture, attachment, or http(s) URL",
        arguments: { reason: "unsafe_url", locator },
      });
    }
  }

  if (proposal.type === "synthesize") {
    const blockingUntried = (state.gaps ?? []).find(
      (g) => g.importance === "blocking" && (g.latestOutcome === "untried" || !g.latestOutcome) && g.resolution !== "resolved" && g.suggestedQuery,
    );
    const explorationAvailable = canSpendExploration({ totalBudgetMicro: state.budgetMicro,
      spentPlusReservedMicro: state.spentMicro, actionCostMicro: FIXTURE_SEARCH_COST_MICRO,
      isFinishingAction: false, finishingCostMicro: FIXTURE_SYNTH_COST_MICRO });
    if (blockingUntried && explorationAvailable) {
      return asDecision(proposal, {
        type: "stop",
        rejectReason: "blocking_gap_open",
        rationale: `synthesize rejected while blocking gap is untried: ${blockingUntried.missingFact}`,
        arguments: { reason: "blocking_gap_open", gapId: blockingUntried.id },
      });
    }
  }

  if (proposal.type === "search") {
    const query = String(proposal.arguments.query ?? "");
    if (offCoverage(query, state.brief.originalQuestion)) {
      return asDecision(proposal, {
        type: "stop",
        rejectReason: "off_coverage",
        rationale: "Declined an out-of-coverage branch suggested by page content",
        arguments: { reason: "off_coverage", query },
      });
    }
    const leak = queryLeaksPrivate(query, state.privateCanaries);
    if (leak) {
      return asDecision(proposal, {
        type: "stop",
        rejectReason: "private_query_blocked",
        rationale: "private document text cannot be used as a public query",
        arguments: { reason: "private_query_blocked" },
      });
    }
  }

  if (opts.liveSpend && proposal.type === "search") {
    if (!liveCallPermitted(opts.liveSpend)) {
      return asDecision(proposal, {
        type: "stop",
        rejectReason: "live_spend_cap_exhausted",
        rationale: "live spend cap would be exceeded; no new paid call issued",
        arguments: { reason: "live_spend_cap_exhausted" },
      });
    }
  }

  const finishing = proposal.type === "synthesize" || proposal.type === "stop";
  const cost = runBudgetCostMicro(proposal, opts);
  if (
    cost > 0 &&
    !canSpendExploration({
      totalBudgetMicro: state.budgetMicro,
      spentPlusReservedMicro: state.spentMicro,
      actionCostMicro: cost,
      isFinishingAction: finishing,
      finishingCostMicro: FIXTURE_SYNTH_COST_MICRO,
    })
  ) {
    return asDecision(proposal, {
      type: "stop",
      rejectReason: "allowance_exhausted",
      rationale: "allowance exhausted; finishing from stored evidence",
      estimatedMaxCostMicro: FIXTURE_SYNTH_COST_MICRO,
      arguments: { reason: "allowance_exhausted" },
    });
  }

  const executable = ExecutableArguments[typeParse.data].safeParse(proposal.arguments);
  if (!executable.success) {
    return asDecision(proposal, { type: "stop", rejectReason: "invalid_arguments",
      rationale: "Action arguments do not match the executable contract", arguments: { reason: "invalid_arguments" } });
  }
  return { ...parsed.data, arguments: executable.data };
}

/** Back-compat alias used by fixture/OpenRouter adapters. */
export function authorizeAction(
  state: ControllerState,
  proposal: PolicyDecision,
  opts?: AdmitOptions,
): PolicyDecision {
  return admitProposedAction(state, proposal, opts);
}

/** Validate the proposal and then the exact transformed operation; no authority fields are carried through. */
export function admitExecutableAction(state: ControllerState, proposal: PolicyDecision, opts: AdmitOptions = {}): PolicyDecision {
  const admitted = admitProposedAction(state, proposal, opts);
  if (admitted.rejectReason || admitted.type !== "challenge" || admitted.arguments.recordOnly === true) return admitted;
  return admitProposedAction(state, { ...admitted, type: "search", arguments: {
    query: admitted.arguments.query, targetConclusion: admitted.arguments.targetConclusion,
    falsificationHypothesis: admitted.arguments.falsificationHypothesis, disconfirm: true,
    selectionReason: admitted.arguments.selectionReason,
  } }, opts);
}

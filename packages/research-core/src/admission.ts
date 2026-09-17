import {
  ActionProposalSchema,
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
  if (gate.capMicro <= 0) return false;
  return gate.capMicro - gate.usedMicro >= gate.estimatedMicro;
}

function runBudgetCostMicro(proposal: PolicyDecision, opts: AdmitOptions): number {
  if (opts.liveSpend) {
    if (proposal.type === "search") return FIXTURE_SEARCH_COST_MICRO;
    if (proposal.type === "fetch") return FIXTURE_FETCH_COST_MICRO;
    if (proposal.type === "synthesize") return FIXTURE_SYNTH_COST_MICRO;
    return 0;
  }
  return proposal.estimatedMaxCostMicro ?? 0;
}

const UNAVAILABLE_CAPABILITIES = new Set(["extract_table", "inspect_visual"]);

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

  if (proposal.briefRevision !== state.brief.revision && proposal.briefRevision !== state.basis.briefRevision) {
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

  return proposal;
}

/** Back-compat alias used by fixture/OpenRouter adapters. */
export function authorizeAction(
  state: ControllerState,
  proposal: PolicyDecision,
  opts?: AdmitOptions,
): PolicyDecision {
  return admitProposedAction(state, proposal, opts);
}

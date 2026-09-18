import {
  MAX_DEFAULT_FANOUT,
  PRODUCTION_PORTFOLIO_V1,
  capabilitiesFor,
  type OperationClass,
  type PortfolioCatalog,
  type PrivacyRequirement,
  type RouteCapabilities,
} from "./portfolio.js";

export const ESCALATION_TRIGGERS = [
  "schema_validation_failure",
  "semantic_validation_failure",
  "material_contradiction",
  "critical_evidence_gap",
  "difficult_scope",
  "unsupported_consequential_conclusion",
  "low_benchmarked_confidence",
  "explicit_high_value_mode",
] as const;
export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

export type ModelOutcomeStatus =
  | "succeeded"
  | "refused"
  | "invalid_output"
  | "transient_failure"
  | "permanent_failure"
  | "outcome_unknown";

export type RouteDecision = {
  admitted: boolean;
  reason: string;
  policyId: string | null;
  model: string | null;
  provider: string | null;
  providerName: string | null;
  rejectedCheaperIncompatible: string[];
  fanout: number;
  escalationEligible: boolean;
  escalationDepth: number;
  cacheSessionId: string | null;
  reuseCache: boolean;
  fallbackUsed: boolean;
};

export type RoutingInput = {
  portfolio?: PortfolioCatalog;
  operation: string;
  operationClass: OperationClass;
  privacy: PrivacyRequirement;
  structuredOutputRequired: boolean;
  consequentiality?: "routine" | "consequential" | "high_value";
  priorFailures?: { trigger: EscalationTrigger; atDepth: number }[];
  remainingBudgetMicro: number;
  attemptReserveMicro: number;
  lastPolicyId?: string;
  runId?: string;
  requestedFanout?: number;
};

function price(candidate: RouteCapabilities): number {
  return candidate.promptMicroPerMillion + candidate.completionMicroPerMillion;
}

function privacyOk(candidate: RouteCapabilities, privacy: PrivacyRequirement): boolean {
  if (privacy.dataCollection === "deny" && candidate.dataCollection !== "deny") return false;
  if (privacy.zdrRequired && !candidate.zdr) return false;
  return true;
}

function admitCandidate(candidate: RouteCapabilities, input: RoutingInput): string | null {
  if (!candidate.available) return "candidate_unavailable";
  if (input.structuredOutputRequired && !candidate.structuredOutput) return "structured_output_required";
  if (!privacyOk(candidate, input.privacy)) {
    return input.privacy.zdrRequired && !candidate.zdr
      ? "zdr_incompatible_unavailable"
      : "privacy_incompatible_unavailable";
  }
  return null;
}

/**
 * Cheap-first operation routing. A cheaper route that violates the run privacy
 * policy is unavailable, not a fallback. Default fanout is 1.
 */
export function resolveOperationRoute(input: RoutingInput): RouteDecision {
  const portfolio = input.portfolio ?? PRODUCTION_PORTFOLIO_V1;
  const fanout = Math.min(input.requestedFanout ?? 1, portfolio.maxFanout, MAX_DEFAULT_FANOUT);
  if (input.remainingBudgetMicro < input.attemptReserveMicro) {
    return {
      admitted: false,
      reason: "attempt_budget_exhausted",
      policyId: null,
      model: null,
      provider: null,
      providerName: null,
      rejectedCheaperIncompatible: [],
      fanout,
      escalationEligible: false,
      escalationDepth: 0,
      cacheSessionId: null,
      reuseCache: false,
      fallbackUsed: false,
    };
  }
  const rejectedCheaperIncompatible: string[] = [];
  const rejections: string[] = [];
  const eligible: RouteCapabilities[] = [];
  const sorted = [...portfolio.candidates].sort((a, b) => price(a) - price(b) || a.tier - b.tier);
  for (const candidate of sorted) {
    const rejection = admitCandidate(candidate, input);
    if (rejection) {
      rejections.push(`${candidate.policyId}:${rejection}`);
      if (rejection.endsWith("unavailable") || rejection === "structured_output_required") {
        rejectedCheaperIncompatible.push(`${candidate.policyId}:${rejection}`);
      }
      continue;
    }
    eligible.push(candidate);
  }
  const chosen = eligible[0];
  if (!chosen) {
    return {
      admitted: false,
      reason: rejections.some((r) => r.includes("zdr_incompatible"))
        ? "zdr_incompatible_unavailable"
        : rejections.some((r) => r.includes("structured_output"))
          ? "structured_output_required"
          : "no_admitted_route",
      policyId: null,
      model: null,
      provider: null,
      providerName: null,
      rejectedCheaperIncompatible,
      fanout,
      escalationEligible: false,
      escalationDepth: 0,
      cacheSessionId: null,
      reuseCache: false,
      fallbackUsed: false,
    };
  }
  const session = cacheSessionPolicy({
    runId: input.runId ?? "unbound",
    lastPolicyId: input.lastPolicyId,
    nextPolicyId: chosen.policyId,
    qualityEscalation: false,
  });
  return {
    admitted: true,
    reason: "cheap_first_admitted",
    policyId: chosen.policyId,
    model: chosen.model,
    provider: chosen.provider,
    providerName: chosen.providerName,
    rejectedCheaperIncompatible,
    fanout,
    escalationEligible: true,
    escalationDepth: 0,
    cacheSessionId: session.sessionId,
    reuseCache: session.reuseCache,
    fallbackUsed: false,
  };
}

export function cacheSessionPolicy(args: {
  runId: string;
  lastPolicyId?: string;
  nextPolicyId: string;
  qualityEscalation: boolean;
}): { sessionId: string; reuseCache: boolean; reason: string } {
  const sessionId = `run:${args.runId}:policy:${args.nextPolicyId}`;
  if (args.qualityEscalation || (args.lastPolicyId && args.lastPolicyId !== args.nextPolicyId)) {
    return { sessionId, reuseCache: false, reason: "intentional_quality_transition" };
  }
  return { sessionId, reuseCache: true, reason: "sticky_same_policy" };
}

export type AttemptDecision =
  | { action: "keep"; retry: false; escalate: false }
  | { action: "hold"; retry: false; escalate: false; reason: "outcome_unknown" }
  | { action: "stop"; retry: false; escalate: false; reason: string }
  | {
      action: "escalate";
      retry: false;
      escalate: true;
      trigger: EscalationTrigger;
      depth: number;
      nextPolicyId: string | null;
      reason: string;
    };

export function nextAttemptDecision(args: {
  outcome: ModelOutcomeStatus;
  trigger?: EscalationTrigger;
  currentDepth: number;
  maxDepth?: number;
  remainingBudgetMicro: number;
  attemptReserveMicro: number;
  portfolio?: PortfolioCatalog;
  currentPolicyId: string;
}): AttemptDecision {
  if (args.outcome === "outcome_unknown") {
    return { action: "hold", retry: false, escalate: false, reason: "outcome_unknown" };
  }
  if (args.outcome === "succeeded") {
    return { action: "keep", retry: false, escalate: false };
  }
  const maxDepth = args.maxDepth ?? (args.portfolio ?? PRODUCTION_PORTFOLIO_V1).maxEscalationDepth;
  if (!args.trigger || !ESCALATION_TRIGGERS.includes(args.trigger)) {
    return { action: "stop", retry: false, escalate: false, reason: "no_recorded_escalation_trigger" };
  }
  if (args.currentDepth >= maxDepth) {
    return { action: "stop", retry: false, escalate: false, reason: "escalation_depth_exhausted" };
  }
  if (args.remainingBudgetMicro < args.attemptReserveMicro) {
    return { action: "stop", retry: false, escalate: false, reason: "escalation_budget_exhausted" };
  }
  const portfolio = args.portfolio ?? PRODUCTION_PORTFOLIO_V1;
  const current = portfolio.candidates.find((c) => c.policyId === args.currentPolicyId) ?? capabilitiesFor(args.currentPolicyId);
  const privacy = { zdrRequired: current.zdr, dataCollection: current.dataCollection };
  const stronger = portfolio.candidates
    .filter((c) => c.available && c.tier > current.tier && c.structuredOutput && privacyOk(c, privacy))
    .sort((a, b) => a.tier - b.tier || price(a) - price(b))[0];
  if (!stronger) {
    return {
      action: "stop",
      retry: false,
      escalate: false,
      reason: "no_registered_higher_tier",
    };
  }
  return {
    action: "escalate",
    retry: false,
    escalate: true,
    trigger: args.trigger,
    depth: args.currentDepth + 1,
    nextPolicyId: stronger.policyId,
    reason: `escalation:${args.trigger}`,
  };
}

export function triggerForInvalidOutput(reason: string): EscalationTrigger | undefined {
  if (/schema|invalid_output|output_schema/i.test(reason)) return "schema_validation_failure";
  if (/span|binding|semantic/i.test(reason)) return "semantic_validation_failure";
  return undefined;
}

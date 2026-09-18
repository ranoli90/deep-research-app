import { describe, expect, it } from "vitest";
import {
  AZURE_ZDR_MODEL_POLICY,
  STRUCTURED_MODEL_POLICY,
  modelPolicy,
} from "../src/ports/model-policy.js";
import {
  PRODUCTION_PORTFOLIO_V1,
  cacheSessionPolicy,
  nextAttemptDecision,
  replayPolicyIdentity,
  reserveOperationBudget,
  resolveOperationRoute,
  type PortfolioCatalog,
  type RouteCapabilities,
} from "../src/model-governor/index.js";

const cheapOpen: RouteCapabilities = {
  policyId: "test-cheap-open-v1",
  model: "openai/gpt-4o-mini",
  provider: "openai",
  providerName: "OpenAI",
  tier: 1,
  structuredOutput: true,
  zdr: false,
  dataCollection: "deny",
  promptMicroPerMillion: 100_000,
  completionMicroPerMillion: 200_000,
  cacheSticky: true,
  available: true,
};
const zdrRoute: RouteCapabilities = {
  policyId: "test-zdr-v1",
  model: "openai/gpt-4o-mini",
  provider: "azure",
  providerName: "Azure",
  tier: 1,
  structuredOutput: true,
  zdr: true,
  dataCollection: "deny",
  promptMicroPerMillion: 150_000,
  completionMicroPerMillion: 600_000,
  cacheSticky: true,
  available: true,
};
const unstructuredCheap: RouteCapabilities = {
  ...cheapOpen,
  policyId: "test-unstructured-v1",
  structuredOutput: false,
  promptMicroPerMillion: 10_000,
};
const stronger: RouteCapabilities = {
  ...zdrRoute,
  policyId: "test-strong-v1",
  tier: 3,
  promptMicroPerMillion: 2_000_000,
  completionMicroPerMillion: 8_000_000,
};

const catalog: PortfolioCatalog = {
  id: "test-portfolio.v1",
  defaultStrategy: "cheap-first",
  maxEscalationDepth: 2,
  maxFanout: 1,
  candidates: [cheapOpen, zdrRoute, unstructuredCheap, stronger],
};

describe("portfolio admission and cheap-first routing", () => {
  it("rejects a cheaper ZDR-incompatible route instead of using it as fallback", () => {
    const decision = resolveOperationRoute({
      portfolio: catalog,
      operation: "brief",
      operationClass: "structured",
      privacy: { zdrRequired: true, dataCollection: "deny" },
      structuredOutputRequired: true,
      remainingBudgetMicro: 1_000_000,
      attemptReserveMicro: 21_658,
    });
    expect(decision.admitted).toBe(true);
    expect(decision.policyId).toBe("test-zdr-v1");
    expect(decision.fallbackUsed).toBe(false);
    expect(decision.rejectedCheaperIncompatible.some((r) => r.includes("test-cheap-open-v1") && r.includes("zdr_incompatible"))).toBe(true);
    expect(decision.fanout).toBe(1);
  });

  it("requires structured-output capability for structured operations", () => {
    const decision = resolveOperationRoute({
      portfolio: { ...catalog, candidates: [unstructuredCheap] },
      operation: "brief",
      operationClass: "structured",
      privacy: { zdrRequired: false, dataCollection: "deny" },
      structuredOutputRequired: true,
      remainingBudgetMicro: 1_000_000,
      attemptReserveMicro: 1,
    });
    expect(decision.admitted).toBe(false);
    expect(decision.reason).toBe("structured_output_required");
    expect(decision.policyId).toBeNull();
  });

  it("refuses routing when remaining budget cannot cover the attempt reserve", () => {
    const decision = resolveOperationRoute({
      portfolio: catalog,
      operation: "brief",
      operationClass: "structured",
      privacy: { zdrRequired: false, dataCollection: "deny" },
      structuredOutputRequired: true,
      remainingBudgetMicro: 10,
      attemptReserveMicro: 21_658,
    });
    expect(decision).toMatchObject({ admitted: false, reason: "attempt_budget_exhausted", policyId: null, fallbackUsed: false });
  });

  it("selects the cheaper admitted route when privacy allows", () => {
    const decision = resolveOperationRoute({
      portfolio: catalog,
      operation: "brief",
      operationClass: "structured",
      privacy: { zdrRequired: false, dataCollection: "deny" },
      structuredOutputRequired: true,
      remainingBudgetMicro: 1_000_000,
      attemptReserveMicro: 1,
    });
    expect(decision.policyId).toBe("test-cheap-open-v1");
    expect(decision.reason).toBe("cheap_first_admitted");
  });
});

describe("bounded escalation and unknown holds", () => {
  it("escalates only with a recorded trigger and stops at the depth bound", () => {
    const first = nextAttemptDecision({
      outcome: "invalid_output",
      trigger: "schema_validation_failure",
      currentDepth: 0,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 1,
      portfolio: catalog,
      currentPolicyId: "test-zdr-v1",
    });
    expect(first).toMatchObject({ action: "escalate", retry: false, escalate: true, trigger: "schema_validation_failure", nextPolicyId: "test-strong-v1" });
    const stopped = nextAttemptDecision({
      outcome: "invalid_output",
      trigger: "schema_validation_failure",
      currentDepth: 2,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 1,
      portfolio: catalog,
      currentPolicyId: "test-strong-v1",
    });
    expect(stopped).toMatchObject({ action: "stop", retry: false, escalate: false, reason: "escalation_depth_exhausted" });
  });

  it("does not escalate to a privacy-incompatible higher tier and stops when none exist", () => {
    const none = nextAttemptDecision({
      outcome: "invalid_output",
      trigger: "schema_validation_failure",
      currentDepth: 0,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 1,
      portfolio: PRODUCTION_PORTFOLIO_V1,
      currentPolicyId: "openrouter-azure-mini-zdr-text-v1",
    });
    expect(none).toMatchObject({ action: "stop", retry: false, escalate: false, reason: "no_registered_higher_tier" });
    const leak = nextAttemptDecision({
      outcome: "invalid_output",
      trigger: "schema_validation_failure",
      currentDepth: 0,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 1,
      portfolio: { ...catalog, candidates: [zdrRoute, { ...stronger, zdr: false, policyId: "test-open-strong-v1" }] },
      currentPolicyId: "test-zdr-v1",
    });
    expect(leak.escalate).toBe(false);
    expect(leak).toMatchObject({ action: "stop", reason: "no_registered_higher_tier" });
  });

  it("does not retry or escalate an unknown provider outcome", () => {
    const hold = nextAttemptDecision({
      outcome: "outcome_unknown",
      trigger: "schema_validation_failure",
      currentDepth: 0,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 1,
      portfolio: catalog,
      currentPolicyId: "test-zdr-v1",
    });
    expect(hold).toEqual({ action: "hold", retry: false, escalate: false, reason: "outcome_unknown" });
  });

  it("does not escalate without a recorded trigger", () => {
    const stopped = nextAttemptDecision({
      outcome: "invalid_output",
      currentDepth: 0,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 1,
      portfolio: catalog,
      currentPolicyId: "test-zdr-v1",
    });
    expect(stopped.retry).toBe(false);
    expect(stopped.escalate).toBe(false);
  });
});

describe("historical policy replay", () => {
  it("replays the original model/provider after a newer portfolio exists", () => {
    expect(PRODUCTION_PORTFOLIO_V1.id).toBe("research-portfolio.v1");
    expect(replayPolicyIdentity(STRUCTURED_MODEL_POLICY.id)).toEqual({
      id: STRUCTURED_MODEL_POLICY.id,
      model: "openai/gpt-4o-mini",
      provider: "openai",
      providerName: "OpenAI",
    });
    expect(modelPolicy(AZURE_ZDR_MODEL_POLICY.id).provider).toBe("azure");
    expect(modelPolicy(STRUCTURED_MODEL_POLICY.id).id).toBe("openrouter-openai-mini-text-v1");
  });
});

describe("hierarchical reserves and cache stickiness", () => {
  it("reserves verification and writing before exploration", () => {
    const blocked = reserveOperationBudget({
      hierarchy: { accountRemainingMicro: 100_000, runRemainingMicro: 30_000, reservedVerificationMicro: 0, reservedWritingMicro: 0 },
      operationClass: "exploration",
      attemptReserveMicro: 21_658,
      runBudgetMicro: 100_000,
    });
    expect(blocked).toMatchObject({ ok: false, reason: "verification_writing_reserve" });
    const writing = reserveOperationBudget({
      hierarchy: { accountRemainingMicro: 100_000, runRemainingMicro: 30_000, reservedVerificationMicro: 0, reservedWritingMicro: 0 },
      operationClass: "writing",
      attemptReserveMicro: 21_658,
      runBudgetMicro: 100_000,
    });
    expect(writing.ok).toBe(true);
  });

  it("keeps cache session stickiness on the same policy and breaks it on quality escalation", () => {
    const sticky = cacheSessionPolicy({ runId: "run-1", lastPolicyId: "test-zdr-v1", nextPolicyId: "test-zdr-v1", qualityEscalation: false });
    expect(sticky.reuseCache).toBe(true);
    const escalate = cacheSessionPolicy({ runId: "run-1", lastPolicyId: "test-zdr-v1", nextPolicyId: "test-strong-v1", qualityEscalation: true });
    expect(escalate.reuseCache).toBe(false);
    expect(escalate.reason).toBe("intentional_quality_transition");
  });
});

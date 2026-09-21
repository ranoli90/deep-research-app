import { loadConfig } from "../src/platform/config.js";
import { admittedRunOptions } from "../src/modules/run-route-admission.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AZURE_ZDR_DISCOVERY_POLICY,
  AZURE_ZDR_EXACT_QUOTE_POLICY,
  AZURE_ZDR_MODEL_POLICY,
  AZURE_ZDR_STRICT_POLICY,
  STRUCTURED_MODEL_POLICY,
  STRUCTURED_STRICT_POLICY,
  modelPolicy,
} from "../src/ports/model-policy.js";
import {
  PRODUCTION_PORTFOLIO_V1,
  cacheSessionPolicy,
  chooseAdmittedRunPolicy,
  nextAttemptDecision,
  availabilityFailover,
  withRetiredRoutes,
  operationClassFor,
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
  model: "test/independent-strong-model",
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

  it("keeps availability failover separate from quality escalation", () => {
    const none = availabilityFailover({
      outcome: "transient_failure",
      currentPolicyId: "test-zdr-v1",
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 1,
      portfolio: catalog,
    });
    expect(none).toMatchObject({ failover: false, retry: false, reason: "no_compatible_availability_route" });
    const open = availabilityFailover({
      outcome: "transient_failure",
      currentPolicyId: "test-cheap-open-v1",
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 1,
      portfolio: catalog,
    });
    expect(open).toMatchObject({ failover: true, retry: false, nextPolicyId: "test-zdr-v1" });
    const unknown = availabilityFailover({
      outcome: "outcome_unknown",
      currentPolicyId: "test-cheap-open-v1",
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 1,
      portfolio: catalog,
    });
    expect(unknown).toEqual({ action: "hold", retry: false, failover: false, reason: "outcome_unknown" });
    const quality = nextAttemptDecision({
      outcome: "invalid_output",
      trigger: "schema_validation_failure",
      currentDepth: 0,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 1,
      portfolio: catalog,
      currentPolicyId: "test-zdr-v1",
    });
    expect(quality.escalate).toBe(true);
    expect("failover" in quality).toBe(false);
  });

  it("removes retired routes from new admission while preserving replay identity", () => {
    const retired = withRetiredRoutes(PRODUCTION_PORTFOLIO_V1, [STRUCTURED_MODEL_POLICY.id]);
    const decision = resolveOperationRoute({
      portfolio: retired,
      operation: "brief",
      operationClass: "structured",
      privacy: { zdrRequired: false, dataCollection: "deny" },
      structuredOutputRequired: true,
      remainingBudgetMicro: 1_000_000,
      attemptReserveMicro: 21_658,
    });
    expect(decision.policyId).not.toBe(STRUCTURED_MODEL_POLICY.id);
    expect(replayPolicyIdentity(STRUCTURED_MODEL_POLICY.id)).toEqual({
      id: STRUCTURED_MODEL_POLICY.id,
      model: STRUCTURED_MODEL_POLICY.model,
      provider: STRUCTURED_MODEL_POLICY.provider,
      providerName: STRUCTURED_MODEL_POLICY.providerName,
    });
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
    expect(operationClassFor("search")).toBe("exploration");
    expect(operationClassFor("brief")).toBe("structured");
    expect(operationClassFor("write_report")).toBe("writing");
    const structured = reserveOperationBudget({
      hierarchy: { accountRemainingMicro: 100_000, runRemainingMicro: 30_000, reservedVerificationMicro: 0, reservedWritingMicro: 0 },
      operationClass: "structured",
      attemptReserveMicro: 21_658,
      runBudgetMicro: 100_000,
    });
    expect(structured).toMatchObject({ ok: false, reason: "verification_writing_reserve" });
    const writing = reserveOperationBudget({
      hierarchy: { accountRemainingMicro: 100_000, runRemainingMicro: 30_000, reservedVerificationMicro: 0, reservedWritingMicro: 0 },
      operationClass: "writing",
      attemptReserveMicro: 21_658,
      runBudgetMicro: 100_000,
    });
    expect(writing.ok).toBe(true);
  });

  it("does not claim explicit cache reuse without verified transport support", () => {
    const sticky = cacheSessionPolicy({ runId: "run-1", lastPolicyId: "test-zdr-v1", nextPolicyId: "test-zdr-v1", qualityEscalation: false });
    expect(sticky).toMatchObject({sessionId:null,reuseCache:false,reason:"explicit_cache_not_supported"});
    const escalate = cacheSessionPolicy({ runId: "run-1", lastPolicyId: "test-zdr-v1", nextPolicyId: "test-strong-v1", qualityEscalation: true });
    expect(escalate.reuseCache).toBe(false);
    expect(escalate.reason).toBe("explicit_cache_not_supported");
    expect(readFileSync(new URL("../src/worker/model-gateway.ts", import.meta.url), "utf8")).not.toMatch(/sessionId/);
  });
});

describe("cheap-first run admission", () => {
  it("applies the cheap-first route on new runs and fail-closes when none is admitted", () => {
    const chosen = chooseAdmittedRunPolicy({
      runId: "run-new",
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 21_658,
    });
    expect(chosen).toMatchObject({ policyId: STRUCTURED_STRICT_POLICY.id, admission: "cheap_first_admitted", cacheSessionId: null });
    const zdr = chooseAdmittedRunPolicy({
      runId: "run-zdr",
      zdrRequired: true,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 21_658,
    });
    expect(zdr).toMatchObject({ policyId: AZURE_ZDR_STRICT_POLICY.id, admission: "cheap_first_admitted", cacheSessionId: null });
    const pinned = chooseAdmittedRunPolicy({
      runId: "run-pin",
      requestedPolicyId: AZURE_ZDR_EXACT_QUOTE_POLICY.id,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 21_658,
    });
    expect(pinned).toMatchObject({ policyId: AZURE_ZDR_EXACT_QUOTE_POLICY.id, admission: "pinned_run_policy" });
    const api = readFileSync(new URL("../src/api/app.ts", import.meta.url), "utf8");
    expect(api).toMatch(/admitRun\(pool,\s*a\.accountId,\s*idempotencyKey,\s*input,\s*admittedRunOptions\(config\)\)/);
    const configured = loadConfig({ DATABASE_URL: "postgres://unused/nonbillable",
      STRUCTURED_MODEL_POLICY_ID: AZURE_ZDR_STRICT_POLICY.id });
    expect(admittedRunOptions(configured)).toMatchObject({ modelPolicyId: AZURE_ZDR_STRICT_POLICY.id,
      zdrRequired: true });
    const inherited = chooseAdmittedRunPolicy({
      runId: "run-child",
      parentPolicyId: AZURE_ZDR_MODEL_POLICY.id,
      requestedPolicyId: STRUCTURED_MODEL_POLICY.id,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 21_658,
    });
    expect(inherited).toMatchObject({ policyId: AZURE_ZDR_STRICT_POLICY.id, admission: "inherited_parent_policy", cacheSessionId: null });
    expect(chooseAdmittedRunPolicy({
      runId: "run-child-openai",
      parentPolicyId: STRUCTURED_MODEL_POLICY.id,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 21_658,
    })).toMatchObject({ policyId: STRUCTURED_STRICT_POLICY.id, admission: "inherited_parent_policy" });
    expect(chooseAdmittedRunPolicy({
      runId: "run-child-discovery",
      parentPolicyId: AZURE_ZDR_DISCOVERY_POLICY.id,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 21_658,
    })).toMatchObject({ policyId: AZURE_ZDR_STRICT_POLICY.id, admission: "inherited_parent_policy" });
    expect(chooseAdmittedRunPolicy({
      runId: "run-child-strict",
      parentPolicyId: AZURE_ZDR_STRICT_POLICY.id,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 21_658,
    })).toMatchObject({ policyId: AZURE_ZDR_STRICT_POLICY.id, admission: "inherited_parent_policy" });
    expect(replayPolicyIdentity(AZURE_ZDR_MODEL_POLICY.id).id).toBe(AZURE_ZDR_MODEL_POLICY.id);
    expect(replayPolicyIdentity(AZURE_ZDR_DISCOVERY_POLICY.id).id).toBe(AZURE_ZDR_DISCOVERY_POLICY.id);
    expect(() => chooseAdmittedRunPolicy({
      runId: "run-broke",
      remainingBudgetMicro: 10,
      attemptReserveMicro: 21_658,
    })).toThrow("attempt_budget_exhausted");
    expect(() => chooseAdmittedRunPolicy({
      runId: "run-pin-zdr",
      requestedPolicyId: STRUCTURED_MODEL_POLICY.id,
      zdrRequired: true,
      remainingBudgetMicro: 100_000,
      attemptReserveMicro: 21_658,
    })).toThrow("zdr_incompatible_unavailable");
  });
});

it("advances production new admissions to strict semantics without changing the configured processor",()=>{
 expect(loadConfig({DATABASE_URL:"postgres://unused/nonbillable",STRUCTURED_MODEL_POLICY_ID:"openrouter-azure-mini-zdr-discovery-v3"}).structuredModelPolicyId).toBe(AZURE_ZDR_STRICT_POLICY.id);
 expect(loadConfig({DATABASE_URL:"postgres://unused/nonbillable",STRUCTURED_MODEL_POLICY_ID:STRUCTURED_MODEL_POLICY.id}).structuredModelPolicyId).toBe(STRUCTURED_STRICT_POLICY.id);
 expect(replayPolicyIdentity(AZURE_ZDR_DISCOVERY_POLICY.id).id).toBe(AZURE_ZDR_DISCOVERY_POLICY.id);
 expect(modelPolicy(AZURE_ZDR_MODEL_POLICY.id).id).toBe(AZURE_ZDR_MODEL_POLICY.id);
});

it("ENG-007 Beta production routes are one gpt-4o-mini family, not quality tiers",()=>{
 expect(new Set(PRODUCTION_PORTFOLIO_V1.candidates.map((c)=>c.model))).toEqual(new Set(["openai/gpt-4o-mini"]));
 expect(new Set(PRODUCTION_PORTFOLIO_V1.candidates.map((c)=>c.tier))).toEqual(new Set([1]));
 expect(PRODUCTION_PORTFOLIO_V1.candidates.every((c)=>c.cacheSticky===false)).toBe(true);
 const admitted=resolveOperationRoute({
  operation:"brief",operationClass:"structured",privacy:{zdrRequired:false,dataCollection:"deny"},
  structuredOutputRequired:true,remainingBudgetMicro:1_000_000,attemptReserveMicro:21_658,
 });
 expect(admitted).toMatchObject({admitted:true,policyId:STRUCTURED_STRICT_POLICY.id,escalationEligible:false,cacheSessionId:null});
 expect(nextAttemptDecision({
  outcome:"invalid_output",trigger:"schema_validation_failure",currentDepth:0,remainingBudgetMicro:100_000,
  attemptReserveMicro:1,portfolio:PRODUCTION_PORTFOLIO_V1,currentPolicyId:STRUCTURED_STRICT_POLICY.id,
 })).toMatchObject({action:"stop",retry:false,escalate:false,reason:"no_registered_higher_tier"});
});

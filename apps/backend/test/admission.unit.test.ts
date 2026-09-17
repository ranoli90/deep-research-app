import { describe, expect, it } from "vitest";
import { CONSENT_POLICY_VERSION, DEFAULT_RUN_BUDGET_MICRO, LIVE_CALL_RESERVE_MICRO } from "@deep/contracts";
import { admitProposedAction, selectBaselineAction, type ControllerState } from "@deep/research-core";
import { canIssueLiveCall } from "../src/modules/live-spend.js";
import { nextLiveAction } from "../src/worker/live-policy.js";

function state(partial: Partial<ControllerState> = {}): ControllerState {
  const question = "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01";
  return {
    runId: "00000000-0000-4000-8000-000000000003",
    brief: {
      id: "00000000-0000-4000-8000-000000000001",
      conversationId: "00000000-0000-4000-8000-000000000002",
      originalQuestion: question,
      language: "en",
      attachmentIds: [],
      sourceRestrictions: [],
      nonGoals: [],
      constraints: [],
      assumptions: [],
      budgetPolicyId: "default",
      consentPolicyVersion: CONSENT_POLICY_VERSION,
      revision: 1,
    },
    basis: { briefRevision: 1, evidenceRevision: 0, consentEpoch: 1, cancellationEpoch: 0, workerLeaseFence: 1 },
    phase: "researching",
    sources: [],
    passages: [],
    claims: [],
    coverage: [],
    gaps: [],
    searches: [],
    constraints: [],
    candidates: [],
    spentMicro: 0,
    budgetMicro: DEFAULT_RUN_BUDGET_MICRO,
    deleted: false,
    privateCanaries: [],
    ...partial,
  };
}

describe("live baseline proposals are admitted", () => {
  it("nextLiveAction search is rejected when it would leak a private canary", () => {
    const s = state({ privateCanaries: ["CANARY:SECRET99"] });
    const live = nextLiveAction(s);
    const proposed = {
      actionId: "live-0",
      runId: s.runId,
      briefRevision: 1,
      type: live.type,
      coverageIds: [] as string[],
      arguments: { query: `find CANARY:SECRET99 for ${s.brief.originalQuestion}` },
      rationale: live.rationale,
      estimatedMaxCostMicro: LIVE_CALL_RESERVE_MICRO,
      sourceAccessConstraints: [] as string[],
      dedupeKey: "live-search",
      privileged: false,
    };
    const d = admitProposedAction(s, proposed);
    expect(d.type).toBe("stop");
    expect(d.rejectReason).toBe("private_query_blocked");
  });

  it("selectBaselineAction is not presented as adaptive — no gap pivot", () => {
    const s = state({
      sources: [
        {
          id: "s1",
          title: "blog",
          locator: "https://example.com/review",
          accessLevel: "full-text",
          sourceType: "review-summary",
        },
      ],
      searches: [{ query: "q", sourceFamilyIds: ["a"], newFamilies: 1, coverageProgress: true }],
      brief: {
        id: "00000000-0000-4000-8000-000000000001",
        conversationId: "00000000-0000-4000-8000-000000000002",
        originalQuestion: "Is NimbusDB compatible with Postgres 14?",
        language: "en",
        attachmentIds: [],
        sourceRestrictions: [],
        nonGoals: [],
        constraints: [],
        assumptions: [],
        budgetPolicyId: "default",
        consentPolicyVersion: CONSENT_POLICY_VERSION,
        revision: 1,
      },
    });
    const d = selectBaselineAction(s);
    expect(d.type).toBe("synthesize");
    expect(d.arguments.pivot).toBeFalsy();
  });
});

describe("live search vs fixture run budget", () => {
  it("admits a well-formed live search when LIVE_CALL_RESERVE_MICRO exceeds the default run budget but the live cap remains", () => {
    const s = state({ budgetMicro: DEFAULT_RUN_BUDGET_MICRO, spentMicro: 0 });
    const live = nextLiveAction(s);
    expect(live.type).toBe("search");
    expect(LIVE_CALL_RESERVE_MICRO).toBeGreaterThan(DEFAULT_RUN_BUDGET_MICRO);
    const proposed = {
      actionId: "live-0",
      runId: s.runId,
      briefRevision: 1,
      type: live.type,
      coverageIds: [] as string[],
      arguments: { query: live.query ?? s.brief.originalQuestion },
      rationale: live.rationale,
      estimatedMaxCostMicro: LIVE_CALL_RESERVE_MICRO,
      sourceAccessConstraints: [] as string[],
      dedupeKey: "live-search",
      privileged: false,
    };
    const withoutLiveLedger = admitProposedAction(s, proposed);
    expect(withoutLiveLedger.type).toBe("stop");
    expect(withoutLiveLedger.rejectReason).toBe("allowance_exhausted");

    const d = admitProposedAction(s, proposed, {
      liveSpend: { capMicro: 5_000_000, usedMicro: 0, estimatedMicro: LIVE_CALL_RESERVE_MICRO },
    });
    expect(d.type).toBe("search");
    expect(d.rejectReason).toBeUndefined();
  });

  it("refuses a live search when the live cap cannot cover LIVE_CALL_RESERVE_MICRO", () => {
    const s = state({ budgetMicro: DEFAULT_RUN_BUDGET_MICRO });
    const live = nextLiveAction(s);
    const proposed = {
      actionId: "live-0",
      runId: s.runId,
      briefRevision: 1,
      type: live.type,
      coverageIds: [] as string[],
      arguments: { query: live.query ?? s.brief.originalQuestion },
      rationale: live.rationale,
      estimatedMaxCostMicro: LIVE_CALL_RESERVE_MICRO,
      sourceAccessConstraints: [] as string[],
      dedupeKey: "live-search",
      privileged: false,
    };
    const d = admitProposedAction(s, proposed, {
      liveSpend: { capMicro: 5_000_000, usedMicro: 4_900_000, estimatedMicro: LIVE_CALL_RESERVE_MICRO },
    });
    expect(d.type).toBe("stop");
    expect(d.rejectReason).toBe("live_spend_cap_exhausted");
  });
});

describe("live spend lifecycle (shipped canIssueLiveCall)", () => {
  it("issued and outcome-unknown retain the reservation; exhausted cap refuses the next call", () => {
    const cap = 5_000_000;
    const unknownUsed = 4_000_000;
    expect(canIssueLiveCall({ capMicro: cap, usedMicro: unknownUsed, estimatedMicro: 1_200_000 }).ok).toBe(false);
    expect(canIssueLiveCall({ capMicro: cap, usedMicro: 0, estimatedMicro: 1_200_000 }).ok).toBe(true);
    expect(canIssueLiveCall({ capMicro: 0, usedMicro: 0 }).ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import { admitProposedAction } from "../src/admission.js";
import { extractConstraints } from "../src/brief.js";
import { shouldFullRerun, impactForCorrection } from "../src/impact.js";
import type { ControllerState, PolicyDecision } from "../src/types.js";

function state(partial: Partial<ControllerState> = {}): ControllerState {
  const question = "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01";
  const b = partial.brief ?? {
    id: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    originalQuestion: question,
    language: "en",
    attachmentIds: [],
    sourceRestrictions: [],
    nonGoals: [],
    constraints: extractConstraints(question),
    assumptions: [],
    budgetPolicyId: "default",
    consentPolicyVersion: CONSENT_POLICY_VERSION,
    revision: 1,
  };
  return {
    runId: "00000000-0000-4000-8000-000000000003",
    brief: b,
    basis: { briefRevision: 1, evidenceRevision: 0, consentEpoch: 1, cancellationEpoch: 0, workerLeaseFence: 1 },
    phase: "researching",
    sources: [],
    passages: [],
    claims: [],
    coverage: [{ id: "q1", question, status: "unstarted" }],
    gaps: [],
    searches: [],
    constraints: b.constraints,
    candidates: [],
    spentMicro: 0,
    budgetMicro: 100_000,
    deleted: false,
    privateCanaries: [],
    ...partial,
  };
}

function proposal(partial: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    actionId: "a1",
    runId: "00000000-0000-4000-8000-000000000003",
    briefRevision: 1,
    type: "search",
    coverageIds: [],
    arguments: { query: "managed postgres germany" },
    rationale: "test",
    estimatedMaxCostMicro: 5_000,
    sourceAccessConstraints: [],
    dedupeKey: "search:test",
    privileged: false,
    ...partial,
  };
}

describe("admitProposedAction — shipped gates", () => {
  it("rejects hostile source proposals that expand tools, secrets, or spend", () => {
    const s = state();
    for (const bad of [
      proposal({ type: "reveal_keys", privileged: true, arguments: { apiKey: "x" }, estimatedMaxCostMicro: 0 }),
      proposal({ type: "search", arguments: { query: "q", spendCapOverride: 99 }, estimatedMaxCostMicro: 0 }),
      proposal({ type: "search", arguments: { query: "q", newTools: ["shell"] }, estimatedMaxCostMicro: 0 }),
      proposal({ type: "search", arguments: { query: "q", bypassConsent: true }, estimatedMaxCostMicro: 0 }),
    ]) {
      const d = admitProposedAction(s, bad);
      expect(d.type).toBe("stop");
      expect(d.rejectReason).toBeTruthy();
    }
  });

  it("rejects extract_table and inspect_visual as unavailable capabilities", () => {
    for (const type of ["extract_table", "inspect_visual"] as const) {
      const d = admitProposedAction(state(), proposal({ type, estimatedMaxCostMicro: 0 }));
      expect(d.type).toBe("stop");
      expect(d.rejectReason).toBe("capability_unavailable");
    }
  });

  it("refuses the next paid call when the run allowance is exhausted", () => {
    const d = admitProposedAction(
      state({ spentMicro: 95_000, budgetMicro: 100_000 }),
      proposal({ type: "search", estimatedMaxCostMicro: 5_000 }),
    );
    expect(d.type).toBe("stop");
    expect(d.rejectReason).toBe("allowance_exhausted");
  });

  it("rejects cancelled, deleted, stale-revision, duplicate, and private-query proposals", () => {
    expect(admitProposedAction(state({ deleted: true }), proposal()).rejectReason).toBe("deleted");
    expect(
      admitProposedAction(state({ basis: { briefRevision: 1, evidenceRevision: 0, consentEpoch: 1, cancellationEpoch: 1, workerLeaseFence: 1 } }), proposal())
        .rejectReason,
    ).toBe("cancelled");
    expect(admitProposedAction(state(), proposal({ briefRevision: 9 })).rejectReason).toBe("stale_revision");
    expect(admitProposedAction(state({ issuedDedupeKeys: ["search:test"] }), proposal()).rejectReason).toBe("duplicate_action");
    expect(
      admitProposedAction(state({ privateCanaries: ["CANARY:SECRET99"] }), proposal({ arguments: { query: "find CANARY:SECRET99" } }))
        .rejectReason,
    ).toBe("private_query_blocked");
  });

  it("admits a well-formed search", () => {
    const d = admitProposedAction(state(), proposal());
    expect(d.type).toBe("search");
    expect(d.rejectReason).toBeUndefined();
  });
});

describe("unknown-dependency correction forces full rerun", () => {
  it("shouldFullRerun is true only when completeness is unknown", () => {
    expect(
      shouldFullRerun(
        impactForCorrection({
          previousConstraints: [],
          nextConstraints: [],
          reopenedDiscovery: false,
          dependencyCompleteness: "unknown",
        }),
      ),
    ).toBe(true);
    expect(
      shouldFullRerun(
        impactForCorrection({
          previousConstraints: [],
          nextConstraints: [],
          reopenedDiscovery: true,
          dependencyCompleteness: "known",
        }),
      ),
    ).toBe(false);
  });
});

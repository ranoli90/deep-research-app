import { describe, expect, it } from "vitest";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import type { ControllerState } from "@deep/research-core";
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
    budgetMicro: 100_000,
    deleted: false,
    privateCanaries: [],
    ...partial,
  };
}

describe("live controller does not loop searches", () => {
  it("searches once when no live sources exist", () => {
    expect(nextLiveAction(state()).type).toBe("search");
  });

  it("fetches a discovered HTTP source instead of searching again", () => {
    const s = state({
      searches: [{ query: "q", sourceFamilyIds: ["a"], newFamilies: 1, coverageProgress: true }],
      sources: [
        {
          id: "s1",
          title: "IONOS",
          locator: "https://cloud.ionos.de/managed/dbaas/postgresql",
          accessLevel: "discovered",
        },
      ],
    });
    const d = nextLiveAction(s);
    expect(d.type).toBe("fetch");
    expect(d.locator).toMatch(/^https:/);
  });

  it("writes after sources have been inspected", () => {
    const s = state({
      searches: [{ query: "q", sourceFamilyIds: ["a"], newFamilies: 1, coverageProgress: true }],
      sources: [
        {
          id: "s1",
          title: "IONOS",
          locator: "https://cloud.ionos.de/managed/dbaas/postgresql",
          accessLevel: "full-text",
        },
      ],
      passages: [
        {
          id: "p1",
          sourceId: "s1",
          sourceVersionId: "v1",
          exactText: "Managed Postgres in Germany",
          locator: "document",
        },
      ],
    });
    expect(nextLiveAction(s).type).toBe("synthesize");
  });
});

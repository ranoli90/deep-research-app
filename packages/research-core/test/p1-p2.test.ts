import { describe, expect, it } from "vitest";
import { calculate } from "../src/calculate.js";
import { extractCandidates } from "../src/candidates.js";
import { compactForContext } from "../src/compact.js";
import { detectGaps } from "../src/gaps.js";
import { canSpendExploration } from "../src/fences.js";
import { passageSupportsClaim } from "../src/support.js";
import { composeReport, repairUnsupportedConclusion, stripUnsafeMarkup } from "../src/report.js";
import { applyCorrectionToConstraints, extractConstraints, inferOutputPreference } from "../src/brief.js";
import { shouldFullRerun, impactForCorrection } from "../src/impact.js";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import type { ControllerState, StoredPassage } from "../src/types.js";

function state(question: string, sources: ControllerState["sources"] = []): ControllerState {
  const constraints = extractConstraints(question);
  const brief = {
    id: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    originalQuestion: question,
    language: "en",
    attachmentIds: [],
    sourceRestrictions: [],
    nonGoals: [],
    constraints,
    assumptions: [],
    budgetPolicyId: "default",
    consentPolicyVersion: CONSENT_POLICY_VERSION,
    revision: 1,
  };
  return {
    runId: "00000000-0000-4000-8000-000000000003",
    brief,
    basis: { briefRevision: 1, evidenceRevision: 0, consentEpoch: 1, cancellationEpoch: 0, workerLeaseFence: 1 },
    phase: "researching",
    sources,
    passages: [],
    claims: [],
    coverage: [{ id: "q1", question, status: "unstarted" }],
    gaps: [],
    searches: [],
    constraints,
    candidates: [],
    spentMicro: 0,
    budgetMicro: 100_000,
    deleted: false,
    privateCanaries: [],
  };
}

describe("V2-01 / P1 gaps", () => {
  it("names a vendor-matrix gap when only review summaries exist for a compatibility question", () => {
    const s = state("Is NimbusDB compatible with Postgres 14?", [
      {
        id: "1",
        title: "blog",
        locator: "x",
        accessLevel: "full-text",
        sourceType: "review-summary",
      },
    ]);
    const gaps = detectGaps(s);
    expect(gaps.some((g) => g.sourceTypeNeeded === "vendor-matrix")).toBe(true);
  });
});

describe("E03 scope qualifiers", () => {
  it("will not let a 65+ study support an unqualified everyone claim", () => {
    expect(
      passageSupportsClaim(
        "This sample enrolled adults over 65 only. The agent was tolerated in that population.",
        "The agent is safe for everyone.",
      ),
    ).toBe("qualifies");
  });
});

describe("S04 markup", () => {
  it("strips script tags from report text", () => {
    expect(stripUnsafeMarkup("ok <script>alert(1)</script> still")).toBe("ok alert(1) still");
  });
});

describe("R22 calculation", () => {
  it("preserves annual-from-monthly formula", () => {
    const r = calculate("annual_from_monthly", [
      { name: "monthly", value: 40, units: "EUR" },
      { name: "months", value: 12, units: "month" },
    ]);
    expect(r.output).toBe(480);
    expect(r.expression).toContain("40");
    expect(r.expression).toContain("12");
  });
});

describe("V2-04 budget parse", () => {
  it("reads 120 not a trailing 0 from 120 EUR", () => {
    const prev = extractConstraints("Compare options in Germany under 50 EUR as of 2026-03-01");
    const { next, reopenedDiscovery } = applyCorrectionToConstraints(prev, "Actually, the budget is 120 EUR");
    expect(next.find((c) => c.field === "budget")?.value).toBe("120");
    expect(reopenedDiscovery).toBe(true);
  });
});

describe("V2-05 dose correction", () => {
  it("updates dose units without reopening budget discovery", () => {
    const prev = extractConstraints("Give 10 g daily");
    const { next, reopenedDiscovery } = applyCorrectionToConstraints(prev, "Actually the dose is 10 milligrams not 10 grams");
    expect(next.find((c) => c.field === "dose")?.units).toBe("mg");
    expect(reopenedDiscovery).toBe(false);
  });
});

describe("V2-06 unknown dependency fallback", () => {
  it("requires a full rerun when completeness is unknown", () => {
    const impact = impactForCorrection({
      previousConstraints: [],
      nextConstraints: [],
      reopenedDiscovery: false,
      dependencyCompleteness: "unknown",
    });
    expect(shouldFullRerun(impact)).toBe(true);
  });
});

describe("candidate prices", () => {
  it("marks a 90 EUR option as violating a 50 EUR hard cap", () => {
    const found = extractCandidates(
      [
        {
          id: "p1",
          exactText: "Vendor B's lowest SKU in Germany is 90 EUR/month as of 2026-03-01, which exceeds a 50 EUR budget.",
        },
      ],
      [{ id: "budget", field: "budget", operator: "lte", value: "50", units: "EUR", origin: "explicit", importance: "hard", explanation: "x" }],
    );
    expect(found.some((c) => c.feasibility === "violates")).toBe(true);
  });
});

describe("R17 output preference", () => {
  it("infers concise vs detailed from the question", () => {
    expect(inferOutputPreference("Give a concise comparison of A and B")).toBe("concise");
    expect(inferOutputPreference("Write a detailed analysis of A and B")).toBe("detailed");
  });
});

describe("R18 context compaction", () => {
  it("keeps hard constraints and passage IDs after dropping extra searches", () => {
    const s = state("Compare options in Germany under 50 EUR as of 2026-03-01");
    s.passages = [
      { id: "p1", sourceId: "s1", sourceVersionId: "v1", exactText: "Vendor A is 40 EUR", locator: "document" },
    ];
    s.searches = [
      { query: "q1", sourceFamilyIds: ["a"], newFamilies: 1, coverageProgress: true },
      { query: "q2", sourceFamilyIds: ["a"], newFamilies: 0, coverageProgress: false },
      { query: "q3", sourceFamilyIds: ["a"], newFamilies: 0, coverageProgress: false },
    ];
    const compact = compactForContext(s);
    expect(compact.constraints.some((c) => c.field === "geography" && c.value.includes("germany"))).toBe(true);
    expect(compact.passageIds).toEqual(["p1"]);
    expect(compact.droppedSearchCount).toBe(1);
  });
});

describe("J10 writing reserve includes finishing cost", () => {
  it("will not spend the last finishing-cost slice on another fetch", () => {
    expect(
      canSpendExploration({
        totalBudgetMicro: 16_000,
        spentPlusReservedMicro: 8_000,
        actionCostMicro: 3_000,
        isFinishingAction: false,
        finishingCostMicro: 8_000,
      }),
    ).toBe(false);
    expect(
      canSpendExploration({
        totalBudgetMicro: 16_000,
        spentPlusReservedMicro: 8_000,
        actionCostMicro: 8_000,
        isFinishingAction: true,
        finishingCostMicro: 8_000,
      }),
    ).toBe(true);
  });
});

describe("E10 critical claim removal", () => {
  it("revisits the conclusion when the answer claim is unsupported", () => {
    const passages: StoredPassage[] = [
      { id: "p1", sourceId: "s1", sourceVersionId: "v1", exactText: "The table lists 24% completion in 2024.", locator: "document" },
    ];
    const blocks = [
      {
        id: "answer",
        kind: "text" as const,
        text: "Completion is 42% this year.",
        claimIds: ["c1"],
        citationIds: ["p1"],
      },
    ];
    const repaired = repairUnsupportedConclusion(blocks, [{ id: "c1", text: "Completion is 42% this year.", type: "fact", supportStatus: "direct", passageIds: ["p1"] }], passages);
    expect(repaired.revisited).toBe(true);
    expect(blocks[0]!.text).toMatch(/withdrawn/i);
  });
});

describe("V2-03 gold-evidence diagnostic", () => {
  it("summaries-only miss the limitation; injecting the matrix recovers it", () => {
    const s = state("Is NimbusDB compatible with Postgres 14?");
    s.passages = [
      {
        id: "sum",
        sourceId: "b1",
        sourceVersionId: "v1",
        exactText: "This summary says NimbusDB is compatible with all Postgres versions. It cites no matrix.",
        locator: "document",
      },
    ];
    s.sources = [{ id: "b1", title: "recap", locator: "fixture://blogs/nimbus-1", accessLevel: "full-text", sourceType: "review-summary" }];
    const without = composeReport(s, "00000000-0000-4000-8000-000000000010");
    expect(JSON.stringify(without.blocks)).not.toMatch(/not compatible with Postgres 14/);

    s.passages.push({
      id: "gold",
      sourceId: "m1",
      sourceVersionId: "v2",
      exactText: "NimbusDB compatibility matrix: not compatible with Postgres 14. Requires Postgres 15 or later.",
      locator: "document",
    });
    s.sources.push({ id: "m1", title: "matrix", locator: "fixture://vendor/nimbus-matrix", accessLevel: "full-text", sourceType: "vendor-matrix" });
    const withGold = composeReport(s, "00000000-0000-4000-8000-000000000011");
    expect(JSON.stringify(withGold.blocks)).toMatch(/not compatible with Postgres 14/);
  });
});

describe("V2-19 unread scanned table", () => {
  it("does not guess a scanned table and names extract_table as unavailable", () => {
    const s = state("What does the unreadable scanned table say about compatibility?");
    s.passages = [
      {
        id: "scan",
        sourceId: "t1",
        sourceVersionId: "v1",
        exactText:
          "The decisive compatibility cell exists only in an unreadable scanned table. extract_table is unavailable. This page remains unread as a table; text parsing did not recover the cell.",
        locator: "document",
      },
    ];
    s.sources = [
      { id: "t1", title: "scan", locator: "fixture://scan/table", accessLevel: "full-text", sourceType: "vendor-docs" },
    ];
    const report = composeReport(s, "00000000-0000-4000-8000-000000000019");
    expect(JSON.stringify(report.blocks)).toMatch(/unread|scanned table|extract_table/i);
    expect(JSON.stringify(report.blocks)).not.toMatch(/therefore compatible/i);
  });
});

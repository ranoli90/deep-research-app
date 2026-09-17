import { describe, expect, it } from "vitest";
import { calculate } from "../src/calculate.js";
import { extractCandidates } from "../src/candidates.js";
import { compactForContext } from "../src/compact.js";
import { detectGaps } from "../src/gaps.js";
import { canSpendExploration } from "../src/fences.js";
import { passageSupportsClaim } from "../src/support.js";
import { blocksToMarkdown, composeReport, goldEvidenceDiagnostic, repairUnsupportedConclusion, stripUnsafeMarkup } from "../src/report.js";
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

describe("JOB-1 platform constraints", () => {
  it("marks NoteDroid ineligible for missing iPhone and NoteKeep eligible", () => {
    const q = "Compare note-taking apps with offline editing, Android and iPhone support, and full export required.";
    const constraints = extractConstraints(q);
    expect(constraints.map((c) => `${c.field}=${c.value}`).sort()).toEqual(
      expect.arrayContaining(["platform=iphone", "platform=android", "feature=offline", "feature=export"]),
    );
    const found = extractCandidates(
      [
        { id: "p1", exactText: "NoteKeep: iPhone, Android, offline editing, and full export are supported. Linux is not supported." },
        { id: "p2", exactText: "NoteDroid: Android, Linux, offline editing, and full export are supported. iPhone is not supported." },
        { id: "p3", exactText: "NoteAll: iPhone, Android, Linux, offline editing, and full export are supported." },
      ],
      constraints,
    );
    expect(found.find((c) => c.identity === "NoteKeep")?.feasibility).toBe("satisfies");
    expect(found.find((c) => c.identity === "NoteDroid")?.feasibility).toBe("violates");
    expect(found.find((c) => c.identity === "NoteDroid")?.excludedBy).toMatch(/iphone/i);
    expect(found.find((c) => c.identity === "NoteAll")?.feasibility).toBe("satisfies");
  });

  it("adding Linux as a correction excludes NoteKeep", () => {
    const q = "Compare note-taking apps with offline editing, Android and iPhone support, and full export required.";
    const applied = applyCorrectionToConstraints(extractConstraints(q), "Linux is also required");
    expect(applied.next.some((c) => c.field === "platform" && c.value === "linux")).toBe(true);
    expect(applied.reopenedDiscovery).toBe(false);
    const found = extractCandidates(
      [
        { id: "p1", exactText: "NoteKeep: iPhone, Android, offline editing, and full export are supported. Linux is not supported." },
        { id: "p2", exactText: "NoteDroid: Android, Linux, offline editing, and full export are supported. iPhone is not supported." },
        { id: "p3", exactText: "NoteAll: iPhone, Android, Linux, offline editing, and full export are supported." },
      ],
      applied.next,
    );
    expect(found.find((c) => c.identity === "NoteKeep")?.feasibility).toBe("violates");
    expect(found.find((c) => c.identity === "NoteKeep")?.excludedBy).toMatch(/linux/i);
    expect(found.find((c) => c.identity === "NoteAll")?.feasibility).toBe("satisfies");
  });
});

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

describe("V2-03 gold-evidence diagnostic", () => {
  it("records retrieval as the bottleneck when only the injected matrix passage surfaces the limitation", () => {
    const question = "Is NimbusDB compatible with Postgres 14?";
    const without = state(question, [
      {
        id: "review",
        title: "blog roundup",
        locator: "fixture://reviews/nimbus",
        accessLevel: "full-text",
        sourceType: "review-summary",
      },
    ]);
    without.passages = [
      {
        id: "p-review",
        sourceId: "review",
        sourceVersionId: "v-review",
        exactText: "Many reviewers say NimbusDB works great with Postgres. Five summaries agree.",
        locator: "document",
      },
    ];
    const withGold = state(question, [
      ...without.sources,
      {
        id: "matrix",
        title: "vendor matrix",
        locator: "fixture://nimbus/matrix",
        accessLevel: "full-text",
        sourceType: "vendor-matrix",
      },
    ]);
    withGold.passages = [
      ...without.passages,
      {
        id: "p-gold",
        sourceId: "matrix",
        sourceVersionId: "v-gold",
        exactText: "NimbusDB is not compatible with Postgres 14 according to the vendor compatibility matrix.",
        locator: "matrix-row",
      },
    ];
    expect(detectGaps(without).some((g) => g.sourceTypeNeeded === "vendor-matrix")).toBe(true);
    expect(detectGaps(withGold).some((g) => g.sourceTypeNeeded === "vendor-matrix")).toBe(false);
    const diag = goldEvidenceDiagnostic({
      withoutGold: without,
      withGold,
      limitationPattern: /not compatible|incompatible/i,
      reportIdWithout: "00000000-0000-4000-8000-0000000000aa",
      reportIdWith: "00000000-0000-4000-8000-0000000000bb",
    });
    expect(diag.withoutGoldUsesLimitation).toBe(false);
    expect(diag.withGoldUsesLimitation).toBe(true);
    expect(diag.bottleneck).toBe("retrieval");
    expect(JSON.stringify(composeReport(without, "00000000-0000-4000-8000-0000000000aa").blocks)).not.toMatch(
      /certified compatible from \d+ summaries/i,
    );
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

  it("does not treat a known candidate-space reopen as a full rerun", () => {
    const impact = impactForCorrection({
      previousConstraints: [
        { id: "budget", field: "budget", operator: "lte", value: "50", units: "EUR", origin: "explicit", importance: "hard", explanation: "x" },
      ],
      nextConstraints: [
        { id: "budget", field: "budget", operator: "lte", value: "120", units: "EUR", origin: "explicit", importance: "hard", explanation: "x" },
      ],
      reopenedDiscovery: true,
      dependencyCompleteness: "known",
    });
    expect(impact.reopenedDiscoveryScopes).toContain("candidate-discovery");
    expect(shouldFullRerun(impact)).toBe(false);
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
    expect(blocks[0]!.claimIds).toEqual([]);
  });

  it("composeReport withdraws a question-asserted 42% that the 24% table does not support", () => {
    const s = state("Confirm the 42% completion figure from the 2024 table");
    s.passages = [
      {
        id: "p-table",
        sourceId: "s1",
        sourceVersionId: "v1",
        exactText: "The official table lists 24% completion in 2024. Units are percent of assigned tasks in that calendar year.",
        locator: "document",
      },
    ];
    s.sources = [{ id: "s1", title: "table", locator: "fixture://table/completion-2024", accessLevel: "full-text" }];
    const report = composeReport(s, "00000000-0000-4000-8000-000000000099");
    const answer = report.blocks.find((b) => b.id === "answer");
    expect(answer?.text).toMatch(/withdrawn/i);
    expect(answer?.kind).toBe("caveat");
    expect(JSON.stringify(report.limitations)).toMatch(/critical claim was removed/i);
    expect(JSON.stringify(report.blocks)).toMatch(/24%/);
    expect(answer?.text).not.toMatch(/Completion is 42%/);
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

describe("E09 markdown export", () => {
  it("emits tables, fenced code, unicode, and 8-char citation prefixes", () => {
    const md = blocksToMarkdown([
      {
        id: "answer",
        kind: "text",
        text: "Café 漢字 eligible.",
        claimIds: [],
        citationIds: ["aaaaaaaa-1111-4000-8000-000000000001"],
      },
      {
        id: "comparison-table",
        kind: "table",
        text: "Vendor | Price\nVendor A | 40 EUR\nVendor C | 70 EUR",
        claimIds: [],
        citationIds: ["bbbbbbbb-1111-4000-8000-000000000002"],
      },
      {
        id: "listing",
        kind: "code",
        text: "Vendor C  70 EUR",
        claimIds: [],
        citationIds: [],
      },
    ]);
    expect(md).toMatch(/Café 漢字/);
    expect(md).toMatch(/\| Vendor \| Price \|/);
    expect(md).toMatch(/\| Vendor C \| 70 EUR \|/);
    expect(md).toMatch(/```\nVendor C  70 EUR\n```/);
    expect(md).toMatch(/\[aaaaaaaa\]/);
    expect(md).toMatch(/\[bbbbbbbb\]/);
    expect(md).not.toMatch(/pdf/i);
  });
});

describe("M08 follow-up change summary", () => {
  it("emits a follow-up change summary without reopening discovery", () => {
    const s = state("Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01\n\nFollow-up: verify only claim-primary. Verify the answer claim only");
    s.passages = [
      {
        id: "pa",
        sourceId: "sa",
        sourceVersionId: "va",
        exactText: "Vendor A costs 40 EUR in Germany for managed Postgres.",
        locator: "document",
      },
    ];
    s.sources = [{ id: "sa", title: "A", locator: "fixture://vendor-a/pricing-de", accessLevel: "full-text", sourceType: "vendor-docs" }];
    const report = composeReport(s, "00000000-0000-4000-8000-000000000080");
    expect(report.changeSummary?.conclusionChanged).toBe(false);
    expect(report.changeSummary?.notes).toMatch(/without reopening candidate discovery/);
  });
});

describe("M04 comparison table and code listing", () => {
  it("emits a wide table and code listing from extracted vendors", () => {
    const s = state("Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    s.passages = [
      {
        id: "pa",
        sourceId: "sa",
        sourceVersionId: "va",
        exactText: "Vendor A costs 40 EUR in Germany for managed Postgres.",
        locator: "document",
      },
      {
        id: "pb",
        sourceId: "sb",
        sourceVersionId: "vb",
        exactText: "Vendor B costs 40 EUR and is only in us-east, not Germany.",
        locator: "document",
      },
    ];
    s.sources = [
      { id: "sa", title: "A", locator: "fixture://vendor-a/pricing-de", accessLevel: "full-text", sourceType: "vendor-docs" },
      { id: "sb", title: "B", locator: "fixture://vendor-b/pricing-us", accessLevel: "full-text", sourceType: "vendor-docs" },
    ];
    const report = composeReport(s, "00000000-0000-4000-8000-000000000040");
    const table = report.blocks.find((b) => b.kind === "table");
    const code = report.blocks.find((b) => b.kind === "code");
    expect(table?.id).toBe("comparison-table");
    expect(table?.text.split("\n")[0]).toMatch(/Vendor \| Region \| Price/);
    expect(table?.text).toMatch(/Vendor A/);
    expect(table?.text).toMatch(/Vendor B/);
    expect(table?.citationIds.length).toBeGreaterThan(1);
    expect(code?.id).toBe("candidate-listing");
    expect(code?.text).toMatch(/fixture:\/\/vendor-a\/pricing-de/);
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

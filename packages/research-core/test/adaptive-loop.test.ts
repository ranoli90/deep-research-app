import { describe, expect, it } from "vitest";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import { admitProposedAction } from "../src/admission.js";
import { extractConstraints } from "../src/brief.js";
import { tryCalculate } from "../src/calculate.js";
import { validateMaterialCitations } from "../src/citations.js";
import { proposeControllerAction } from "../src/controller.js";
import { detectContradictions } from "../src/contradictions.js";
import { evaluateDisconfirmation } from "../src/disconfirm.js";
import { detectGaps } from "../src/gaps.js";
import { applyFetchedDocument, applySearchHits, recordCompletedAction, refreshDerived } from "../src/loop.js";
import { evaluateStop } from "../src/stop.js";
import { composeReport } from "../src/report.js";
import { applyCorrectionToConstraints } from "../src/brief.js";
import { impactForCorrection, shouldFullRerun } from "../src/impact.js";
import type { ControllerState, PolicyDecision } from "../src/types.js";

function state(question: string): ControllerState {
  const constraints = extractConstraints(question);
  const brief = {
    id: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    originalQuestion: question,
    language: "en",
    attachmentIds: [] as string[],
    sourceRestrictions: [] as string[],
    nonGoals: [] as string[],
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
    sources: [],
    passages: [],
    claims: [],
    coverage: [{ id: "primary", question, status: "unstarted" }],
    gaps: [],
    searches: [],
    constraints,
    candidates: [],
    spentMicro: 0,
    budgetMicro: 100_000,
    deleted: false,
    privateCanaries: [],
    issuedDedupeKeys: [],
    completedActionTypes: [],
    actionHistory: [],
    controllerVersion: "research-controller.v1",
  };
}

function applyDecision(s: ControllerState, d: PolicyDecision): void {
  s.issuedDedupeKeys = [...(s.issuedDedupeKeys ?? []), d.dedupeKey];
  s.actionHistory = [
    ...(s.actionHistory ?? []),
    {
      type: d.type,
      rationale: d.rationale,
      selectionReason: String(d.arguments.selectionReason ?? d.rationale),
      pivotReason: d.arguments.pivotReason ? String(d.arguments.pivotReason) : undefined,
      gapId: d.gapId,
      atEvidenceRevision: s.basis.evidenceRevision,
    },
  ];
  if (d.arguments.pivot) s.lastPivotReason = String(d.arguments.pivotReason ?? d.rationale);
}

describe("adaptive closed loop — evidence causes the next action to change", () => {
  it("weak summaries open a gap, pivot source type, then contradiction triggers verify/disconfirm, then evidence-aware stop", () => {
    const question = "Is NimbusDB compatible with Postgres 14?";
    const s = state(question);
    const trace: Record<string, unknown>[] = [];

    const a0 = proposeControllerAction(s, "adaptive");
    applyDecision(s, a0);
    expect(a0.type).toBe("search");
    trace.push({ step: 0, type: a0.type, selectionReason: a0.arguments.selectionReason, query: a0.arguments.query, pivot: a0.arguments.pivot });

    applySearchHits(s, String(a0.arguments.query ?? question), [
      {
        locator: "fixture://blogs/nimbus-1",
        title: "Roundup",
        originCluster: "nimbus-hype",
        sourceType: "review-summary",
        snippet: "NimbusDB is compatible with all Postgres versions.",
      },
      {
        locator: "fixture://blogs/nimbus-2",
        title: "Recap",
        originCluster: "nimbus-hype",
        sourceType: "review-summary",
        snippet: "Commentators repeat compatibility.",
      },
    ]);
    s.basis.evidenceRevision += 1;
    s.spentMicro += 5_000;
    s.coverage = s.coverage.map((c) => ({ ...c, status: "investigating" }));
    refreshDerived(s);
    expect(s.gaps.some((g) => g.sourceTypeNeeded === "vendor-matrix" && g.importance === "blocking")).toBe(true);

    const a1 = proposeControllerAction(s, "adaptive");
    applyDecision(s, a1);
    trace.push({
      step: 1,
      type: a1.type,
      pivot: a1.arguments.pivot,
      sourceTypeNeeded: a1.arguments.sourceTypeNeeded,
      selectionReason: a1.arguments.selectionReason,
      pivotReason: a1.arguments.pivotReason ?? a1.rationale,
      gapId: a1.gapId,
    });
    expect(a1.type === "search" || a1.type === "fetch").toBe(true);
    if (a1.type === "fetch") {
      applyFetchedDocument(s, {
        locator: String(a1.arguments.locator),
        text: "This summary says NimbusDB is compatible with all Postgres versions. It cites no matrix.",
        accessLevel: "full-text",
        sourceType: "review-summary",
      });
      s.basis.evidenceRevision += 1;
      const a1b = proposeControllerAction(s, "adaptive");
      applyDecision(s, a1b);
      trace.push({
        step: 1.5,
        type: a1b.type,
        pivot: a1b.arguments.pivot,
        sourceTypeNeeded: a1b.arguments.sourceTypeNeeded,
        selectionReason: a1b.arguments.selectionReason,
        pivotReason: a1b.arguments.pivotReason ?? a1b.rationale,
        gapId: a1b.gapId,
      });
      expect(a1b.arguments.pivot).toBe(true);
      expect(String(a1b.arguments.sourceTypeNeeded)).toBe("vendor-matrix");
      Object.assign(a1, a1b);
    } else {
      expect(a1.arguments.pivot).toBe(true);
    }
    expect(String(a1.arguments.sourceTypeNeeded)).toBe("vendor-matrix");
    expect(a1.gapId).toBeTruthy();
    expect(String(a1.rationale + JSON.stringify(a1.arguments))).toMatch(/gap|matrix|source type|primary/i);

    applySearchHits(s, String(a1.arguments.query ?? ""), [
      {
        locator: "fixture://vendor/nimbus-matrix",
        title: "Official matrix",
        originCluster: "nimbus-matrix",
        sourceType: "vendor-matrix",
        snippet: "Postgres 14 is not supported.",
      },
    ]);
    s.basis.evidenceRevision += 1;

    let safety = 0;
    let fetchedMatrix = false;
    while (safety++ < 10) {
      const d = proposeControllerAction(s, "adaptive");
      applyDecision(s, d);
      trace.push({ step: trace.length, type: d.type, selectionReason: d.arguments.selectionReason, rationale: d.rationale });
      if (d.type === "fetch") {
        const locator = String(d.arguments.locator);
        if (locator.includes("nimbus-matrix")) {
          applyFetchedDocument(s, {
            locator,
            text: "NimbusDB compatibility matrix: not compatible with Postgres 14. Requires Postgres 15 or later. Summary blogs that claim universal compatibility are incorrect for version 14.",
            accessLevel: "full-text",
            sourceType: "vendor-matrix",
          });
          fetchedMatrix = true;
          refreshDerived(s);
          const afterGold = s.gaps.find((g) => g.id === "compat-primary");
          expect(afterGold?.resolution).toBe("resolved");
          expect(afterGold?.latestOutcome).toBe("resolved");
          expect(afterGold?.importance).not.toBe("blocking");
        } else {
          applyFetchedDocument(s, {
            locator,
            text: "This summary says NimbusDB is compatible with all Postgres versions. It cites no matrix.",
            accessLevel: "full-text",
            sourceType: "review-summary",
          });
        }
        s.basis.evidenceRevision += 1;
        continue;
      }
      if (d.type === "verify") {
        recordCompletedAction(s, "verify");
        refreshDerived(s);
        const contr = detectContradictions(s);
        expect(contr.some((c) => c.dimension === "compatibility" || c.dimension === "version")).toBe(true);
        expect(contr.every((c) => c.possibleExplanation.length > 0)).toBe(true);
        expect(JSON.stringify(contr)).not.toMatch(/newest source is correct/i);
        continue;
      }
      if (d.type === "challenge" && d.arguments.query && !d.arguments.recordOnly) {
        applySearchHits(s, String(d.arguments.query), [
          {
            locator: "fixture://vendor/nimbus-matrix",
            title: "Official matrix",
            originCluster: "nimbus-matrix",
            sourceType: "vendor-matrix",
            snippet: "Postgres 14 is not supported.",
          },
        ]);
        s.basis.evidenceRevision += 1;
        continue;
      }
      if (d.type === "challenge") {
        recordCompletedAction(s, "challenge");
        const planned = {
          id: "d1",
          targetConclusion: "NimbusDB is not compatible with Postgres 14",
          falsificationHypothesis: "Official matrix lists Postgres 14 as supported",
          searchStrategy: String(d.arguments.searchStrategy ?? d.arguments.query ?? ""),
          result: "untried" as const,
          counterevidenceFound: false,
          impact: "pending",
        };
        s.disconfirmations = [evaluateDisconfirmation(s, planned)];
        continue;
      }
      if (d.type === "search" && d.arguments.disconfirm) {
        applySearchHits(s, String(d.arguments.query ?? ""), []);
        s.basis.evidenceRevision += 1;
        continue;
      }
      if (d.type === "synthesize" || d.type === "stop") {
        const policy = String(d.arguments.stopPolicy ?? d.arguments.reason ?? "");
        if (d.rejectReason === "duplicate_action") {
          refreshDerived(s);
          const stop = evaluateStop(s);
          expect(stop.stopPolicy).toMatch(/evidence_sufficient_or_low_decision_value|low_decision_value/);
          expect(stop.stopPolicy).not.toBe("inaccessible_or_unresolved_gap");
          s.stopReason = stop.stopPolicy;
          break;
        }
        expect(policy).not.toMatch(/searched \d+ times|search_count|search quota|inaccessible_or_unresolved_gap/i);
        expect(policy).toMatch(/evidence_sufficient_or_low_decision_value|low_decision_value/);
        s.stopReason = policy;
        break;
      }
      recordCompletedAction(s, d.type);
    }

    if (!s.stopReason) {
      refreshDerived(s);
      const stop = evaluateStop(s);
      expect(stop.shouldStop).toBe(true);
      expect(stop.stopPolicy).toMatch(/evidence_sufficient_or_low_decision_value|low_decision_value/);
      expect(stop.stopPolicy).not.toBe("inaccessible_or_unresolved_gap");
      s.stopReason = stop.stopPolicy;
    }

    expect(fetchedMatrix).toBe(true);
    expect(trace.some((t) => t.pivot === true || String(t.sourceTypeNeeded ?? "") === "vendor-matrix")).toBe(true);
    expect(trace.some((t) => t.type === "verify" || t.type === "challenge")).toBe(true);
    expect(trace.some((t) => t.type === "synthesize" || t.type === "stop")).toBe(true);

    const report = composeReport(s, "00000000-0000-4000-8000-000000000099");
    expect(JSON.stringify(report.blocks)).toMatch(/not compatible with Postgres 14/i);
    expect(JSON.stringify(report.blocks)).toMatch(/FACT:|INFERENCE:|UNCERTAINTY:/);
    expect(JSON.stringify(report.blocks)).toMatch(/not automatically correct|Unresolved disagreement|Scope-explained/i);
    expect(JSON.stringify(report.blocks)).toMatch(/not proof/i);

    const machineTrace = {
      task: question,
      controllerVersion: "research-controller.v1",
      questions: s.questions,
      gaps: s.gaps,
      actions: trace,
      sources: s.sources.map((x) => ({ locator: x.locator, sourceType: x.sourceType, accessLevel: x.accessLevel })),
      claims: s.claims,
      contradictions: s.contradictions ?? detectContradictions(s),
      disconfirmations: s.disconfirmations,
      stopReason: s.stopReason,
      cost: s.spentMicro,
    };
    expect(machineTrace.actions.length).toBeGreaterThan(3);
    expect(String(JSON.stringify(machineTrace))).toMatch(/vendor-matrix/);
    const finalCompat = (s.gaps.find((g) => g.id === "compat-primary") ?? detectGaps(s).find((g) => g.id === "compat-primary"));
    expect(finalCompat?.resolution).toBe("resolved");
    expect(String(s.stopReason)).toMatch(/evidence_sufficient|low_decision_value/);
    expect(String(s.stopReason)).not.toMatch(/inaccessible_or_unresolved_gap/);
  });
});

describe("detectGaps replaces stale rows when evidence changes", () => {
  it("resolves a previously untried compat-primary after an opened vendor-matrix is present", () => {
    const s = state("Is NimbusDB compatible with Postgres 14?");
    s.gaps = [
      {
        id: "compat-primary",
        missingFact: "authoritative compatibility limitation",
        whyItCouldChangeAnswer: "Summary count cannot certify compatibility",
        importance: "blocking",
        sourceTypeNeeded: "vendor-matrix",
        latestOutcome: "untried",
        resolution: "open",
      },
    ];
    s.sources = [
      { id: "sum", title: "blog", locator: "fixture://blogs/nimbus-1", accessLevel: "full-text", sourceType: "review-summary" },
      { id: "mat", title: "matrix", locator: "fixture://vendor/nimbus-matrix", accessLevel: "full-text", sourceType: "vendor-matrix" },
    ];
    s.passages = [
      {
        id: "p-mat",
        sourceId: "mat",
        sourceVersionId: "v1",
        exactText: "NimbusDB compatibility matrix: not compatible with Postgres 14.",
        locator: "document",
      },
    ];
    const next = detectGaps(s);
    const gap = next.find((g) => g.id === "compat-primary");
    expect(gap?.resolution).toBe("resolved");
    expect(gap?.latestOutcome).toBe("resolved");
    expect(gap?.importance).toBe("material");
  });
});

describe("geography is verified from opened evidence, not the search query", () => {
  it("does not treat queryWithGeography as proof when opened pages omit the jurisdiction", () => {
    const s = state("Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    s.searches = [
      {
        query: "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01",
        sourceFamilyIds: ["example"],
        newFamilies: 1,
        coverageProgress: true,
      },
    ];
    s.sources = [
      {
        id: "s1",
        title: "Pricing",
        locator: "https://example.com/managed-postgres",
        accessLevel: "full-text",
        sourceType: "vendor-docs",
      },
    ];
    s.passages = [
      {
        id: "p1",
        sourceId: "s1",
        sourceVersionId: "v1",
        exactText: "Managed Postgres from 40 EUR per month in eu-central-1. Region SKUs are listed without a country name.",
        locator: "document",
      },
    ];
    const geo = detectGaps(s).find((g) => g.id === "geo-unverified");
    expect(geo).toBeTruthy();
    expect(geo?.resolution).not.toBe("resolved");
    expect(geo?.latestOutcome).not.toBe("resolved");
    expect(String(geo?.remainingUncertainty)).toMatch(/search query is not verification|do not mention/i);
  });
});

describe("deterministic calculation missing input", () => {
  it("stays unknown when monthly is missing", () => {
    const outcome = tryCalculate("annual_from_monthly", []);
    expect(outcome.status).toBe("unknown");
    if (outcome.status === "unknown") {
      expect(outcome.missing).toContain("monthly");
    }
  });
});

describe("citation validation rejects bad material citations", () => {
  it("flags unknown, unowned, wrong-version, unsupported, and overstrong claims", () => {
    const passages = [
      {
        id: "p-owned",
        sourceId: "s1",
        sourceVersionId: "v1",
        exactText: "This sample enrolled adults over 65 only. The agent was tolerated in that population.",
        locator: "document",
      },
    ];
    const v = validateMaterialCitations({
      blocks: [
        { id: "a", kind: "text", text: "The agent is safe for everyone.", claimIds: ["c1"], citationIds: ["p-owned", "p-missing"] },
        { id: "b", kind: "text", text: "Widget 4 costs 19.99 EUR.", claimIds: ["c2"], citationIds: ["p-other"] },
      ],
      claims: [
        { id: "c1", text: "The agent is safe for everyone.", type: "external-fact", supportStatus: "direct", passageIds: ["p-owned"] },
        { id: "c2", text: "Widget 4 costs 19.99 EUR.", type: "external-fact", supportStatus: "direct", passageIds: ["p-owned"] },
      ],
      passages,
      runPassageIds: new Set(["p-owned"]),
      currentVersionBySource: new Map([["s1", "v2"]]),
    });
    expect(v.unknownIds).toContain("p-missing");
    expect(v.wrongVersion.length).toBeGreaterThan(0);
    expect(v.unsupported.length + v.overstrong.length).toBeGreaterThan(0);
  });
});

describe("contradictions do not treat newest as correct", () => {
  it("records an unresolved compatibility conflict with a scope explanation", () => {
    const s = state("Is NimbusDB compatible with Postgres 14?");
    s.sources = [
      { id: "s-sum", title: "blog", locator: "fixture://blogs/nimbus-1", accessLevel: "full-text", sourceType: "review-summary" },
      { id: "s-mat", title: "matrix", locator: "fixture://vendor/nimbus-matrix", accessLevel: "full-text", sourceType: "vendor-matrix" },
    ];
    s.passages = [
      { id: "p1", sourceId: "s-sum", sourceVersionId: "v1", exactText: "This summary says NimbusDB is compatible with all Postgres versions.", locator: "d" },
      { id: "p2", sourceId: "s-mat", sourceVersionId: "v2", exactText: "NimbusDB compatibility matrix: not compatible with Postgres 14. Requires Postgres 15 or later.", locator: "d" },
    ];
    const found = detectContradictions(s);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.resolutionStatus).not.toBe(undefined);
    expect(found[0]!.possibleExplanation.length).toBeGreaterThan(10);
    expect(JSON.stringify(found)).not.toMatch(/newest wins|newest is correct/i);
  });
});

describe("opened public evidence does not trigger unbounded discovery search", () => {
  it("does not issue another generic search after full-text public sources exist and no blocking gap remains", () => {
    const s = state("Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    s.searches = [
      {
        query: "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01",
        sourceFamilyIds: ["ionos.de"],
        newFamilies: 1,
        coverageProgress: true,
      },
    ];
    s.sources = [
      {
        id: "s1",
        title: "IONOS",
        locator: "https://cloud.ionos.de/managed/dbaas/postgresql",
        accessLevel: "full-text",
        sourceType: "web",
      },
    ];
    s.passages = [
      {
        id: "p1",
        sourceId: "s1",
        sourceVersionId: "v1",
        exactText: "Managed PostgreSQL in Frankfurt. Startup instances from 40 EUR per month as of 2026-03-01.",
        locator: "document",
      },
    ];
    s.coverage = [{ id: "primary", question: s.brief.originalQuestion, status: "supported" }];
    s.completedActionTypes = ["challenge"];
    s.disconfirmations = [
      {
        id: "d1",
        targetConclusion: "Eligible under hard constraints: none listed",
        falsificationHypothesis: "x",
        searchStrategy: "y",
        result: "no_counterexample_found",
        counterevidenceFound: false,
        impact: "No counterexample found is not proof.",
      },
    ];
    refreshDerived(s);
    const d = proposeControllerAction(s, "adaptive");
    expect(d.type).not.toBe("search");
    expect(["synthesize", "stop", "verify", "challenge"]).toContain(d.type);
    if (d.type === "synthesize" || d.type === "stop") {
      expect(String(d.arguments.stopPolicy ?? "")).not.toBe("inaccessible_or_unresolved_gap");
    }
  });
});

describe("stop policy is evidence-aware", () => {
  it("does not synthesize with inaccessible_or_unresolved_gap while a tryable blocking gap remains", () => {
    const s = state("Is NimbusDB compatible with Postgres 14?");
    s.sources = [
      { id: "sum", title: "blog", locator: "fixture://blogs/nimbus-1", accessLevel: "full-text", sourceType: "review-summary" },
    ];
    s.passages = [
      {
        id: "p1",
        sourceId: "sum",
        sourceVersionId: "v1",
        exactText: "This summary says NimbusDB is compatible with all Postgres versions.",
        locator: "document",
      },
    ];
    s.coverage = [{ id: "primary", question: s.brief.originalQuestion, status: "supported" }];
    s.searches = [{ query: "Is NimbusDB compatible with Postgres 14?", sourceFamilyIds: ["nimbus-hype"], newFamilies: 1, coverageProgress: true }];
    refreshDerived(s);
    const d = proposeControllerAction(s, "adaptive");
    expect(d.type).not.toBe("synthesize");
    expect(d.type).not.toBe("stop");
    expect(String(d.arguments.stopPolicy ?? "")).not.toBe("inaccessible_or_unresolved_gap");
    expect(d.arguments.pivot === true || d.type === "search" || d.type === "fetch").toBe(true);
  });

  it("does not stop merely because a search count quota was hit when a blocking gap is still tryable", () => {
    const s = state("Is NimbusDB compatible with Postgres 14?");
    s.sources = [{ id: "s1", title: "blog", locator: "x", accessLevel: "full-text", sourceType: "review-summary" }];
    refreshDerived(s);
    const stop = evaluateStop(s);
    expect(stop.reason).not.toMatch(/search_count|searched \d+/);
    expect(stop.shouldStop === false || stop.stopPolicy !== "search_count").toBe(true);
  });
});

describe("correction impact reuses unaffected evidence", () => {
  it("budget 50 → 120 invalidates eligibility and does not full-rerun when completeness is known", () => {
    const prev = extractConstraints("Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    const next = applyCorrectionToConstraints(prev, "Actually, the budget is 120 EUR");
    const impact = impactForCorrection({
      previousConstraints: prev,
      nextConstraints: next.next,
      reopenedDiscovery: next.reopenedDiscovery,
      dependencyCompleteness: "known",
      claims: [{ id: "c-elig", text: "Vendor C violates budget", type: "external-fact", supportStatus: "direct", passageIds: ["p1"] }],
      reusablePassageIds: ["p1"],
    });
    expect(impact.changedInputs).toContain("budget");
    expect(impact.reusedEvidenceIds).toContain("p1");
    expect(shouldFullRerun(impact)).toBe(false);
  });

  it("unknown completeness still forces a full rerun", () => {
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
  });
});

describe("admission rejects adversarial synthesize and unsafe fetch", () => {
  it("rejects synthesize while a blocking gap is untried", () => {
    const s = state("Is NimbusDB compatible with Postgres 14?");
    s.gaps = [
      {
        id: "compat-primary",
        missingFact: "authoritative compatibility limitation",
        whyItCouldChangeAnswer: "x",
        importance: "blocking",
        suggestedQuery: "vendor compatibility matrix",
        latestOutcome: "untried",
      },
    ];
    const d = admitProposedAction(s, {
      actionId: "a",
      runId: s.runId,
      briefRevision: 1,
      type: "synthesize",
      coverageIds: [],
      arguments: {},
      rationale: "looks done",
      estimatedMaxCostMicro: 8000,
      sourceAccessConstraints: [],
      dedupeKey: "synth",
      privileged: false,
    });
    expect(d.rejectReason).toBe("blocking_gap_open");
  });

  it("rejects file:// and localhost fetch locators", () => {
    const s = state("x");
    const d = admitProposedAction(s, {
      actionId: "a",
      runId: s.runId,
      briefRevision: 1,
      type: "fetch",
      coverageIds: [],
      arguments: { locator: "file:///etc/passwd" },
      rationale: "open",
      estimatedMaxCostMicro: 0,
      sourceAccessConstraints: [],
      dedupeKey: "fetch-bad",
      privileged: false,
    });
    expect(d.rejectReason).toBe("unsafe_url");
  });
});

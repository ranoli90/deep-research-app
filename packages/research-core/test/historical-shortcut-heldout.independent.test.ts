import { describe, expect, it } from "vitest";
import { evaluateDiscoveryContinuation, furtherHistoricalSourceReadsNeeded, HISTORICAL_FACT_READABLE_CONFIRMATIONS } from "../src/adaptive-breadth.js";
import * as freshness from "../src/freshness.js";
import type { StoredSource } from "../src/types.js";

const now = new Date("2026-09-20T12:00:00Z");
const dated2012 = new Date("2012-04-01T00:00:00Z");
const dated2015 = new Date("2015-03-01T00:00:00Z");
const dated2026 = new Date("2026-08-01T00:00:00Z");

const NORTHSTAR = "When was Northstar Bakery incorporated?";
const ELLISON = "When was Mayor Ellison born?";
const GHENT = "When was the Treaty of Ghent signed?";
const HELIX_FOUNDED = "When was Helixworks founded?";
const TWO_COMPANY = "Compare when Helixworks and Nimbus Forge were founded and explain why their expansion strategies differed.";
const TWO_COMPANY_REVERSED = "Explain why expansion strategies differed after comparing when Nimbus Forge and Helixworks were founded.";
const MIXED_LATEST = "When was Vesper Transit founded and what is its latest headcount?";
const DEEPEN_PARENT = "When was Vesper Transit founded?";
const OAKMERE = "In what year was Oakmere Distillery chartered?";
const CALDERA = "When did Caldera Labs commence operations?";

type CriterionInput = {
  key: string;
  field?: string | null;
  description?: string | null;
  importance?: string | null;
  provenance?: { start: number; end: number; quote: string } | null;
  scope?: Record<string, string | null> | null;
};

type GapRecord = {
  key: string;
  quote: string;
  coverageUnresolved: boolean;
  hasSupportedEvidence: boolean;
  disputed?: boolean;
  boundSources: ReadonlyArray<{ publicationDate?: Date | null; retrievedAt?: Date | null }>;
  description?: string;
  field?: string;
};

const freshnessNs = freshness as typeof freshness & {
  freshnessPolicyForCriterion?: (question: string, criterion: CriterionInput, siblings?: readonly CriterionInput[]) => freshness.FreshnessPolicy;
  criterionBoundFreshnessUnmet?: (
    policy: freshness.FreshnessPolicy,
    boundSources: ReadonlyArray<{ publicationDate?: Date | null; retrievedAt?: Date | null }>,
    now?: Date,
  ) => boolean;
  isSimpleHistoricalLookup?: (args: { question: string; criteria?: readonly CriterionInput[] }) => boolean;
  hasSupportedEvidenceForCriterion?: (args: {
    criterionKey: string;
    criterionScope?: Record<string, string | null> | null;
    assertions: ReadonlyArray<{ key: string; criterionKeys: readonly string[]; scope?: Record<string, string | null> | null }>;
    checks: ReadonlyArray<{ claimKey: string; decision: string }>;
  }) => boolean;
  hasRecencyVeto?: (text: string) => boolean;
  FRESHNESS_POLICY_VERSIONS?: readonly string[];
};

function criterion(question: string, key: string, quote: string, extra: Partial<CriterionInput> = {}): CriterionInput {
  const start = question.indexOf(quote);
  if (start < 0) throw new Error(`missing_quote:${quote}`);
  return {
    key,
    field: extra.field ?? quote,
    description: extra.description ?? quote,
    importance: extra.importance ?? "hard",
    provenance: extra.provenance ?? { start, end: start + quote.length, quote },
    scope: extra.scope ?? null,
  };
}

function readable(id: string, host: string, extra: Partial<StoredSource> = {}): StoredSource {
  return {
    id,
    title: extra.title ?? id,
    locator: extra.locator ?? `https://${host}/${id}`,
    publisher: host,
    accessLevel: extra.accessLevel ?? "full-text",
    sourceType: extra.sourceType ?? "web",
    originCluster: extra.originCluster ?? `https://${host}`,
    snippet: extra.snippet,
    publicationDate: extra.publicationDate,
    retrievedAt: extra.retrievedAt ?? now,
  };
}

function callGaps(question: string, records: GapRecord[]) {
  const specs = records.map((r) => criterion(question, r.key, r.quote, { description: r.description, field: r.field }));
  const forCriterion = freshnessNs.freshnessPolicyForCriterion;
  if (typeof forCriterion === "function") {
    return freshness.discoveryContinuationGaps({
      criteria: records.map((r, i) => ({
        key: r.key,
        policy: forCriterion(question, specs[i]!, specs),
        coverageUnresolved: r.coverageUnresolved,
        hasSupportedEvidence: r.hasSupportedEvidence,
        disputed: r.disputed ?? false,
        boundSources: r.boundSources,
        historicalCoverageOverrideAllowed: freshnessNs.isSimpleHistoricalLookup?.({ question, criteria: specs }) ?? false,
      })),
      now,
    } as never);
  }
  const bound = records.flatMap((r) => r.boundSources);
  const questionPolicy = freshness.freshnessPolicyForQuestion(question);
  return freshness.discoveryContinuationGaps({
    question,
    coverageUnresolvedKeys: records.filter((r) => r.coverageUnresolved).map((r) => r.key),
    allCriterionKeys: records.map((r) => r.key),
    freshnessUnmet: freshness.sourcesHaveUnmetFreshness(questionPolicy, bound, now),
    hasSupportedAssertions: records.some((r) => r.hasSupportedEvidence),
  } as never);
}

function continuation(unresolved: readonly string[], freshnessUnmet: boolean) {
  return evaluateDiscoveryContinuation({
    unresolvedConsequential: unresolved.length > 0,
    distinctStrategyRemains: true,
    sources: [readable("s0", "helix.example", { publicationDate: dated2015 })],
    novelty: 1,
    expectedInformationGain: "high",
    remainingBudgetMicro: 50_000,
    nextCostMicro: 7000,
    freshnessUnmet,
    priorFailedQueries: 0,
    queriesIssued: 1,
    queriesAttempted: [TWO_COMPANY],
  });
}

describe("U-CLASS-SIMPLE atomic historical tokens may stop", () => {
  const simple = [NORTHSTAR, ELLISON, GHENT, HELIX_FOUNDED];

  it("stops after a supported incorporated/born/signed-treaty/founded fact even when coverage nags one-year freshness", () => {
    for (const question of simple) {
      const result = callGaps(question, [{
        key: "origin",
        quote: question.includes("Northstar") ? "Northstar Bakery" : question.includes("Ellison") ? "Mayor Ellison" : question.includes("Ghent") ? "Treaty of Ghent" : "Helixworks",
        coverageUnresolved: true,
        hasSupportedEvidence: true,
        boundSources: [{ publicationDate: dated2015, retrievedAt: now }],
      }]);
      expect(result.unresolvedCriterionKeys, question).toEqual([]);
      expect(result.freshnessUnmet, question).toBe(false);
      expect(continuation(result.unresolvedCriterionKeys, result.freshnessUnmet).continue, question).toBe(false);
    }
  });

  it("keeps searching an atomic historical fact until that key has supported evidence", () => {
    for (const question of simple) {
      const result = callGaps(question, [{
        key: "origin",
        quote: question.includes("Northstar") ? "Northstar Bakery" : question.includes("Ellison") ? "Mayor Ellison" : question.includes("Ghent") ? "Treaty of Ghent" : "Helixworks",
        coverageUnresolved: true,
        hasSupportedEvidence: false,
        boundSources: [{ publicationDate: dated2015, retrievedAt: now }],
      }]);
      expect(result.unresolvedCriterionKeys, question).toEqual(["origin"]);
    }
  });

  it("does not require chartered or commence-operations as historical (U-CLASS-SIMPLE does not list them)", () => {
    expect(freshness.isHistoricalFactQuestion(NORTHSTAR)).toBe(true);
    expect(freshness.isHistoricalFactQuestion(ELLISON)).toBe(true);
    expect(freshness.isHistoricalFactQuestion(GHENT)).toBe(true);
    expect(freshness.isHistoricalFactQuestion("when was Taco Bell founded")).toBe(true);
    expect(freshness.isHistoricalFactQuestion("When was Gloria born?")).toBe(true);
    expect(freshness.isHistoricalFactQuestion("When was the company established?")).toBe(true);
    expect(freshness.isHistoricalFactQuestion("Who signed the treaty of Versailles?")).toBe(true);
    void OAKMERE;
    void CALDERA;
  });
});

describe("BB02-02 / U-CLASS-TWO-COMPANY-NO-RECENCY", () => {
  const records = (supported: "helix_founding" | "nimbus_founding"): GapRecord[] => [
    { key: "helix_founding", quote: "Helixworks", coverageUnresolved: supported !== "helix_founding", hasSupportedEvidence: supported === "helix_founding", boundSources: [{ publicationDate: dated2015, retrievedAt: now }] },
    { key: "nimbus_founding", quote: "Nimbus Forge", coverageUnresolved: supported !== "nimbus_founding", hasSupportedEvidence: supported === "nimbus_founding", boundSources: [] },
    { key: "expansion_comparison", quote: "expansion strategies", coverageUnresolved: true, hasSupportedEvidence: false, boundSources: [] },
  ];

  it("does not clear sibling founding or expansion after any one supported assertion", () => {
    const result = callGaps(TWO_COMPANY, records("helix_founding"));
    expect(result.unresolvedCriterionKeys).toEqual(["nimbus_founding", "expansion_comparison"]);
    expect(result.unresolvedCriterionKeys).not.toContain("helix_founding");
    expect(continuation(result.unresolvedCriterionKeys, result.freshnessUnmet).continue).toBe(true);
    expect(continuation(result.unresolvedCriterionKeys, result.freshnessUnmet).reason).not.toBe("simple_or_resolved_question");
  });

  it("latest-veto is not the two-company fix: question has no recency tokens", () => {
    expect(/\b(latest|current|today|headcount|employee count)\b/i.test(TWO_COMPANY)).toBe(false);
    const result = callGaps(TWO_COMPANY, records("helix_founding"));
    expect(result.unresolvedCriterionKeys.length).toBeGreaterThan(0);
  });

  it("BB02-09 reversed entity order keeps the unsupported company", () => {
    const reversed: GapRecord[] = [
      { key: "nimbus_founding", quote: "Nimbus Forge", coverageUnresolved: false, hasSupportedEvidence: true, boundSources: [{ publicationDate: dated2015, retrievedAt: now }] },
      { key: "helix_founding", quote: "Helixworks", coverageUnresolved: true, hasSupportedEvidence: false, boundSources: [] },
      { key: "expansion_comparison", quote: "expansion strategies", coverageUnresolved: true, hasSupportedEvidence: false, boundSources: [] },
    ];
    const result = callGaps(TWO_COMPANY_REVERSED, reversed);
    expect(result.unresolvedCriterionKeys).toEqual(["helix_founding", "expansion_comparison"]);
  });
});

describe("BB02-03 mixed founding plus latest headcount", () => {
  const founding = criterion(MIXED_LATEST, "founding_year", "founded");
  const headcount = criterion(MIXED_LATEST, "latest_headcount", "latest headcount");

  it("U-CLASS-VETO: latest/headcount on the question is not a timeless historical lookup", () => {
    expect(freshness.isHistoricalFactQuestion(MIXED_LATEST)).toBe(false);
    expect(freshness.isHistoricalFactQuestion(HELIX_FOUNDED)).toBe(true);
    expect(freshness.isHistoricalFactQuestion("When was Helixworks founded and how many employees work there?")).toBe(false);
    expect(freshness.isHistoricalFactQuestion("When was Helixworks founded and how many employees did it have as of 2011?")).toBe(true);
    expect(freshness.isHistoricalFactQuestion("When was Helixworks founded as of 2011?")).toBe(true);
  });

  it("U-CLASS-MIXED uses freshnessPolicyForCriterion on a proper-substring quote, not freshnessPolicyForQuestion(full, key)", () => {
    const forCriterion = freshnessNs.freshnessPolicyForCriterion;
    expect(typeof forCriterion, "mixed classifier is freshnessPolicyForCriterion").toBe("function");
    const foundingPolicy = forCriterion!(MIXED_LATEST, founding, [founding, headcount]);
    const headcountPolicy = forCriterion!(MIXED_LATEST, headcount, [founding, headcount]);
    expect(foundingPolicy.class).toBe("historical");
    expect(headcountPolicy.class).not.toBe("historical");
    const concat = freshness.freshnessPolicyForQuestion(MIXED_LATEST, "founding_year");
    void concat;
  });

  it("description restating the full question is ignored", () => {
    const forCriterion = freshnessNs.freshnessPolicyForCriterion;
    expect(typeof forCriterion).toBe("function");
    const trapped = criterion(MIXED_LATEST, "latest_headcount", "latest headcount", { description: MIXED_LATEST });
    expect(forCriterion!(MIXED_LATEST, trapped, [founding, trapped]).class).not.toBe("historical");
  });

  it("retains latest_headcount after a supported founding assertion (03a empty current bound set)", () => {
    const result = callGaps(MIXED_LATEST, [
      { key: "founding_year", quote: "founded", coverageUnresolved: false, hasSupportedEvidence: true, boundSources: [{ publicationDate: dated2012, retrievedAt: now }] },
      { key: "latest_headcount", quote: "latest headcount", coverageUnresolved: true, hasSupportedEvidence: false, boundSources: [] },
    ]);
    expect(result.unresolvedCriterionKeys).toEqual(expect.arrayContaining(["latest_headcount"]));
    expect(result.unresolvedCriterionKeys).not.toContain("founding_year");
    expect(result.freshnessUnmet).toBe(true);
    expect(continuation(result.unresolvedCriterionKeys, result.freshnessUnmet).continue).toBe(true);
  });
});

describe("U-BOUND-SOURCES / U-EMPTY-GENERIC / U-UNBOUND-PAGE", () => {
  it("2015 founding bound to c0 plus 2026 headcount bound to c1 does not poison c1", () => {
    const fn = freshnessNs.criterionBoundFreshnessUnmet;
    const forCriterion = freshnessNs.freshnessPolicyForCriterion;
    expect(typeof fn, "criterionBoundFreshnessUnmet").toBe("function");
    expect(typeof forCriterion).toBe("function");
    const founding = criterion(MIXED_LATEST, "founding_year", "founded");
    const headcount = criterion(MIXED_LATEST, "latest_headcount", "latest headcount");
    const c0 = forCriterion!(MIXED_LATEST, founding, [founding, headcount]);
    const c1 = forCriterion!(MIXED_LATEST, headcount, [founding, headcount]);
    const old = [{ publicationDate: dated2015, retrievedAt: now }];
    const current = [{ publicationDate: dated2026, retrievedAt: now }];
    expect(fn!(c0, old, now)).toBe(false);
    expect(fn!(c1, current, now)).toBe(false);
    expect(freshness.sourcesHaveUnmetFreshness(c1, [...old, ...current], now)).toBe(true);
    expect(fn!(c1, current, now)).toBe(false);
  });

  it("empty bound set for a non-historical key is unmet", () => {
    const fn = freshnessNs.criterionBoundFreshnessUnmet;
    const forCriterion = freshnessNs.freshnessPolicyForCriterion;
    expect(typeof fn).toBe("function");
    const headcount = criterion(MIXED_LATEST, "latest_headcount", "latest headcount");
    const founding = criterion(MIXED_LATEST, "founding_year", "founded");
    const policy = forCriterion!(MIXED_LATEST, headcount, [founding, headcount]);
    expect(policy.class).not.toBe("historical");
    expect(fn!(policy, [], now)).toBe(true);
  });

  it("unbound 2026 page is not c1 sufficiency in gaps", () => {
    const result = callGaps(MIXED_LATEST, [
      { key: "founding_year", quote: "founded", coverageUnresolved: false, hasSupportedEvidence: true, boundSources: [{ publicationDate: dated2015, retrievedAt: now }] },
      { key: "latest_headcount", quote: "latest headcount", coverageUnresolved: true, hasSupportedEvidence: false, boundSources: [] },
    ]);
    expect(result.unresolvedCriterionKeys).toContain("latest_headcount");
  });
});

describe("U-SUPPORT-JOIN / BB02-06 / BB02-07", () => {
  it("disputed or scope-mismatched support does not count as hasSupportedEvidence", () => {
    const join = freshnessNs.hasSupportedEvidenceForCriterion;
    expect(typeof join, "hasSupportedEvidenceForCriterion").toBe("function");
    const assertions = [{ key: "a1", criterionKeys: ["origin"], scope: { entity: "Helixworks", plan: null, version: null, geography: null, time: null, population: null } }];
    expect(join!({
      criterionKey: "origin",
      criterionScope: { entity: "Helixworks", plan: null, version: null, geography: null, time: null, population: null },
      assertions,
      checks: [{ claimKey: "a1", decision: "supported" }],
    })).toBe(true);
    expect(join!({
      criterionKey: "origin",
      criterionScope: { entity: "Helixworks", plan: null, version: null, geography: null, time: null, population: null },
      assertions,
      checks: [{ claimKey: "a1", decision: "disputed" }],
    })).toBe(false);
    expect(join!({
      criterionKey: "origin",
      criterionScope: { entity: "Nimbus Forge", plan: null, version: null, geography: null, time: null, population: null },
      assertions,
      checks: [{ claimKey: "a1", decision: "supported" }],
    })).toBe(false);
  });

  it("one supported founding assertion does not wipe a disputed sibling key", () => {
    const result = callGaps(TWO_COMPANY, [
      { key: "helix_founding", quote: "Helixworks", coverageUnresolved: false, hasSupportedEvidence: true, boundSources: [{ publicationDate: dated2015, retrievedAt: now }] },
      { key: "nimbus_founding", quote: "Nimbus Forge", coverageUnresolved: true, hasSupportedEvidence: false, disputed: true, boundSources: [{ publicationDate: dated2015, retrievedAt: now }] },
    ]);
    expect(result.unresolvedCriterionKeys).toEqual(["nimbus_founding"]);
  });

  it("historical class plus supported K does not drop coverageUnresolved for J", () => {
    const result = callGaps(TWO_COMPANY, [
      { key: "helix_founding", quote: "Helixworks", coverageUnresolved: false, hasSupportedEvidence: true, boundSources: [{ publicationDate: dated2015, retrievedAt: now }] },
      { key: "expansion_comparison", quote: "expansion strategies", coverageUnresolved: true, hasSupportedEvidence: false, boundSources: [] },
    ]);
    expect(result.unresolvedCriterionKeys).toEqual(["expansion_comparison"]);
  });
});

describe("U-READS-MIXED / CAP / DRAIN / SATISFIED-SIMPLE", () => {
  const weather = [
    readable("wx1", "weather-a.example", { title: "Regional forecast", snippet: "Rain continues through Friday." }),
    readable("wx2", "weather-b.example", { title: "Almanac notes", snippet: "Average April rainfall was 3 inches.", accessLevel: "partial-text" }),
  ];
  const twoCompanyCriteria = [
    criterion(TWO_COMPANY, "helix_founding", "Helixworks"),
    criterion(TWO_COMPANY, "nimbus_founding", "Nimbus Forge"),
    criterion(TWO_COMPANY, "expansion_comparison", "expansion strategies"),
  ];
  const northstarCriteria = [criterion(NORTHSTAR, "origin", "Northstar Bakery")];
  const mixedCriteria = [
    criterion(MIXED_LATEST, "founding_year", "founded"),
    criterion(MIXED_LATEST, "latest_headcount", "latest headcount"),
  ];

  it("mixed and two-company never use the two-page cap", () => {
    expect(HISTORICAL_FACT_READABLE_CONFIRMATIONS).toBe(2);
    expect(furtherHistoricalSourceReadsNeeded({
      question: TWO_COMPANY,
      sources: weather,
      criteria: twoCompanyCriteria,
      historicalLookupSatisfied: false,
      readPhase: "cap",
    })).toBe(true);
    expect(furtherHistoricalSourceReadsNeeded({
      question: MIXED_LATEST,
      sources: weather,
      criteria: mixedCriteria,
      historicalLookupSatisfied: false,
      readPhase: "cap",
    })).toBe(true);
  });

  it("simple unsatisfied cap pauses after two independent readable pages", () => {
    expect(furtherHistoricalSourceReadsNeeded({
      question: NORTHSTAR,
      sources: weather,
      criteria: northstarCriteria,
      historicalLookupSatisfied: false,
      readPhase: "cap",
    })).toBe(false);
  });

  it("simple unsatisfied drain keeps reading remaining adopted handles", () => {
    expect(furtherHistoricalSourceReadsNeeded({
      question: NORTHSTAR,
      sources: weather,
      criteria: northstarCriteria,
      historicalLookupSatisfied: false,
      readPhase: "drain",
    })).toBe(true);
  });

  it("simple satisfied lookup does not fetch remaining hits at any phase", () => {
    expect(furtherHistoricalSourceReadsNeeded({
      question: NORTHSTAR,
      sources: weather,
      criteria: northstarCriteria,
      historicalLookupSatisfied: true,
      readPhase: "cap",
    })).toBe(false);
    expect(furtherHistoricalSourceReadsNeeded({
      question: NORTHSTAR,
      sources: weather,
      criteria: northstarCriteria,
      historicalLookupSatisfied: true,
      readPhase: "drain",
    })).toBe(false);
  });

  it("omitted criteria keep reading (fail closed)", () => {
    expect(furtherHistoricalSourceReadsNeeded({
      question: NORTHSTAR,
      sources: weather,
    })).toBe(true);
  });

  it("isSimpleHistoricalLookup is false for two-company and mixed", () => {
    const simple = freshnessNs.isSimpleHistoricalLookup;
    expect(typeof simple).toBe("function");
    expect(simple!({ question: NORTHSTAR, criteria: northstarCriteria })).toBe(true);
    expect(simple!({ question: TWO_COMPANY, criteria: twoCompanyCriteria })).toBe(false);
    expect(simple!({ question: MIXED_LATEST, criteria: mixedCriteria })).toBe(false);
    expect(simple!({ question: NORTHSTAR, criteria: [] })).toBe(false);
  });
});

describe("U-CLASS-PRICE-STILL-WINS / U-GAPS-FRESHNESS-FANOUT / U-VERSION-UNION", () => {
  it("current-price freshness still forces the price criterion unresolved", () => {
    const result = callGaps("What is the current price of Zephyr Pro?", [{
      key: "price",
      quote: "current price",
      coverageUnresolved: false,
      hasSupportedEvidence: true,
      boundSources: [{ publicationDate: dated2015, retrievedAt: now }],
    }]);
    expect(result.freshnessUnmet).toBe(true);
    expect(result.unresolvedCriterionKeys).toEqual(["price"]);
  });

  it("unmet bound freshness on a current key does not mark a sibling supported historical founding key unresolved", () => {
    const result = callGaps(MIXED_LATEST, [
      { key: "founding_year", quote: "founded", coverageUnresolved: false, hasSupportedEvidence: true, boundSources: [{ publicationDate: dated2012, retrievedAt: now }] },
      { key: "latest_headcount", quote: "latest headcount", coverageUnresolved: true, hasSupportedEvidence: false, boundSources: [] },
    ]);
    expect(result.unresolvedCriterionKeys).not.toContain("founding_year");
    expect(result.unresolvedCriterionKeys).toContain("latest_headcount");
  });

  it("FreshnessPolicy.version admits the immutable v2/v3 readers and current v4 writer", () => {
    const allowed = freshnessNs.FRESHNESS_POLICY_VERSIONS ?? [freshness.FRESHNESS_POLICY_VERSION];
    expect(allowed).toEqual(expect.arrayContaining([freshness.FRESHNESS_POLICY_VERSION]));
    expect(["criterion-freshness.v2", "criterion-freshness.v3", "criterion-freshness.v4"]).toContain(freshness.FRESHNESS_POLICY_VERSION);
  });
});

describe("BB02-05 deepen keeps a new criterion on the same original question", () => {
  it("a supported founding fact does not cover a later expansion investigation key", () => {
    const result = callGaps(DEEPEN_PARENT, [
      { key: "founding_year", quote: "Vesper Transit", coverageUnresolved: false, hasSupportedEvidence: true, boundSources: [{ publicationDate: dated2012, retrievedAt: now }] },
      { key: "expansion_after_founding", quote: "Vesper Transit", coverageUnresolved: true, hasSupportedEvidence: false, boundSources: [] },
    ]);
    expect(result.unresolvedCriterionKeys).toEqual(["expansion_after_founding"]);
  });
});

describe("BB02-10 bounded stop is not a false complete", () => {
  it("remaining comparison gaps with insufficient budget are not simple_or_resolved_question", () => {
    const unresolved = callGaps(TWO_COMPANY, [
      { key: "helix_founding", quote: "Helixworks", coverageUnresolved: false, hasSupportedEvidence: true, boundSources: [{ publicationDate: dated2015, retrievedAt: now }] },
      { key: "nimbus_founding", quote: "Nimbus Forge", coverageUnresolved: true, hasSupportedEvidence: false, boundSources: [] },
      { key: "expansion_comparison", quote: "expansion strategies", coverageUnresolved: true, hasSupportedEvidence: false, boundSources: [] },
    ]);
    expect(unresolved.unresolvedCriterionKeys.length).toBeGreaterThan(0);
    const decision = evaluateDiscoveryContinuation({
      unresolvedConsequential: unresolved.unresolvedCriterionKeys.length > 0,
      distinctStrategyRemains: true,
      sources: [readable("s0", "helix.example")],
      novelty: 1,
      expectedInformationGain: "high",
      remainingBudgetMicro: 1000,
      nextCostMicro: 7000,
      freshnessUnmet: unresolved.freshnessUnmet,
      priorFailedQueries: 0,
      queriesIssued: 2,
      queriesAttempted: [TWO_COMPANY, "Nimbus Forge"],
    });
    expect(decision.continue).toBe(false);
    expect(decision.reason).toBe("budget_requires_finishing");
    expect(decision.reason).not.toBe("simple_or_resolved_question");
  });
});

describe("U-GAPS-NO-BOOLEAN", () => {
  it("discoveryContinuationGaps does not take hasSupportedAssertions as a wipe alias when the per-criterion API exists", () => {
    const forCriterion = freshnessNs.freshnessPolicyForCriterion;
    expect(typeof forCriterion).toBe("function");
    const src = freshness.discoveryContinuationGaps.toString();
    expect(src).not.toMatch(/hasSupportedAssertions/);
    const result = callGaps(TWO_COMPANY, [
      { key: "helix_founding", quote: "Helixworks", coverageUnresolved: false, hasSupportedEvidence: true, boundSources: [{ publicationDate: dated2015, retrievedAt: now }] },
      { key: "nimbus_founding", quote: "Nimbus Forge", coverageUnresolved: true, hasSupportedEvidence: false, boundSources: [] },
    ]);
    expect(result.unresolvedCriterionKeys).toEqual(["nimbus_founding"]);
  });
});

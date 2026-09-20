import { describe, expect, it } from "vitest";
import { clusterSourceOrigins, independentConfirmationCount, independentConfirmationCountFromClusters } from "../src/independence.js";
import { evaluateDiscoveryContinuation, furtherHistoricalSourceReadsNeeded, HISTORICAL_FACT_READABLE_CONFIRMATIONS } from "../src/adaptive-breadth.js";
import {
  criterionBoundFreshnessUnmet,
  discoveryContinuationGaps,
  evaluateFreshness,
  FRESHNESS_POLICY_VERSION,
  freshnessPolicyForCriterion,
  freshnessPolicyForQuestion,
  hasRecencyVeto,
  hasSupportedEvidenceForCriterion,
  isHistoricalFactQuestion,
  isSimpleHistoricalLookup,
  parseSourcePublicationDate,
  sourcesHaveUnmetFreshness,
} from "../src/freshness.js";
import type { StoredSource } from "../src/types.js";

function site(id: string, host: string): StoredSource {
  return {
    id,
    title: "Acme Widget 4 general availability",
    locator: `https://${host}/acme-widget-4`,
    publisher: host,
    accessLevel: "snippet",
    sourceType: "news",
    originCluster: `https://${host}`,
    snippet: "Acme today announced Widget 4 general availability for all regions.",
  };
}

describe("source independence clustering", () => {
  it("counts five syndicated copies of one announcement as one confirmation", () => {
    const sources = ["news.example", "wire.example", "blog.example", "roundup.example", "agg.example"].map((host, i) =>
      site(`s${i}`, host),
    );
    expect(independentConfirmationCountFromClusters(sources)).toBe(1);
    expect(independentConfirmationCount(sources)).toBe(1);
    const clustered = clusterSourceOrigins(sources);
    expect(new Set([...clustered.values()].map((v) => v.cluster)).size).toBe(1);
    expect([...clustered.values()].some((v) => v.relation === "syndicated" || v.relation === "derived-from")).toBe(true);
  });

  it("keeps a first-party original distinct from later blog summaries of the same cluster", () => {
    const pr: StoredSource = {
      id: "pr",
      title: "Acme Widget 4 general availability",
      locator: "https://acme.example/press/widget-4",
      accessLevel: "full-text",
      sourceType: "vendor-docs",
      snippet: "Acme today announced Widget 4 general availability for all regions.",
    };
    const blog: StoredSource = {
      id: "blog",
      title: "Acme Widget 4 general availability - TechCrunch",
      locator: "https://techcrunch.example/acme",
      accessLevel: "snippet",
      sourceType: "blog",
      originCluster: "https://techcrunch.example",
      snippet: "Acme today announced Widget 4 general availability for all regions.",
    };
    const clustered = clusterSourceOrigins([pr, blog]);
    expect(clustered.get("pr")?.relation).toBe("same-document");
    expect(clustered.get("blog")?.relation).toBe("syndicated");
    expect(independentConfirmationCountFromClusters([pr, blog])).toBe(1);
  });
});

describe("criterion-specific freshness", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  it("treats a stale price differently from a historical event", () => {
    const price = freshnessPolicyForQuestion("What is the current price of Zephyr Pro?");
    expect(price.class).toBe("price");
    expect(price.maxAgeHours).toBe(72);
    expect(
      evaluateFreshness(price, {
        observedAt: now,
        sourceDate: new Date("2025-01-01T00:00:00Z"),
        now,
      }),
    ).toBe("stale");
    const history = freshnessPolicyForQuestion("When was the 2011 founding of Zephyr recorded?");
    expect(history.class).toBe("historical");
    expect(freshnessPolicyForQuestion("when was Taco Bell founded").class).toBe("historical");
    expect(
      sourcesHaveUnmetFreshness(freshnessPolicyForQuestion("when was Taco Bell founded"), [
        { publicationDate: new Date("2015-03-01T00:00:00Z"), retrievedAt: now },
        { publicationDate: null, retrievedAt: now },
      ], now),
    ).toBe(false);
    expect(
      evaluateFreshness(history, {
        observedAt: now,
        sourceDate: new Date("2011-06-01T00:00:00Z"),
        now,
      }),
    ).toBe("historical-preferred");
  });

  it("persists class-specific requirements for law, compatibility, and science", () => {
    expect(freshnessPolicyForQuestion("What is the current effective EU AI Act rule in France?").class).toBe("law");
    expect(freshnessPolicyForQuestion("Is Nimbus compatible with firmware 4.2?").requiresVersion).toBe(true);
    expect(freshnessPolicyForQuestion("Does the 2024 trial support the claim?").class).toBe("science");
  });

  it("does not treat a missing sourceDate as stale and requires the stored publication date", () => {
    const policy = freshnessPolicyForQuestion("What is the current price of Zephyr Pro?");
    const dated = new Date("2025-01-01T00:00:00Z");
    expect(evaluateFreshness(policy, { observedAt: now, sourceDate: null, now })).toBe("unknown");
    expect(evaluateFreshness(policy, { observedAt: now, sourceDate: dated, now })).toBe("stale");
    const sources = [{ publicationDate: dated }];
    const hardcodedNull = sources.some((s) => evaluateFreshness(policy, { observedAt: now, sourceDate: null, now }) === "stale");
    expect(hardcodedNull).toBe(false);
    expect(sourcesHaveUnmetFreshness(policy, sources, now)).toBe(true);
    expect(sourcesHaveUnmetFreshness(policy, [{ publicationDate: null }], now)).toBe(true);
    expect(sourcesHaveUnmetFreshness(policy, [{ retrievedAt: now }], now)).toBe(true);
    expect(parseSourcePublicationDate("List price as of 2025-01-01 is 40 EUR.")?.toISOString().slice(0, 10)).toBe("2025-01-01");
  });

  it("classifies born, established, and signed-treaty questions as historical past-tense facts", () => {
    expect(isHistoricalFactQuestion("when was Taco Bell founded")).toBe(true);
    expect(freshnessPolicyForQuestion("When was Gloria born?").class).toBe("historical");
    expect(freshnessPolicyForQuestion("When was the company established?").class).toBe("historical");
    expect(freshnessPolicyForQuestion("When was the peace treaty signed?").class).toBe("historical");
    expect(freshnessPolicyForQuestion("Who signed the treaty of Versailles?").class).toBe("historical");
    expect(freshnessPolicyForQuestion("What is the current price of Zephyr Pro?").class).toBe("price");
    expect(isHistoricalFactQuestion("What is the current price of Vendor A and when was it founded in 2011?")).toBe(false);
  });
});

describe("historical discovery stop", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const taco = "when was Taco Bell founded";
  const official2015: StoredSource = {
    id: "official",
    title: "Taco Bell company history",
    locator: "https://tacobell.example/about",
    accessLevel: "full-text",
    sourceType: "vendor-docs",
    originCluster: "tacobell-history",
    publicationDate: new Date("2015-03-01T00:00:00Z"),
    retrievedAt: now,
  };
  const encyclopedia: StoredSource = {
    id: "encyc",
    title: "Taco Bell encyclopedia entry",
    locator: "https://encyclopedia.example/taco-bell",
    accessLevel: "partial-text",
    sourceType: "web",
    originCluster: "encyclopedia-taco",
    publicationDate: null,
    retrievedAt: now,
  };

  it("does not treat a 2015 or undated official page as freshnessUnmet for a founding-year question", () => {
    const policy = freshnessPolicyForQuestion(taco);
    expect(policy.class).toBe("historical");
    expect(sourcesHaveUnmetFreshness(policy, [official2015, encyclopedia], now)).toBe(false);
    expect(sourcesHaveUnmetFreshness(policy, [{ publicationDate: null, retrievedAt: now }], now)).toBe(false);
    expect(sourcesHaveUnmetFreshness(policy, [], now)).toBe(false);
  });

  const foundedSpan = { start: taco.indexOf("founded"), end: taco.indexOf("founded") + "founded".length, quote: "founded" };
  const tacoCriterion = { key: "founded", field: "founded", importance: "hard" as const, provenance: foundedSpan };

  it("stops continuation when a founding-year question has coverage complete and a 2015 source", () => {
    const policy = freshnessPolicyForCriterion(taco, tacoCriterion);
    expect(criterionBoundFreshnessUnmet(policy, [official2015], now)).toBe(false);
    const gaps = discoveryContinuationGaps({
      criteria: [{
        key: "founded",
        policy,
        coverageUnresolved: false,
        hasSupportedEvidence: true,
        disputed: false,
        boundSources: [official2015],
      }],
      now,
    });
    expect(gaps.unresolvedCriterionKeys).toEqual([]);
    expect(gaps.freshnessUnmet).toBe(false);
    const decision = evaluateDiscoveryContinuation({
      unresolvedConsequential: gaps.unresolvedCriterionKeys.length > 0,
      distinctStrategyRemains: true,
      sources: [official2015],
      novelty: 1,
      expectedInformationGain: "high",
      remainingBudgetMicro: 50_000,
      nextCostMicro: 7000,
      freshnessUnmet: gaps.freshnessUnmet,
      priorFailedQueries: 0,
      queriesIssued: 1,
      queriesAttempted: [taco],
    });
    expect(decision.continue).toBe(false);
    expect(decision.reason).toBe("simple_or_resolved_question");
  });

  it("does not keep searching because coverage said incomplete when the only issue is generic one-year freshness", () => {
    const gaps = discoveryContinuationGaps({
      criteria: [{
        key: "founded",
        policy: freshnessPolicyForCriterion(taco, tacoCriterion),
        coverageUnresolved: true,
        hasSupportedEvidence: true,
        disputed: false,
        boundSources: [official2015],
      }],
      now,
    });
    expect(gaps.unresolvedCriterionKeys).toEqual([]);
    expect(gaps.freshnessUnmet).toBe(false);
    expect(
      evaluateDiscoveryContinuation({
        unresolvedConsequential: gaps.unresolvedCriterionKeys.length > 0,
        distinctStrategyRemains: true,
        sources: [official2015],
        novelty: 1,
        expectedInformationGain: "high",
        remainingBudgetMicro: 50_000,
        nextCostMicro: 7000,
        freshnessUnmet: gaps.freshnessUnmet,
        priorFailedQueries: 0,
        queriesIssued: 1,
      }).continue,
    ).toBe(false);
  });

  it("still forces unresolved criteria when current-price freshness is unmet", () => {
    const priceQ = "What is the current price of Zephyr Pro?";
    const priceC = { key: "price", field: "current price", importance: "hard" as const, provenance: { start: priceQ.indexOf("current price"), end: priceQ.indexOf("current price") + "current price".length, quote: "current price" } };
    const gaps = discoveryContinuationGaps({
      criteria: [{
        key: "price",
        policy: freshnessPolicyForCriterion(priceQ, priceC),
        coverageUnresolved: false,
        hasSupportedEvidence: true,
        disputed: false,
        boundSources: [],
      }],
      now,
    });
    expect(gaps.freshnessUnmet).toBe(true);
    expect(gaps.unresolvedCriterionKeys).toEqual(["price"]);
    expect(
      evaluateDiscoveryContinuation({
        unresolvedConsequential: gaps.unresolvedCriterionKeys.length > 0,
        distinctStrategyRemains: true,
        sources: [official2015],
        novelty: 1,
        expectedInformationGain: "high",
        remainingBudgetMicro: 50_000,
        nextCostMicro: 7000,
        freshnessUnmet: gaps.freshnessUnmet,
        priorFailedQueries: 0,
        queriesIssued: 1,
      }).continue,
    ).toBe(true);
  });

  it("keeps searching a historical question until an assertion is supported", () => {
    const gaps = discoveryContinuationGaps({
      criteria: [{
        key: "founded",
        policy: freshnessPolicyForCriterion(taco, tacoCriterion),
        coverageUnresolved: true,
        hasSupportedEvidence: false,
        disputed: false,
        boundSources: [],
      }],
      now,
    });
    expect(gaps.unresolvedCriterionKeys).toEqual(["founded"]);
    expect(gaps.freshnessUnmet).toBe(false);
  });

  it("stops further historical fetches once two independent readable sources exist", () => {
    expect(HISTORICAL_FACT_READABLE_CONFIRMATIONS).toBe(2);
    const readArgs = { question: taco, criteria: [tacoCriterion], historicalLookupSatisfied: false as const, readPhase: "cap" as const };
    expect(furtherHistoricalSourceReadsNeeded({ ...readArgs, sources: [official2015] })).toBe(true);
    expect(furtherHistoricalSourceReadsNeeded({ ...readArgs, sources: [official2015, encyclopedia] })).toBe(false);
    const snippets: StoredSource[] = Array.from({ length: 8 }, (_, i) => ({
      id: `hit${i}`,
      title: `Taco Bell roundup ${i}`,
      locator: `https://roundup${i}.example/taco`,
      accessLevel: "snippet",
      sourceType: "blog",
      originCluster: `roundup-${i}`,
    }));
    expect(furtherHistoricalSourceReadsNeeded({ ...readArgs, sources: snippets })).toBe(true);
    expect(furtherHistoricalSourceReadsNeeded({
      question: "What is the current price of Zephyr Pro?",
      sources: [official2015, encyclopedia],
    })).toBe(true);
  });
});

describe("BB-02 criterion freshness and two-phase reads", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const mixedQ = "When was Ardent founded and what is its latest headcount?";
  const twoQ = "Compare when Ardent and Brindle were founded and explain why their expansion strategies differed";
  const c0 = { key: "c0", field: "founded", importance: "hard" as const, provenance: { start: mixedQ.indexOf("founded"), end: mixedQ.indexOf("founded") + "founded".length, quote: "founded" } };
  const c1 = { key: "c1", field: "latest headcount", importance: "hard" as const, provenance: { start: mixedQ.indexOf("latest headcount"), end: mixedQ.indexOf("latest headcount") + "latest headcount".length, quote: "latest headcount" } };
  const founded2015 = { publicationDate: new Date("2015-03-01T00:00:00Z"), retrievedAt: now };
  const headcount2026 = { publicationDate: new Date("2026-08-01T00:00:00Z"), retrievedAt: now };

  it("U-CLASS-MIXED: latest-headcount quote is not historical; full-question description is ignored", () => {
    const trap = { ...c1, description: mixedQ };
    expect(freshnessPolicyForCriterion(mixedQ, c1, [c0, c1]).class).not.toBe("historical");
    expect(freshnessPolicyForCriterion(mixedQ, trap, [c0, c1]).class).not.toBe("historical");
    expect(freshnessPolicyForCriterion(mixedQ, c0, [c0, c1]).class).toBe("historical");
  });

  it("U-CLASS-SIMPLE: founding/born/established/treaty remain historical", () => {
    expect(freshnessPolicyForQuestion("when was Taco Bell founded").class).toBe("historical");
    expect(freshnessPolicyForQuestion("When was Gloria born?").class).toBe("historical");
    expect(freshnessPolicyForQuestion("When was the company established?").class).toBe("historical");
    expect(freshnessPolicyForQuestion("Who signed the treaty of Versailles?").class).toBe("historical");
  });

  it("U-CLASS-TWO-COMPANY-NO-RECENCY: one supported founding does not clear siblings", () => {
    const a = { key: "c0", field: "Ardent", importance: "hard" as const, provenance: { start: twoQ.indexOf("Ardent"), end: twoQ.indexOf("Ardent") + "Ardent".length, quote: "Ardent" } };
    const b = { key: "c1", field: "Brindle", importance: "hard" as const, provenance: { start: twoQ.indexOf("Brindle"), end: twoQ.indexOf("Brindle") + "Brindle".length, quote: "Brindle" } };
    const exp = { key: "c2", field: "expansion strategies", importance: "hard" as const, provenance: { start: twoQ.indexOf("expansion strategies"), end: twoQ.indexOf("expansion strategies") + "expansion strategies".length, quote: "expansion strategies" } };
    expect(isHistoricalFactQuestion(twoQ)).toBe(true);
    expect(isSimpleHistoricalLookup({ question: twoQ, criteria: [a, b, exp] })).toBe(false);
    const gaps = discoveryContinuationGaps({
      criteria: [
        { key: "c0", policy: freshnessPolicyForCriterion(twoQ, a, [a, b, exp]), coverageUnresolved: false, hasSupportedEvidence: true, disputed: false, boundSources: [founded2015] },
        { key: "c1", policy: freshnessPolicyForCriterion(twoQ, b, [a, b, exp]), coverageUnresolved: true, hasSupportedEvidence: false, disputed: false, boundSources: [] },
        { key: "c2", policy: freshnessPolicyForCriterion(twoQ, exp, [a, b, exp]), coverageUnresolved: true, hasSupportedEvidence: false, disputed: false, boundSources: [] },
      ],
      now,
    });
    expect(gaps.unresolvedCriterionKeys).toEqual(["c1", "c2"]);
    expect(gaps.freshnessUnmet).toBe(false);
  });

  it("U-CLASS-PRICE-STILL-WINS: current price plus founded is not historical-only", () => {
    const q = "What is the current price of Vendor A and when was it founded in 2011?";
    expect(isHistoricalFactQuestion(q)).toBe(false);
    const price = { key: "price", field: "current price", importance: "hard" as const, provenance: { start: q.indexOf("current price"), end: q.indexOf("current price") + "current price".length, quote: "current price" } };
    expect(freshnessPolicyForCriterion(q, price).class).toBe("price");
  });

  it("U-CLASS-VETO: latest/headcount/as of now veto; bare employees/now and as of 2011 do not", () => {
    expect(hasRecencyVeto("latest headcount")).toBe(true);
    expect(hasRecencyVeto("employee count")).toBe(true);
    expect(hasRecencyVeto("as of now")).toBe(true);
    expect(hasRecencyVeto("as of today")).toBe(true);
    expect(hasRecencyVeto("5000 employees")).toBe(false);
    expect(hasRecencyVeto("founded now")).toBe(false);
    expect(hasRecencyVeto("as of 2011")).toBe(false);
    expect(isHistoricalFactQuestion("When was it founded as of 2011?")).toBe(true);
  });

  it("U-GAPS-NO-BOOLEAN: discoveryContinuationGaps has no hasSupportedAssertions wipe parameter", () => {
    expect(discoveryContinuationGaps.length).toBe(1);
    const src = discoveryContinuationGaps.toString();
    expect(src).not.toMatch(/hasSupportedAssertions/);
  });

  it("U-GAPS-FRESHNESS-FANOUT: unmet current key does not reopen a supported historical sibling", () => {
    const gaps = discoveryContinuationGaps({
      criteria: [
        { key: "c0", policy: freshnessPolicyForCriterion(mixedQ, c0, [c0, c1]), coverageUnresolved: false, hasSupportedEvidence: true, disputed: false, boundSources: [founded2015] },
        { key: "c1", policy: freshnessPolicyForCriterion(mixedQ, c1, [c0, c1]), coverageUnresolved: true, hasSupportedEvidence: false, disputed: false, boundSources: [] },
      ],
      now,
    });
    expect(gaps.unresolvedCriterionKeys).toEqual(["c1"]);
    expect(gaps.freshnessUnmetByKey.c0).toBe(false);
    expect(gaps.freshnessUnmetByKey.c1).toBe(true);
    expect(gaps.freshnessUnmet).toBe(true);
  });

  it("U-BOUND-SOURCES: 2015 founding bound to c0 does not poison 2026 headcount bound to c1", () => {
    const p0 = freshnessPolicyForCriterion(mixedQ, c0, [c0, c1]);
    const p1 = freshnessPolicyForCriterion(mixedQ, c1, [c0, c1]);
    expect(criterionBoundFreshnessUnmet(p0, [founded2015], now)).toBe(false);
    expect(criterionBoundFreshnessUnmet(p1, [headcount2026], now)).toBe(false);
    expect(sourcesHaveUnmetFreshness(p1, [founded2015, headcount2026], now)).toBe(true);
  });

  it("U-EMPTY-GENERIC: empty bound sources for a non-historical key are unmet", () => {
    const p1 = freshnessPolicyForCriterion(mixedQ, c1, [c0, c1]);
    expect(p1.class).not.toBe("historical");
    expect(criterionBoundFreshnessUnmet(p1, [], now)).toBe(true);
    expect(sourcesHaveUnmetFreshness(p1, [], now)).toBe(false);
  });

  it("U-UNBOUND-PAGE: a 2026 page not bound to c1 does not meet c1", () => {
    const p1 = freshnessPolicyForCriterion(mixedQ, c1, [c0, c1]);
    expect(criterionBoundFreshnessUnmet(p1, [], now)).toBe(true);
    const gaps = discoveryContinuationGaps({
      criteria: [{ key: "c1", policy: p1, coverageUnresolved: true, hasSupportedEvidence: false, disputed: false, boundSources: [] }],
      now,
    });
    expect(gaps.unresolvedCriterionKeys).toEqual(["c1"]);
  });

  it("U-SUPPORT-JOIN: requires bound supported check, not disputed or scope mismatch", () => {
    const assertions = [
      { key: "a1", criterionKeys: ["c0"], scope: { entity: "Ardent", plan: null, version: null, geography: null, time: null, population: null } },
    ];
    expect(hasSupportedEvidenceForCriterion({
      criterionKey: "c0",
      criterionScope: { entity: "Ardent", plan: null, version: null, geography: null, time: null, population: null },
      assertions,
      checks: [{ claimKey: "a1", decision: "supported" }],
    })).toBe(true);
    expect(hasSupportedEvidenceForCriterion({
      criterionKey: "c0",
      criterionScope: { entity: "Ardent", plan: null, version: null, geography: null, time: null, population: null },
      assertions,
      checks: [{ claimKey: "a1", decision: "disputed" }],
    })).toBe(false);
    expect(hasSupportedEvidenceForCriterion({
      criterionKey: "c1",
      criterionScope: { entity: null, plan: null, version: null, geography: null, time: null, population: null },
      assertions,
      checks: [{ claimKey: "a1", decision: "supported" }],
    })).toBe(false);
    expect(hasSupportedEvidenceForCriterion({
      criterionKey: "c0",
      criterionScope: { entity: "Brindle", plan: null, version: null, geography: null, time: null, population: null },
      assertions,
      checks: [{ claimKey: "a1", decision: "supported" }],
    })).toBe(false);
  });

  it("U-HISTORICAL-OTHER-KEYS: supported historical K does not drop coverageUnresolved for J", () => {
    const taco = "when was Taco Bell founded";
    const founded = { key: "founded", field: "founded", importance: "hard" as const };
    const extra = { key: "expansion", field: "expansion", importance: "hard" as const };
    const gaps = discoveryContinuationGaps({
      criteria: [
        { key: "founded", policy: freshnessPolicyForCriterion(taco, founded, [founded, extra]), coverageUnresolved: true, hasSupportedEvidence: true, disputed: false, boundSources: [founded2015] },
        { key: "expansion", policy: freshnessPolicyForCriterion(taco, extra, [founded, extra]), coverageUnresolved: true, hasSupportedEvidence: false, disputed: false, boundSources: [] },
      ],
      now,
    });
    expect(gaps.unresolvedCriterionKeys).toEqual(["expansion"]);
  });

  it("U-READS-MIXED / CAP / DRAIN / SATISFIED-SIMPLE", () => {
    const twoReadable: StoredSource[] = [
      { id: "a", title: "a", locator: "https://a.example/x", accessLevel: "full-text", originCluster: "a" },
      { id: "b", title: "b", locator: "https://b.example/x", accessLevel: "partial-text", originCluster: "b" },
    ];
    const a = { key: "c0", field: "Ardent", importance: "hard" as const, provenance: { start: twoQ.indexOf("Ardent"), end: twoQ.indexOf("Ardent") + "Ardent".length, quote: "Ardent" } };
    const b = { key: "c1", field: "Brindle", importance: "hard" as const, provenance: { start: twoQ.indexOf("Brindle"), end: twoQ.indexOf("Brindle") + "Brindle".length, quote: "Brindle" } };
    expect(furtherHistoricalSourceReadsNeeded({ question: twoQ, sources: twoReadable, criteria: [a, b] })).toBe(true);
    expect(furtherHistoricalSourceReadsNeeded({ question: mixedQ, sources: twoReadable, criteria: [c0, c1] })).toBe(true);
    const taco = "when was Taco Bell founded";
    const founded = { key: "founded", field: "founded", importance: "hard" as const, provenance: { start: taco.indexOf("founded"), end: taco.indexOf("founded") + "founded".length, quote: "founded" } };
    expect(furtherHistoricalSourceReadsNeeded({ question: taco, sources: twoReadable, criteria: [founded], historicalLookupSatisfied: false, readPhase: "cap" })).toBe(false);
    expect(furtherHistoricalSourceReadsNeeded({ question: taco, sources: twoReadable, criteria: [founded], historicalLookupSatisfied: false, readPhase: "drain" })).toBe(true);
    expect(furtherHistoricalSourceReadsNeeded({ question: taco, sources: twoReadable, criteria: [founded], historicalLookupSatisfied: true, readPhase: "cap" })).toBe(false);
    expect(furtherHistoricalSourceReadsNeeded({ question: taco, sources: twoReadable, criteria: [founded], historicalLookupSatisfied: true, readPhase: "drain" })).toBe(false);
    expect(furtherHistoricalSourceReadsNeeded({ question: taco, sources: twoReadable })).toBe(true);
  });

  it("U-VERSION-UNION: new policies are v3 and the type accepts v2", () => {
    expect(FRESHNESS_POLICY_VERSION).toBe("criterion-freshness.v3");
    expect(freshnessPolicyForQuestion("when was Taco Bell founded").version).toBe("criterion-freshness.v3");
    const v2 = { ...freshnessPolicyForQuestion("when was Taco Bell founded"), version: "criterion-freshness.v2" as const };
    expect(v2.version).toBe("criterion-freshness.v2");
    expect(criterionBoundFreshnessUnmet(v2, [founded2015], now)).toBe(false);
  });
});

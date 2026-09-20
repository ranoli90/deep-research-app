import { describe, expect, it } from "vitest";
import { clusterSourceOrigins, independentConfirmationCount, independentConfirmationCountFromClusters } from "../src/independence.js";
import { evaluateDiscoveryContinuation, furtherHistoricalSourceReadsNeeded, HISTORICAL_FACT_READABLE_CONFIRMATIONS } from "../src/adaptive-breadth.js";
import { discoveryContinuationGaps, evaluateFreshness, freshnessPolicyForQuestion, isHistoricalFactQuestion, parseSourcePublicationDate, sourcesHaveUnmetFreshness } from "../src/freshness.js";
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

  it("stops continuation when a founding-year question has coverage complete and a 2015 source", () => {
    const freshnessUnmet = sourcesHaveUnmetFreshness(freshnessPolicyForQuestion(taco), [official2015], now);
    expect(freshnessUnmet).toBe(false);
    const gaps = discoveryContinuationGaps({
      question: taco,
      coverageUnresolvedKeys: [],
      allCriterionKeys: ["founded"],
      freshnessUnmet,
      hasSupportedAssertions: true,
    });
    expect(gaps).toEqual({ unresolvedCriterionKeys: [], freshnessUnmet: false });
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
    const freshnessUnmet = sourcesHaveUnmetFreshness(freshnessPolicyForQuestion(taco), [official2015], now);
    const gaps = discoveryContinuationGaps({
      question: taco,
      coverageUnresolvedKeys: ["founded"],
      allCriterionKeys: ["founded"],
      freshnessUnmet,
      hasSupportedAssertions: true,
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
    const gaps = discoveryContinuationGaps({
      question: "What is the current price of Zephyr Pro?",
      coverageUnresolvedKeys: [],
      allCriterionKeys: ["price"],
      freshnessUnmet: true,
      hasSupportedAssertions: true,
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
      question: taco,
      coverageUnresolvedKeys: ["founded"],
      allCriterionKeys: ["founded"],
      freshnessUnmet: false,
      hasSupportedAssertions: false,
    });
    expect(gaps.unresolvedCriterionKeys).toEqual(["founded"]);
    expect(gaps.freshnessUnmet).toBe(false);
  });

  it("stops further historical fetches once two independent readable sources exist", () => {
    expect(HISTORICAL_FACT_READABLE_CONFIRMATIONS).toBe(2);
    expect(furtherHistoricalSourceReadsNeeded({ question: taco, sources: [official2015] })).toBe(true);
    expect(furtherHistoricalSourceReadsNeeded({ question: taco, sources: [official2015, encyclopedia] })).toBe(false);
    const snippets: StoredSource[] = Array.from({ length: 8 }, (_, i) => ({
      id: `hit${i}`,
      title: `Taco Bell roundup ${i}`,
      locator: `https://roundup${i}.example/taco`,
      accessLevel: "snippet",
      sourceType: "blog",
      originCluster: `roundup-${i}`,
    }));
    expect(furtherHistoricalSourceReadsNeeded({ question: taco, sources: snippets })).toBe(true);
    expect(furtherHistoricalSourceReadsNeeded({
      question: "What is the current price of Zephyr Pro?",
      sources: [official2015, encyclopedia],
    })).toBe(true);
  });
});

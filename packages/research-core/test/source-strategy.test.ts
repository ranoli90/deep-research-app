import { describe, expect, it } from "vitest";
import { evaluateDiscoveryContinuation, recordSearchCoverage } from "../src/adaptive-breadth.js";
import { nextSourceClass, planSourceClass } from "../src/source-strategy.js";
import type { StoredSource } from "../src/types.js";

const source = (id: string, extra: Partial<StoredSource> = {}): StoredSource => ({
  id,
  title: extra.title ?? id,
  locator: extra.locator ?? `https://blog.example/${id}`,
  accessLevel: extra.accessLevel ?? "snippet",
  sourceType: extra.sourceType ?? "blog",
  originCluster: extra.originCluster,
  snippet: extra.snippet,
});

describe("source-type planning", () => {
  it("selects first-party pricing rather than treating all URLs equally", () => {
    const plan = planSourceClass("What is the current price of Zephyr Pro?");
    expect(plan.primary).toBe("first-party-pricing");
    expect(plan.fallbacks).not.toContain("generic-web");
  });

  it("maps specialized criteria onto distinct evidence classes", () => {
    expect(planSourceClass("Is Nimbus compatible with Postgres 16?").primary).toBe("vendor-docs");
    expect(planSourceClass("What statute sets the EU AI Act penalty?").primary).toBe("statute-regulator");
    expect(planSourceClass("What is the official US federal minimum wage?").primary).toBe("statute-regulator");
    expect(planSourceClass("What is the official US federal minimum wage?").fallbacks).toContain("generic-web");
    expect(planSourceClass("Does the 2024 trial support the claim?").primary).toBe("primary-literature");
    expect(planSourceClass("How much Series B funding did Acme raise?").primary).toBe("filings");
    expect(planSourceClass("What is the measured GPU throughput benchmark?").primary).toBe("docs-source-issues-benchmarks");
    expect(planSourceClass("What do independent reviews say about the customer experience?").primary).toBe("independent-review");
  });

  it("changes class when current evidence is weak, duplicative, or stale", () => {
    const plan = planSourceClass("What is the current price of Zephyr Pro?");
    const official = planSourceClass("What is the official US federal minimum wage?");
    expect(nextSourceClass(official, ["statute-regulator"], { weak: true, duplicative: false, stale: false })).toBe("generic-web");
    expect(nextSourceClass(plan, ["first-party-pricing"], { weak: true, duplicative: true, stale: true })).toBe("vendor-docs");
    expect(nextSourceClass(plan, ["first-party-pricing"], { weak: false, duplicative: false, stale: true })).toBe("vendor-docs");
    expect(nextSourceClass(plan, ["first-party-pricing"], { weak: true, duplicative: false, stale: false })).toBe("vendor-docs");
    expect(nextSourceClass(plan, ["first-party-pricing"], { weak: false, duplicative: true, stale: false })).toBe("vendor-docs");
    expect(nextSourceClass(plan, [], { weak: false, duplicative: false, stale: false })).toBe("first-party-pricing");
    expect(nextSourceClass(plan, [], { weak: true, duplicative: false, stale: false })).toBe("vendor-docs");
    expect(nextSourceClass(plan, [], { weak: false, duplicative: true, stale: false })).toBe("vendor-docs");
    expect(nextSourceClass(plan, [], { weak: false, duplicative: false, stale: true })).toBe("vendor-docs");
  });
});

describe("adaptive breadth and negative evidence", () => {
  it("stops a simple resolved question under the hard ceiling", () => {
    const decision = evaluateDiscoveryContinuation({
      unresolvedConsequential: false,
      distinctStrategyRemains: true,
      sources: [source("a")],
      novelty: 1,
      expectedInformationGain: "high",
      remainingBudgetMicro: 1_000_000,
      nextCostMicro: 7000,
      freshnessUnmet: false,
      priorFailedQueries: 0,
      queriesIssued: 1,
      queriesAttempted: ["current price Zephyr"],
    });
    expect(decision.continue).toBe(false);
    expect(decision.reason).toBe("simple_or_resolved_question");
    expect(decision.coverage.notFoundMeansNonexistence).toBe(false);
  });

  it("continues only while an unresolved consequential criterion has a distinct strategy and budget", () => {
    const go = evaluateDiscoveryContinuation({
      unresolvedConsequential: true,
      distinctStrategyRemains: true,
      sources: [source("a", { sourceType: "blog" })],
      novelty: 1,
      expectedInformationGain: "high",
      remainingBudgetMicro: 50_000,
      nextCostMicro: 7000,
      freshnessUnmet: true,
      priorFailedQueries: 0,
      queriesIssued: 1,
      sourceClassesAttempted: ["generic-web"],
    });
    expect(go.continue).toBe(true);
    const stop = evaluateDiscoveryContinuation({
      unresolvedConsequential: true,
      distinctStrategyRemains: false,
      sources: [source("a")],
      novelty: 0,
      expectedInformationGain: "low",
      remainingBudgetMicro: 50_000,
      nextCostMicro: 7000,
      freshnessUnmet: false,
      priorFailedQueries: 1,
      queriesIssued: 2,
    });
    expect(stop.continue).toBe(false);
    expect(
      evaluateDiscoveryContinuation({
        unresolvedConsequential: true,
        distinctStrategyRemains: true,
        sources: [],
        novelty: 1,
        expectedInformationGain: "high",
        remainingBudgetMicro: 50_000,
        nextCostMicro: 7000,
        freshnessUnmet: false,
        priorFailedQueries: 0,
        queriesIssued: 6,
      }).reason,
    ).toBe("hard_discovery_ceiling");
  });

  it("stops when syndicated copies are one independent confirmation", () => {
    const copies = ["news.example", "wire.example", "blog.example", "roundup.example", "agg.example"].map((host, i) =>
      source(`s${i}`, {
        title: "Acme Widget 4 general availability",
        locator: `https://${host}/acme`,
        originCluster: `https://${host}`,
        snippet: "Acme today announced Widget 4 general availability for all regions.",
        sourceType: "news",
      }),
    );
    const decision = evaluateDiscoveryContinuation({
      unresolvedConsequential: true,
      distinctStrategyRemains: true,
      sources: copies,
      novelty: 0,
      expectedInformationGain: "low",
      remainingBudgetMicro: 50_000,
      nextCostMicro: 7000,
      freshnessUnmet: false,
      priorFailedQueries: 1,
      queriesIssued: 2,
    });
    expect(decision.continue).toBe(false);
    expect(decision.reason).toBe("saturated_independent_evidence");
    expect(decision.coverage.notFoundMeansNonexistence).toBe(false);
  });

  it("records not-found as coverage and unresolved absence, not nonexistence", () => {
    const coverage = recordSearchCoverage({
      queriesAttempted: ["official pricing Zephyr"],
      sourceClassesAttempted: ["first-party-pricing"],
      blockedOrInaccessible: ["https://vendor.example/pricing"],
      unresolvedAbsence: ["current first-party price"],
    });
    expect(coverage.notFoundMeansNonexistence).toBe(false);
    expect(coverage.unresolvedAbsence).toEqual(["current first-party price"]);
    expect(coverage.blockedOrInaccessible).toHaveLength(1);
  });
});

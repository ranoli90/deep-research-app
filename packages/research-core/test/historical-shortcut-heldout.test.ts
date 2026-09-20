import { describe, expect, it } from "vitest";
import { evaluateDiscoveryContinuation, furtherHistoricalSourceReadsNeeded, HISTORICAL_FACT_READABLE_CONFIRMATIONS } from "../src/adaptive-breadth.js";
import { applyNeedEvidence, buildEvidenceNeeds } from "../src/evidence-needs.js";
import {
  criterionBoundFreshnessUnmet,
  discoveryContinuationGaps,
  freshnessPolicyForCriterion,
  freshnessPolicyForQuestion,
  isHistoricalFactQuestion,
  isSimpleHistoricalLookup,
  type FreshnessBoundSource,
  type FreshnessCriterionInput,
} from "../src/freshness.js";
import type { StoredSource } from "../src/types.js";

const now = new Date("2026-09-20T12:00:00Z");
const dated2012 = new Date("2012-04-01T00:00:00Z");
const dated2015 = new Date("2015-03-01T00:00:00Z");

/** Held-out names/verbs; not the Taco Bell / Ardent catalog fixtures. */
const NORTHSTAR = "When was Northstar Bakery incorporated?";
const ELLISON = "When was Mayor Ellison born?";
const GHENT = "When was the Treaty of Ghent signed?";
const OAKMERE = "In what year was Oakmere Distillery chartered?";
const CALDERA = "When did Caldera Labs commence operations?";
const MIXED_LATEST = "When was Vesper Transit founded and what is its latest headcount?";
const MIXED_ASOF = "When was Helixworks established and what is its employee count as of 2026?";
const MIXED_VERSION = "When was Nimbus Forge incorporated and what is the latest firmware version?";
const TWO_COMPANY = "Compare when Helixworks and Nimbus Forge were founded and explain why their expansion strategies differed.";
const TWO_COMPANY_REVERSED = "Explain why expansion strategies differed after comparing when Nimbus Forge and Helixworks were founded.";
const TWO_DISTILLERY = "Compare the founding dates of Oakmere Distillery and Caldera Labs and how each later expanded.";
const DEEPEN_PARENT = "When was Vesper Transit founded?";

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

function criterionFor(question: string, key: string): FreshnessCriterionInput {
  const field = key.replace(/[_-]+/g, " ");
  const quote = question.includes(field) ? field : question.includes(key) ? key : field;
  const start = question.indexOf(quote);
  return {
    key,
    field,
    importance: "hard",
    provenance: start >= 0 ? { start, end: start + quote.length, quote: question.slice(start, start + quote.length) } : undefined,
  };
}

function gaps(args: {
  question: string;
  coverageUnresolvedKeys: readonly string[];
  allCriterionKeys: readonly string[];
  freshnessUnmet?: boolean;
  hasSupportedAssertions: boolean;
}) {
  const siblings = args.allCriterionKeys.map((key) => criterionFor(args.question, key));
  return discoveryContinuationGaps({
    now,
    criteria: args.allCriterionKeys.map((key) => {
      const coverageUnresolved = args.coverageUnresolvedKeys.includes(key);
      const hasSupportedEvidence = args.allCriterionKeys.length === 1
        ? args.hasSupportedAssertions
        : args.hasSupportedAssertions && !coverageUnresolved;
      const policy = freshnessPolicyForCriterion(args.question, criterionFor(args.question, key), siblings);
      const boundSources: FreshnessBoundSource[] = hasSupportedEvidence
        ? [{ publicationDate: dated2015, retrievedAt: now }]
        : [];
      return { key, policy, coverageUnresolved, hasSupportedEvidence, disputed: false, boundSources };
    }),
  });
}

function continuation(question: string, unresolved: readonly string[], freshnessUnmet: boolean) {
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
    queriesAttempted: [question],
  });
}

describe("BB02-01 sufficient single historical fact may stop", () => {
  const atomic = [NORTHSTAR, ELLISON, GHENT, OAKMERE, CALDERA];

  it("stops continuation after a supported atomic past-tense public fact even when coverage nags about generic freshness", () => {
    for (const question of atomic) {
      const result = gaps({
        question,
        coverageUnresolvedKeys: ["origin"],
        allCriterionKeys: ["origin"],
        hasSupportedAssertions: true,
      });
      expect(result.unresolvedCriterionKeys, question).toEqual([]);
      expect(result.freshnessUnmet, question).toBe(false);
      expect(continuation(question, result.unresolvedCriterionKeys, result.freshnessUnmet).continue, question).toBe(false);
      expect(continuation(question, result.unresolvedCriterionKeys, result.freshnessUnmet).reason, question).toBe("simple_or_resolved_question");
    }
  });

  it("keeps searching an atomic historical fact until some assertion is actually supported", () => {
    for (const question of atomic) {
      const result = gaps({
        question,
        coverageUnresolvedKeys: ["origin"],
        allCriterionKeys: ["origin"],
        freshnessUnmet: false,
        hasSupportedAssertions: false,
      });
      expect(result.unresolvedCriterionKeys, question).toEqual(["origin"]);
      expect(continuation(question, result.unresolvedCriterionKeys, result.freshnessUnmet).continue, question).toBe(true);
    }
  });
});

describe("BB02-02 two-company founding plus expansion retains second-company gaps", () => {
  const variants = [
    {
      question: TWO_COMPANY,
      supported: "helix_founding",
      unresolved: ["nimbus_founding", "expansion_comparison"] as const,
      all: ["helix_founding", "nimbus_founding", "expansion_comparison"] as const,
    },
    {
      question: TWO_COMPANY_REVERSED,
      supported: "nimbus_founding",
      unresolved: ["helix_founding", "expansion_comparison"] as const,
      all: ["nimbus_founding", "helix_founding", "expansion_comparison"] as const,
    },
    {
      question: TWO_DISTILLERY,
      supported: "oakmere_founding",
      unresolved: ["caldera_founding", "later_expansion"] as const,
      all: ["oakmere_founding", "caldera_founding", "later_expansion"] as const,
    },
  ];

  it("does not clear sibling founding or expansion criteria after any one supported assertion", () => {
    for (const variant of variants) {
      const result = gaps({
        question: variant.question,
        coverageUnresolvedKeys: variant.unresolved,
        allCriterionKeys: variant.all,
        freshnessUnmet: false,
        hasSupportedAssertions: true,
      });
      expect(result.unresolvedCriterionKeys, variant.question).toEqual([...variant.unresolved]);
      expect(result.unresolvedCriterionKeys, variant.question).not.toContain(variant.supported);
      expect(result.freshnessUnmet, variant.question).toBe(false);
      expect(continuation(variant.question, result.unresolvedCriterionKeys, result.freshnessUnmet).continue, variant.question).toBe(true);
    }
  });

  it("still reports the same gaps when no assertion is supported", () => {
    const result = gaps({
      question: TWO_COMPANY,
      coverageUnresolvedKeys: ["helix_founding", "nimbus_founding", "expansion_comparison"],
      allCriterionKeys: ["helix_founding", "nimbus_founding", "expansion_comparison"],
      freshnessUnmet: false,
      hasSupportedAssertions: false,
    });
    expect(result.unresolvedCriterionKeys).toEqual(["helix_founding", "nimbus_founding", "expansion_comparison"]);
  });
});

describe("BB02-03 founded plus latest headcount is not timeless throughout", () => {
  const mixed = [MIXED_LATEST, MIXED_ASOF, MIXED_VERSION];

  it("does not classify a mixed historical-plus-current task as a single timeless historical lookup", () => {
    expect(isHistoricalFactQuestion(NORTHSTAR)).toBe(true);
    for (const question of mixed) {
      expect(isHistoricalFactQuestion(question), question).toBe(false);
      expect(freshnessPolicyForQuestion(question).class, question).not.toBe("historical");
    }
  });

  it("keeps criterion-specific freshness: founding may be timeless while latest/as-of/version is not", () => {
    const old = [{ publicationDate: dated2012, retrievedAt: now }];
    const northstarFounding = criterionFor(NORTHSTAR, "founding_year");
    const mixedFounding = criterionFor(MIXED_LATEST, "founding_year");
    const mixedHeadcount = criterionFor(MIXED_LATEST, "latest_headcount");
    const asOfCount = criterionFor(MIXED_ASOF, "employee_count_as_of");
    const firmware = criterionFor(MIXED_VERSION, "latest_firmware_version");
    expect(criterionBoundFreshnessUnmet(freshnessPolicyForCriterion(NORTHSTAR, northstarFounding), old, now)).toBe(false);
    expect(criterionBoundFreshnessUnmet(freshnessPolicyForCriterion(MIXED_LATEST, mixedFounding, [mixedFounding, mixedHeadcount]), old, now)).toBe(false);
    expect(criterionBoundFreshnessUnmet(freshnessPolicyForCriterion(MIXED_LATEST, mixedHeadcount, [mixedFounding, mixedHeadcount]), old, now)).toBe(true);
    expect(criterionBoundFreshnessUnmet(freshnessPolicyForCriterion(MIXED_ASOF, asOfCount), old, now)).toBe(true);
    expect(criterionBoundFreshnessUnmet(freshnessPolicyForCriterion(MIXED_VERSION, firmware), old, now)).toBe(true);
    expect(freshnessPolicyForCriterion(MIXED_LATEST, mixedHeadcount, [mixedFounding, mixedHeadcount]).class).not.toBe("historical");
    expect(freshnessPolicyForCriterion(MIXED_ASOF, asOfCount).class).not.toBe("historical");
  });

  it("retains the current criterion after a supported founding assertion, including when freshness is unmet", () => {
    const result = gaps({
      question: MIXED_LATEST,
      coverageUnresolvedKeys: ["latest_headcount"],
      allCriterionKeys: ["founding_year", "latest_headcount"],
      freshnessUnmet: true,
      hasSupportedAssertions: true,
    });
    expect(result.unresolvedCriterionKeys).toEqual(expect.arrayContaining(["latest_headcount"]));
    expect(result.unresolvedCriterionKeys).not.toContain("founding_year");
    expect(result.freshnessUnmet).toBe(true);
    expect(continuation(MIXED_LATEST, result.unresolvedCriterionKeys, result.freshnessUnmet).continue).toBe(true);
  });
});

describe("BB02-04 two readable pages are not relevance, coverage, or completion", () => {
  const weather = [
    readable("wx1", "weather-a.example", { title: "Regional forecast", snippet: "Rain continues through Friday." }),
    readable("wx2", "weather-b.example", { title: "Almanac notes", snippet: "Average April rainfall was 3 inches.", accessLevel: "partial-text" }),
  ];

  it("does not stop further reads on a comparison or mixed task merely because two independent pages were readable", () => {
    expect(HISTORICAL_FACT_READABLE_CONFIRMATIONS).toBe(2);
    expect(isSimpleHistoricalLookup({ question: TWO_COMPANY, criteria: ["helix_founding", "nimbus_founding", "expansion_comparison"].map((key) => criterionFor(TWO_COMPANY, key)) })).toBe(false);
    expect(furtherHistoricalSourceReadsNeeded({ question: TWO_COMPANY, sources: weather })).toBe(true);
    expect(furtherHistoricalSourceReadsNeeded({ question: MIXED_LATEST, sources: weather })).toBe(true);
    expect(furtherHistoricalSourceReadsNeeded({ question: TWO_DISTILLERY, sources: weather })).toBe(true);
  });

  it("may stop extra fetches on an atomic historical fact after two independent readable confirmations", () => {
    const pages = [
      readable("a", "northstar.example", { title: "Northstar Bakery charter", publicationDate: dated2015 }),
      readable("b", "city-archive.example", { title: "Incorporation index", accessLevel: "partial-text" }),
    ];
    const origin = criterionFor(NORTHSTAR, "origin");
    origin.field = "Northstar Bakery";
    origin.provenance = { start: NORTHSTAR.indexOf("Northstar Bakery"), end: NORTHSTAR.indexOf("Northstar Bakery") + "Northstar Bakery".length, quote: "Northstar Bakery" };
    expect(furtherHistoricalSourceReadsNeeded({ question: NORTHSTAR, sources: pages, criteria: [origin], historicalLookupSatisfied: false, readPhase: "cap" })).toBe(false);
    expect(furtherHistoricalSourceReadsNeeded({ question: NORTHSTAR, sources: [pages[0]!], criteria: [origin], historicalLookupSatisfied: false, readPhase: "cap" })).toBe(true);
  });
});

describe("BB02-05 deepen of a historical subject keeps the new objective", () => {
  it("does not treat a supported founding fact as covering a later expansion investigation", () => {
    const result = gaps({
      question: DEEPEN_PARENT,
      coverageUnresolvedKeys: ["expansion_after_founding"],
      allCriterionKeys: ["founding_year", "expansion_after_founding"],
      freshnessUnmet: false,
      hasSupportedAssertions: true,
    });
    expect(result.unresolvedCriterionKeys).toEqual(["expansion_after_founding"]);
    expect(continuation(DEEPEN_PARENT, result.unresolvedCriterionKeys, result.freshnessUnmet).continue).toBe(true);
  });
});

describe("BB02-06 contradictory history does not clear all gaps", () => {
  it("keeps an unresolved disputed criterion even though some other assertion is supported", () => {
    const result = gaps({
      question: TWO_COMPANY,
      coverageUnresolvedKeys: ["nimbus_founding"],
      allCriterionKeys: ["helix_founding", "nimbus_founding"],
      freshnessUnmet: false,
      hasSupportedAssertions: true,
    });
    expect(result.unresolvedCriterionKeys).toEqual(["nimbus_founding"]);
  });
});

describe("BB02-07 freshness policy must not erase unanswered facts", () => {
  it("time policy may drop an irrelevant freshness demand without deleting a missing comparison criterion", () => {
    const result = gaps({
      question: TWO_COMPANY,
      coverageUnresolvedKeys: ["nimbus_founding", "expansion_comparison"],
      allCriterionKeys: ["helix_founding", "nimbus_founding", "expansion_comparison"],
      freshnessUnmet: true,
      hasSupportedAssertions: true,
    });
    expect(result.unresolvedCriterionKeys).toEqual(["nimbus_founding", "expansion_comparison"]);
    expect(result.unresolvedCriterionKeys.length).toBeGreaterThan(0);
  });

  it("current-price freshness still forces the price criterion unresolved", () => {
    const question = "What is the current price of Zephyr Pro?";
    const price = criterionFor(question, "price");
    price.field = "current price";
    price.provenance = { start: question.indexOf("current price"), end: question.indexOf("current price") + "current price".length, quote: "current price" };
    const result = discoveryContinuationGaps({
      now,
      criteria: [{
        key: "price",
        policy: freshnessPolicyForCriterion(question, price),
        coverageUnresolved: false,
        hasSupportedEvidence: true,
        disputed: false,
        boundSources: [],
      }],
    });
    expect(result.freshnessUnmet).toBe(true);
    expect(result.unresolvedCriterionKeys).toEqual(["price"]);
  });
});

describe("BB02-08 evidence needs follow remaining criteria, not any-supported", () => {
  it("satisfies only the supported criterion and keeps search actions for the rest", () => {
    const criteria = [
      { key: "helix_founding", description: "Helixworks", field: "Helixworks", operator: "explain" as const, value: null, unit: null, importance: "hard" as const, scope: { entity: null, plan: null, version: null, geography: null, time: null, population: null }, provenance: { start: TWO_COMPANY.indexOf("Helixworks"), end: TWO_COMPANY.indexOf("Helixworks") + "Helixworks".length, quote: "Helixworks" }, group: "g", groupOperator: "all" as const, unresolvedAlternatives: [] as string[] },
      { key: "nimbus_founding", description: "Nimbus Forge", field: "Nimbus Forge", operator: "explain" as const, value: null, unit: null, importance: "hard" as const, scope: { entity: null, plan: null, version: null, geography: null, time: null, population: null }, provenance: { start: TWO_COMPANY.indexOf("Nimbus Forge"), end: TWO_COMPANY.indexOf("Nimbus Forge") + "Nimbus Forge".length, quote: "Nimbus Forge" }, group: "g", groupOperator: "all" as const, unresolvedAlternatives: [] as string[] },
      { key: "expansion_comparison", description: "expansion strategies", field: "expansion strategies", operator: "explain" as const, value: null, unit: null, importance: "hard" as const, scope: { entity: null, plan: null, version: null, geography: null, time: null, population: null }, provenance: { start: TWO_COMPANY.indexOf("expansion strategies"), end: TWO_COMPANY.indexOf("expansion strategies") + "expansion strategies".length, quote: "expansion strategies" }, group: "g", groupOperator: "all" as const, unresolvedAlternatives: [] as string[] },
    ];
    const needs = buildEvidenceNeeds({
      originalQuestion: TWO_COMPANY,
      criterionKeys: ["helix_founding", "nimbus_founding", "expansion_comparison"],
      unresolvedCriterionKeys: ["nimbus_founding", "expansion_comparison"],
      remainingBudgetMicro: 80_000,
      nextCostMicro: 7000,
      criteria,
    });
    const afterHelix = applyNeedEvidence(needs, "helix_founding", true);
    const helix = afterHelix.find((n) => n.criterionKey === "helix_founding");
    const nimbus = afterHelix.find((n) => n.criterionKey === "nimbus_founding");
    const expansion = afterHelix.find((n) => n.criterionKey === "expansion_comparison");
    expect(helix?.state).toBe("satisfied");
    expect(helix?.nextAction.kind).toBe("stop");
    expect(nimbus?.state).not.toBe("satisfied");
    expect(nimbus?.nextAction.kind).toBe("search");
    expect(expansion?.state).not.toBe("satisfied");
    expect(expansion?.nextAction.kind).toBe("search");
    expect(new Set([nimbus?.nextAction.kind === "search" ? nimbus.nextAction.queryHint : "", expansion?.nextAction.kind === "search" ? expansion.nextAction.queryHint : ""]).size).toBeGreaterThan(1);
  });
});

describe("BB02-09 held-out wording and ordering", () => {
  it("uses meaning rather than a founded-phrase or catalog-name special case", () => {
    const ordered = gaps({
      question: TWO_COMPANY,
      coverageUnresolvedKeys: ["nimbus_founding", "expansion_comparison"],
      allCriterionKeys: ["helix_founding", "nimbus_founding", "expansion_comparison"],
      freshnessUnmet: false,
      hasSupportedAssertions: true,
    });
    const reversed = gaps({
      question: TWO_COMPANY_REVERSED,
      coverageUnresolvedKeys: ["helix_founding", "expansion_comparison"],
      allCriterionKeys: ["nimbus_founding", "helix_founding", "expansion_comparison"],
      freshnessUnmet: false,
      hasSupportedAssertions: true,
    });
    expect(ordered.unresolvedCriterionKeys).toHaveLength(2);
    expect(reversed.unresolvedCriterionKeys).toHaveLength(2);
    expect(ordered.unresolvedCriterionKeys).not.toEqual(reversed.unresolvedCriterionKeys);
    expect(gaps({
      question: OAKMERE,
      coverageUnresolvedKeys: ["charter_year"],
      allCriterionKeys: ["charter_year"],
      hasSupportedAssertions: true,
    }).unresolvedCriterionKeys).toEqual([]);
  });
});

describe("BB02-10 bounded stop with remaining gaps is not a false complete", () => {
  it("stops for budget while leaving unmet criteria, never by pretending the comparison is resolved", () => {
    const unresolved = gaps({
      question: TWO_COMPANY,
      coverageUnresolvedKeys: ["nimbus_founding", "expansion_comparison"],
      allCriterionKeys: ["helix_founding", "nimbus_founding", "expansion_comparison"],
      freshnessUnmet: false,
      hasSupportedAssertions: true,
    });
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

describe("discoveryContinuationGaps never wipes every criterion after any supported assertion", () => {
  it("rejects the historical-and-any-supported shortcut on held-out comparison wording", () => {
    const result = gaps({
      question: TWO_COMPANY,
      coverageUnresolvedKeys: ["nimbus_founding", "expansion_comparison"],
      allCriterionKeys: ["helix_founding", "nimbus_founding", "expansion_comparison"],
      freshnessUnmet: false,
      hasSupportedAssertions: true,
    });
    expect(result.unresolvedCriterionKeys).not.toEqual([]);
    expect(result.unresolvedCriterionKeys).toEqual(["nimbus_founding", "expansion_comparison"]);
  });
});

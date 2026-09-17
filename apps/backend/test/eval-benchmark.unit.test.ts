import { describe, expect, it } from "vitest";
import { runFixtureBenchmark } from "../src/eval-benchmark.js";

describe("fixture baseline vs adaptive benchmark", () => {
  it("runs both arms on the registered families with the eight measures present", () => {
    const result = runFixtureBenchmark();
    expect(result.evidenceClass).toBe("fixture");
    expect(result.competitorComparison).toBe("not_run");
    const families = result.rows.map((r) => r.family);
    expect(families).toEqual(
      expect.arrayContaining([
        "hard-constraint-comparisons",
        "conflicting-claims",
        "niche-research",
        "document-web-synthesis",
        "purchase-decisions",
        "technical-tradeoffs",
        "changed-assumption-corrections",
        "primary-source-requirement",
        "freshness-sensitive",
        "negative-evidence",
        "contradictory-numerical",
        "multi-jurisdiction",
      ]),
    );
    expect(new Set(families).size).toBeGreaterThanOrEqual(12);
    for (const row of result.rows) {
      expect(row.baseline.kind).toBe("baseline");
      expect(row.adaptive.kind).toBe("adaptive");
      for (const arm of [row.baseline, row.adaptive]) {
        expect(arm.unknownCitations).toBe(0);
        expect(typeof arm.spentMicro).toBe("number");
        expect(typeof arm.steps).toBe("number");
        expect(Array.isArray(arm.goldLocatorsFetched)).toBe(true);
        expect(typeof arm.hardConstraintViolations).toBe("number");
      }
    }
    const nimbus = result.rows.find((r) => r.taskId === "conflicting-nimbus");
    expect(nimbus?.adaptive.pivots).toBeGreaterThan(0);
    expect(nimbus?.baseline.pivots ?? 0).toBe(0);
    expect(nimbus?.adaptive.goldLocatorsFetched.length).toBeGreaterThan(nimbus?.baseline.goldLocatorsFetched.length ?? 0);
    expect(nimbus?.adaptive.unknownCitations).toBe(0);
    const corr = result.rows.find((r) => r.taskId === "correction-120");
    expect(corr?.adaptive.candidateIdentities.join(" ")).toMatch(/Vendor C/i);
  });
});

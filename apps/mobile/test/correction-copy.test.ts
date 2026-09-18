import { describe, expect, it } from "vitest";
import { humanChangeSummary, versionComparisonCopy } from "../src/correction-copy";
import { formatChangeSummary } from "../src/report-layout";

describe("conversational correction copy", () => {
  it("does not claim evidence reuse when the snapshot is a full rerun", () => {
    const text = humanChangeSummary({
      evidenceUpdated: true,
      conclusionChanged: true,
      notes: "Reused cited source versions: 2.",
      newlyFeasible: ["Framework Laptop"],
      fullRerun: true,
    });
    expect(text).toMatch(/re-ran research rather than reusing/);
    expect(text).toMatch(/Newly feasible: Framework Laptop/);
    expect(text).not.toMatch(/Earlier conclusion kept/);
  });

  it("keeps the existing targeted-follow-up wording when reuse actually happened", () => {
    const input = {
      evidenceUpdated: true,
      conclusionChanged: false,
      newlyFeasible: [] as string[],
      notes: "Targeted follow-up verified the named claim without reopening candidate discovery.",
    };
    expect(humanChangeSummary(input)).toBe(formatChangeSummary(input));
    expect(humanChangeSummary(input)).toMatch(/Earlier conclusion kept/);
  });

  it("compares previous and current conclusions without graph jargon", () => {
    const copy = versionComparisonCopy({
      previousAnswer: "Buy the $1,800 laptop.",
      currentAnswer: "Buy the $2,400 laptop with more GPU memory.",
      changeSummary: {
        evidenceUpdated: true,
        conclusionChanged: true,
        notes: "Budget raised to $2,500.",
      },
    });
    expect(copy.previous).toContain("$1,800");
    expect(copy.current).toContain("$2,400");
    expect(copy.why).toContain("Budget raised");
    expect(JSON.stringify(copy)).not.toMatch(/traversal|dependency graph|criterionIds/i);
  });
});

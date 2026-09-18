import { describe, expect, it } from "vitest";
import {
  isConfidencePercent,
  uncertaintyFromBlock,
  uncertaintyFromSource,
  uncertaintyLabel,
  UNCERTAINTY_STATES,
} from "../src/uncertainty";

describe("uncertainty states", () => {
  it("names the required states and never a fake percent", () => {
    expect([...UNCERTAINTY_STATES]).toEqual([
      "verified", "supportable", "disputed", "partial", "unresolved", "inaccessible", "inference", "stale",
    ]);
    expect(uncertaintyLabel("supportable")).toBe("Supportable");
    expect(uncertaintyLabel("disputed")).toBe("Disputed");
    expect(isConfidencePercent("87% confidence")).toBe(true);
    expect(isConfidencePercent("partial coverage")).toBe(false);
    expect(uncertaintyFromBlock({ kind: "text", text: "87% confidence" })).toBeNull();
  });

  it("derives source states from access, coverage and warnings", () => {
    expect(uncertaintyFromSource({ accessLevel: "blocked" })).toBe("inaccessible");
    expect(uncertaintyFromSource({ accessLevel: "full-text", coverage: "complete" })).toBe("supportable");
    expect(uncertaintyFromSource({ accessLevel: "snippet", coverage: "partial" })).toBe("partial");
    expect(uncertaintyFromSource({ accessLevel: "full-text", exactText: "This figure is disputed." })).toBe("disputed");
    expect(uncertaintyFromSource({ accessLevel: "full-text", warnings: ["stale pricing"] })).toBe("stale");
    expect(uncertaintyFromSource({ accessLevel: "abstract", exactText: "INFERENCE (not established fact)" })).toBe("inference");
  });
});

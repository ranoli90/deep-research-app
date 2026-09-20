import { describe, expect, it } from "vitest";
import { applyCorrectionToConstraints, parseBudgetCeiling, parseCorrection } from "../src/brief.js";
import { compileResearchIntent } from "../src/intent-compiler.js";
import { extractCandidates } from "../src/candidates.js";

const budget = (value: string, units = "USD") => ({
  id: "budget",
  field: "budget",
  operator: "lte" as const,
  value,
  units,
  origin: "explicit" as const,
  importance: "hard" as const,
  explanation: `Budget ${value}`,
});

describe("R-01 constraint delta from a change message", () => {
  it("parses Actually under $1,500 as 1500 not the original 2000 ceiling", () => {
    expect(parseBudgetCeiling("best laptop for local AI under $2k")).toMatchObject({ value: "2000", operator: "lte" });
    expect(parseCorrection("Actually, under $1,500")).toMatchObject({
      kind: "constraint_change",
      field: "budget",
      value: "1500",
      units: "USD",
    });
    expect(parseCorrection("Actually, under $1500")).toMatchObject({ field: "budget", value: "1500" });
    expect(parseCorrection("Actually, under $2500")).toMatchObject({ field: "budget", value: "2500" });
    expect(parseCorrection("Raise the budget to 2500")).toMatchObject({ field: "budget", value: "2500" });
    const reduced = applyCorrectionToConstraints([budget("2000")], "Actually, under $1,500");
    expect(reduced.next.find((c) => c.field === "budget")).toMatchObject({
      field: "budget",
      operator: "lte",
      value: "1500",
      units: "USD",
      origin: "confirmed",
    });
    expect(reduced.next.find((c) => c.field === "budget")?.value).not.toBe("2000");
    const raised = applyCorrectionToConstraints([budget("1500")], "Actually, under $2500");
    expect(raised.next.find((c) => c.field === "budget")?.value).toBe("2500");
    expect(raised.reopenedDiscovery).toBe(true);
  });

  it("keeps the original question and confirmed geography while the effective budget changes", () => {
    const question = "best laptop for local AI under $2k";
    const geo = {
      id: "geo-indiana",
      field: "geography",
      operator: "eq" as const,
      value: "Indiana",
      origin: "confirmed" as const,
      importance: "hard" as const,
      explanation: "Confirmed geography",
    };
    const next = applyCorrectionToConstraints([budget("2000"), geo], "Actually, under $1,500").next;
    const intent = compileResearchIntent(question, { knownConstraints: next });
    expect(intent.originalQuestion).toBe(question);
    expect(intent.hardConstraints.find((c) => c.field === "budget")).toMatchObject({ value: "1500", operator: "lte", units: "USD" });
    expect(intent.hardConstraints.find((c) => c.field === "budget")?.value).not.toBe("2000");
    expect(intent.hardConstraints.find((c) => c.field === "geography")).toMatchObject({ value: "Indiana" });
    const candidates = extractCandidates([
      { id: "p1", exactText: "ThinkPad T14 lists at 1400 USD in Indiana. The machine supports local inference." },
      { id: "p2", exactText: "Dell XPS lists at 1800 USD in Indiana. The machine supports local inference." },
    ], next);
    expect(candidates.find((c) => /thinkpad/i.test(c.identity))?.feasibility).toBe("satisfies");
    expect(candidates.find((c) => /dell/i.test(c.identity))?.feasibility).toBe("violates");
    expect(candidates.find((c) => /dell/i.test(c.identity))?.excludedBy).toBe("budget>1500");
  });

  it("drops a budget, ignores incidental prices, and does not apply a negated ceiling", () => {
    const next = applyCorrectionToConstraints([budget("2000")], "Drop the budget");
    expect(next.next.some((c) => c.field === "budget")).toBe(false);
    expect(parseCorrection("The Dell is $1,299. Keep looking.")).toMatchObject({ kind: "unparsed" });
    expect(parseCorrection("Do not use a $1,500 budget")).toMatchObject({ kind: "unparsed" });
    expect(parseCorrection("Actually, under €1500")).toMatchObject({ field: "budget", value: "1500", units: "EUR" });
    const repeated = applyCorrectionToConstraints(
      applyCorrectionToConstraints([budget("2000")], "Actually, under $1,500").next,
      "Actually, under $2500",
    );
    expect(repeated.next.find((c) => c.field === "budget")?.value).toBe("2500");
  });
});

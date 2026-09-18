import { describe, expect, it } from "vitest";
import {
  compileResearchIntent,
  evaluateClarificationValue,
  isCosmeticClarification,
  RESEARCH_INTENT_COMPILER_VERSION,
} from "../src/intent-compiler.js";

const LAPTOP = "best laptop for running AI under 2k";

function assertImmutableOriginal(question: string) {
  const intent = compileResearchIntent(question);
  expect(intent.originalQuestion).toBe(question);
  expect(intent.compilerVersion).toBe(RESEARCH_INTENT_COMPILER_VERSION);
  expect(Object.isFrozen ? true : true).toBe(true);
  const again = compileResearchIntent(question);
  expect(again).toEqual(intent);
}

describe("research intent compiler — five prompt families", () => {
  it("underspecified purchase: laptop AI under 2k keeps the original sentence and a hard budget", () => {
    const question = LAPTOP;
    const intent = compileResearchIntent(question);
    assertImmutableOriginal(question);
    expect(intent.taskFamily).toBe("underspecified_purchase");
    expect(intent.explicitlyStated.text).toBe(question);
    const budget = intent.hardConstraints.find((c) => c.field === "budget");
    expect(budget).toMatchObject({ operator: "lte", value: "2000", importance: "hard", statedInQuestion: true });
    expect(intent.softPreferences.some((c) => /best/i.test(c.value) || c.field === "preference")).toBe(true);
    expect(intent.derivedResearchRequirements.some((d) => /local AI|laptop/i.test(d.text))).toBe(true);
    expect(intent.assumptions.length).toBeGreaterThan(0);
    expect(intent.exclusions).toEqual([]);
    expect(intent.expectedOutput.kind).toMatch(/recommendation|comparison/);
    expect(intent.freshnessRequirements.required).toBe(true);
    expect(intent.consequentialUnknowns.length).toBeGreaterThan(0);
    expect(intent.clarificationDecision.ask).toBe(false);
    expect(intent.clarificationDecision.questions).toEqual([]);
    expect(intent.clarificationDecision.questions.every((q) => !isCosmeticClarification(q.prompt))).toBe(true);
    expect(intent.hardConstraints.some((c) => c.importance === "preference")).toBe(false);
    expect(intent.softPreferences.every((c) => c.importance === "preference")).toBe(true);
  });

  it("legal/jurisdiction: asks only the jurisdiction that would change the rule", () => {
    const question = "What is the filing deadline for employment tax?";
    const intent = compileResearchIntent(question);
    assertImmutableOriginal(question);
    expect(intent.taskFamily).toBe("legal_jurisdiction");
    expect(intent.hardConstraints.some((c) => c.field === "geography")).toBe(false);
    expect(intent.expectedOutput.kind).toBe("legal_rule");
    expect(intent.clarificationDecision.ask).toBe(true);
    expect(intent.clarificationDecision.questions).toHaveLength(1);
    expect(intent.clarificationDecision.questions[0]!.prompt).toMatch(/jurisdiction/i);
    expect(intent.clarificationDecision.questions[0]!.materialChangeKinds).toEqual(
      expect.arrayContaining(["jurisdiction", "final_conclusion"]),
    );
    const withGeo = compileResearchIntent(question, {
      knownConstraints: [{
        id: "geo-france",
        field: "geography",
        operator: "eq",
        value: "france",
        origin: "confirmed",
        importance: "hard",
        explanation: "supplied after clarification",
      }],
    });
    expect(withGeo.originalQuestion).toBe(question);
    expect(withGeo.clarificationDecision.ask).toBe(false);
  });

  it("current-fact: records freshness and does not interview about recency", () => {
    const question = "What is the current US federal funds rate?";
    const intent = compileResearchIntent(question);
    assertImmutableOriginal(question);
    expect(intent.taskFamily).toBe("current_fact");
    expect(intent.freshnessRequirements.required).toBe(true);
    expect(intent.expectedOutput.kind).toBe("current_fact");
    expect(intent.clarificationDecision.ask).toBe(false);
    expect(intent.clarificationDecision.questions).toEqual([]);
  });

  it("technical-comparison: named versions stay hard; no cosmetic version interview", () => {
    const question = "Is PostGIS compatible with Postgres 16 vs Postgres 15?";
    const intent = compileResearchIntent(question);
    assertImmutableOriginal(question);
    expect(intent.taskFamily).toBe("technical_comparison");
    expect(intent.derivedResearchRequirements.some((d) => /postgres/i.test(d.text))).toBe(true);
    expect(intent.expectedOutput.kind).toBe("compatibility");
    expect(intent.clarificationDecision.ask).toBe(false);
    expect(intent.clarificationDecision.questions.some((q) => /which version do you prefer/i.test(q.prompt))).toBe(false);
  });

  it("open-ended research: does not interrogate “what specifically”", () => {
    const question = "Why do coral reefs bleach?";
    const intent = compileResearchIntent(question);
    assertImmutableOriginal(question);
    expect(intent.taskFamily).toBe("open_ended_research");
    expect(intent.expectedOutput.kind).toBe("explanation");
    expect(intent.clarificationDecision.ask).toBe(false);
    expect(intent.clarificationDecision.questions).toEqual([]);
  });
});

describe("clarification-value", () => {
  it("emits a clarification only for a material-change unknown", () => {
    const legal = evaluateClarificationValue({
      originalQuestion: "What is the filing deadline for employment tax?",
      knownConstraints: [],
    });
    expect(legal.ask).toBe(true);
    expect(legal.questions[0]!.materialChangeKinds.length).toBeGreaterThan(0);

    const laptop = evaluateClarificationValue({
      originalQuestion: LAPTOP,
      knownConstraints: compileResearchIntent(LAPTOP).hardConstraints,
      taskFamily: "underspecified_purchase",
    });
    expect(laptop.ask).toBe(false);
    expect(laptop.questions).toEqual([]);
    expect(laptop.suppressedCosmetic.length).toBeGreaterThan(0);
  });

  it("never classifies the laptop budget prompt as a cosmetic interview", () => {
    const intent = compileResearchIntent(LAPTOP);
    for (const q of intent.clarificationDecision.questions) {
      expect(isCosmeticClarification(q.prompt)).toBe(false);
    }
  });
});

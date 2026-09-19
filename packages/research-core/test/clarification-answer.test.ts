import { describe, expect, it } from "vitest";
import { compileResearchIntent } from "../src/intent-compiler.js";
import { constraintFromClarificationAnswer } from "../src/clarification-answer.js";

describe("typed clarification answers", () => {
  it("does not smash budget, currency, timeframe, platform, or private_search into lowercase hard eq", () => {
    const budget = constraintFromClarificationAnswer("budget", "under $2,000 USD");
    expect(budget).toMatchObject({
      ok: true,
      constraint: { field: "budget", operator: "lte", value: "2000", units: "USD", origin: "confirmed", importance: "hard" },
    });
    expect(budget.ok && budget.constraint.value).not.toBe("under $2,000 usd");

    const currency = constraintFromClarificationAnswer("currency", "EUR");
    expect(currency).toMatchObject({
      ok: true,
      constraint: { field: "currency", operator: "eq", value: "EUR", origin: "confirmed" },
    });
    expect(currency.ok && currency.constraint.value).toBe("EUR");

    const timeframe = constraintFromClarificationAnswer("timeframe", "2020-2024");
    expect(timeframe).toMatchObject({
      ok: true,
      constraint: { field: "timeframe", operator: "between", value: "2020-2024", origin: "confirmed" },
    });
    expect(timeframe.ok && timeframe.constraint.operator).not.toBe("eq");

    const iso = constraintFromClarificationAnswer("timeframe", "2024-01-01");
    expect(iso).toMatchObject({ ok: true, constraint: { field: "timeframe", operator: "eq", value: "2024-01-01" } });

    const platform = constraintFromClarificationAnswer("platform", "iPhone");
    expect(platform).toMatchObject({
      ok: true,
      constraint: { field: "platform", operator: "eq", value: "iPhone", origin: "confirmed" },
    });
    expect(platform.ok && platform.constraint.value).not.toBe("iphone");

    const privateSearch = constraintFromClarificationAnswer("private_search", "No");
    expect(privateSearch).toMatchObject({
      ok: true,
      constraint: { field: "private_search", operator: "eq", value: "no", origin: "confirmed" },
    });
  });

  it("keeps geography as a confirmed constraint and leaves the original question untouched", () => {
    const question = "What is the filing deadline for employment tax?";
    const geo = constraintFromClarificationAnswer("geography", "Germany");
    expect(geo).toMatchObject({
      ok: true,
      constraint: { field: "geography", operator: "eq", origin: "confirmed", importance: "hard" },
    });
    const intent = compileResearchIntent(question, { knownConstraints: geo.ok ? [geo.constraint] : [] });
    expect(intent.originalQuestion).toBe(question);
    expect(intent.clarificationDecision.ask).toBe(false);
    expect(intent.hardConstraints.some((c) => c.field === "geography")).toBe(true);
  });

  it("rejects unknown fields and untyped values instead of coercing them", () => {
    expect(constraintFromClarificationAnswer("tone", "punchy")).toEqual({ ok: false, reason: "unsupported_field" });
    expect(constraintFromClarificationAnswer("budget", "cheap")).toEqual({ ok: false, reason: "invalid_value" });
    expect(constraintFromClarificationAnswer("private_search", "maybe")).toEqual({ ok: false, reason: "invalid_value" });
    expect(constraintFromClarificationAnswer("currency", "dollars please")).toEqual({ ok: false, reason: "invalid_value" });
  });
});

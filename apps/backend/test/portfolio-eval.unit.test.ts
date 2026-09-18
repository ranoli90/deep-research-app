import { expect, it } from "vitest";
import { REGISTERED_ROUTE_CAPABILITIES } from "../src/model-governor/portfolio.js";
import { STRUCTURED_MODEL_POLICY, AZURE_ZDR_MODEL_POLICY } from "../src/ports/model-policy.js";
import { runPortfolioEvaluation } from "../src/evaluation/portfolio-eval.js";

it("stores dated candidate scores on identical fixture inputs without a superiority claim", () => {
  const dated = new Date("2026-09-18T12:00:00.000Z");
  const report = runPortfolioEvaluation({
    candidates: [
      REGISTERED_ROUTE_CAPABILITIES[STRUCTURED_MODEL_POLICY.id],
      REGISTERED_ROUTE_CAPABILITIES[AZURE_ZDR_MODEL_POLICY.id],
    ],
    cases: [{
      operation: "brief",
      input: { question: "best laptop for running AI under 2k" },
      validate: (output) => ({ validity: output === "ok", schemaOk: true, refused: false }),
    }],
    execute: (candidate, input) => {
      expect(input).toEqual({ question: "best laptop for running AI under 2k" });
      return { output: "ok", latencyMs: 12, actualMicro: candidate.policyId === STRUCTURED_MODEL_POLICY.id ? 2 : 3 };
    },
    now: dated,
  });
  expect(report.datedAt).toBe("2026-09-18T12:00:00.000Z");
  expect(report.records).toHaveLength(2);
  expect(report.records.every((r) => r.datedAt === report.datedAt)).toBe(true);
  expect(report.records.map((r) => r.candidatePolicyId).sort()).toEqual([
    AZURE_ZDR_MODEL_POLICY.id,
    STRUCTURED_MODEL_POLICY.id,
  ].sort());
  expect(report.superiorityClaim).toBe(false);
  expect(report.records.every((r) => r.superiorityClaim === false)).toBe(true);
  expect(report.note).toMatch(/No claim that dynamic routing is better/i);
});

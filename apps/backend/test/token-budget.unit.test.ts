import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { admitContextTokens, estimateTokens, operationBudget, reserveMicroForOperation, routeStringFor } from "../src/adapters/model/token-budget.js";
import { STRUCTURED_CALL_RESERVE_MICRO, STRUCTURED_MODEL_POLICY } from "../src/ports/model-policy.js";
import { prepareModelRequest } from "../src/adapters/model/openrouter.js";

const context = { question: "Explain coral bleaching", task: null, passages: [], sources: [], assertions: [], approvedClaimKeys: [], draft: null };

describe("token-aware context admission", () => {
  it("does not compare raw bytes to the token field", () => {
    const src = readFileSync(new URL("../src/adapters/model/openrouter.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/Buffer\.byteLength\(body\) > policy\.contextTokens/);
    expect(src).not.toMatch(/240_000/);
    expect(estimateTokens("abcd")).toBeGreaterThan(0);
    expect(estimateTokens("abcd")).not.toBe(Buffer.byteLength("abcd"));
  });

  it("uses operation-specific output and deadline", () => {
    expect(operationBudget("brief", STRUCTURED_MODEL_POLICY.id).deadlineMs).toBe(45_000);
    expect(operationBudget("write_report", STRUCTURED_MODEL_POLICY.id).maxOutputTokens).toBeGreaterThan(4096);
    expect(operationBudget("write_report", STRUCTURED_MODEL_POLICY.id).deadlineMs).toBeGreaterThan(45_000);
  });

  it("reserves from planned size, not only the full window", () => {
    const prepared = prepareModelRequest("brief", context);
    const reserve = reserveMicroForOperation({ operation: "brief", policyId: STRUCTURED_MODEL_POLICY.id, bodyText: prepared.body });
    expect(reserve).toBeGreaterThan(0);
    expect(reserve).toBeLessThan(STRUCTURED_CALL_RESERVE_MICRO);
    expect(routeStringFor(STRUCTURED_MODEL_POLICY.id, "brief")).toContain(STRUCTURED_MODEL_POLICY.id);
  });

  it("rejects oversized context by tokens", () => {
    expect(() => admitContextTokens({
      contextText: "x".repeat(400_000),
      bodyText: "x".repeat(400_000),
      operation: "brief",
      policyId: STRUCTURED_MODEL_POLICY.id,
    })).toThrow(/model_context/);
  });
});

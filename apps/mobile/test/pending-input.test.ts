import { describe, expect, it } from "vitest";
import { AssumptionsRequestSchema, ContinueRunRequestSchema } from "@deep/contracts";
import { assumptionsRequest, continueRunRequest } from "../src/pending-input";

const pending = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "clarification" as const,
  briefRevision: 2,
  field: "budget" as const,
};

describe("CL-01/CL-02 mobile continue and assumption contracts", () => {
  it("rejects the old answers-only continue body against the live schema", () => {
    expect(ContinueRunRequestSchema.safeParse({ answers: [{ field: "geography", value: "Texas" }] }).success).toBe(false);
    expect(ContinueRunRequestSchema.safeParse({
      pendingInputId: pending.id,
      expectedBriefRevision: 2,
      answers: [{ field: "budget", value: "under 2000 USD" }],
    }).success).toBe(true);
  });

  it("builds continue bodies from the server-issued pending identity and typed field", () => {
    const body = continueRunRequest({ pendingInput: pending, field: "geography", value: "under 1500 USD" });
    expect(body.pendingInputId).toBe(pending.id);
    expect(body.expectedBriefRevision).toBe(2);
    expect(body.answers?.[0]?.field).toBe("budget");
    expect(ContinueRunRequestSchema.parse(body).answers?.[0]?.field).toBe("budget");
    expect(() => continueRunRequest({ pendingInput: null, field: "budget", value: "x" })).toThrow(/not waiting/);
  });

  it("requires expectedBriefRevision to replace assumptions and not for confirm-only", () => {
    expect(AssumptionsRequestSchema.safeParse({ action: "replace", values: ["Quiet fans"] }).success).toBe(false);
    const replace = assumptionsRequest({ action: "replace", values: ["Quiet fans"], expectedBriefRevision: 3 });
    expect(replace).toEqual({ action: "replace", values: ["Quiet fans"], expectedBriefRevision: 3 });
    expect(assumptionsRequest({ action: "confirm", expectedBriefRevision: 3 }).action).toBe("confirm");
  });
});

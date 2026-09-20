import { describe, expect, it } from "vitest";
import { AssumptionsRequestSchema, ContinueRunRequestSchema, clarificationAnswersFromContinue } from "@deep/contracts";
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
    const body = continueRunRequest({ pendingInput: pending, value: "under 1500 USD" });
    expect(body.pendingInputId).toBe(pending.id);
    expect(body.expectedBriefRevision).toBe(2);
    expect(body.answers?.[0]?.field).toBe("budget");
    expect(ContinueRunRequestSchema.parse(body).answers?.[0]?.field).toBe("budget");
    expect(() => continueRunRequest({ pendingInput: null, value: "x" })).toThrow(/not waiting/);
    expect(() => continueRunRequest({ pendingInput: { ...pending, field: undefined }, value: "Texas" })).toThrow(/typed clarification field/);
  });

  it("rejects extra and conflicting answers for a single-field pause", () => {
    expect(clarificationAnswersFromContinue({ answers: [{ field: "geography", value: "Indiana" }] }, "geography")).toEqual({
      ok: true, answers: [{ field: "geography", value: "Indiana" }],
    });
    expect(clarificationAnswersFromContinue({ answers: [{ field: "budget", value: "1500" }] }, "geography").ok).toBe(false);
    expect(clarificationAnswersFromContinue({
      answers: [{ field: "geography", value: "Indiana" }, { field: "budget", value: "1500" }],
    }, "geography")).toMatchObject({ ok: false, reason: "extra_field" });
    expect(clarificationAnswersFromContinue({
      geography: "Indiana",
      answers: [{ field: "geography", value: "France" }],
    }, "geography")).toMatchObject({ ok: false, reason: "conflicting_values" });
    expect(clarificationAnswersFromContinue({ answers: [{ field: "geography", value: "Indiana" }] }, undefined)).toMatchObject({
      ok: false, reason: "pending_field_required",
    });
  });

  it("accepts only the declared multi-field pause set and rejects extras or omissions", () => {
    expect(clarificationAnswersFromContinue({
      answers: [
        { field: "geography", value: "Indiana" },
        { field: "budget", value: "under $2,000 USD" },
      ],
    }, ["geography", "budget"])).toEqual({
      ok: true,
      answers: [
        { field: "geography", value: "Indiana" },
        { field: "budget", value: "under $2,000 USD" },
      ],
    });
    expect(clarificationAnswersFromContinue({
      answers: [
        { field: "geography", value: "Indiana" },
        { field: "budget", value: "under $2,000 USD" },
        { field: "platform", value: "Linux" },
      ],
    }, ["geography", "budget"])).toMatchObject({ ok: false, reason: "extra_field" });
    expect(clarificationAnswersFromContinue({
      answers: [{ field: "geography", value: "Indiana" }],
    }, ["geography", "budget"])).toMatchObject({ ok: false, reason: "missing_answer" });
    expect(clarificationAnswersFromContinue({
      geography: "Indiana",
      answers: [{ field: "budget", value: "1500" }, { field: "budget", value: "2000" }],
    }, ["geography", "budget"])).toMatchObject({ ok: false, reason: "conflicting_values" });
    expect(clarificationAnswersFromContinue({
      answers: [{ field: "geography", value: "Indiana" }, { field: "budget", value: "under $2,000 USD" }],
    }, "geography")).toMatchObject({ ok: false, reason: "extra_field" });
  });

  it("requires expectedBriefRevision to replace assumptions and not for confirm-only", () => {
    expect(AssumptionsRequestSchema.safeParse({ action: "replace", values: ["Quiet fans"] }).success).toBe(false);
    const replace = assumptionsRequest({ action: "replace", values: ["Quiet fans"], expectedBriefRevision: 3 });
    expect(replace).toEqual({ action: "replace", values: ["Quiet fans"], expectedBriefRevision: 3 });
    expect(assumptionsRequest({ action: "confirm", expectedBriefRevision: 3 }).action).toBe("confirm");
  });
});

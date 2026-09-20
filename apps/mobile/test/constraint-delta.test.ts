import { describe, expect, it } from "vitest";
import { routeFollowUp } from "../src/follow-up-route";
import { mutatingFollowUpKey, revisedQuestionForConstraintDelta } from "../src/constraint-delta";

describe("constraint delta and mutating follow-up identity", () => {
  it("keeps the original laptop goal when the user only changes the budget", () => {
    const original = "best laptop for local AI under 2k";
    const revised = revisedQuestionForConstraintDelta(original, "Actually, under $1,500");
    expect(revised).toContain("laptop");
    expect(revised).toContain("1,500");
    expect(revised).not.toBe("Actually, under $1,500");
    expect(routeFollowUp("Actually, under $1,500", { reportReady: true, runActive: false }).kind).toBe("change_constraint");
  });

  it("uses a stable idempotency key for the same run, revision, and message", () => {
    const a = mutatingFollowUpKey("run-1", 3, "Go deeper on battery life");
    const b = mutatingFollowUpKey("run-1", 3, "Go deeper on battery life");
    const c = mutatingFollowUpKey("run-1", 4, "Go deeper on battery life");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(routeFollowUp("Go deeper on battery life", { reportReady: true, runActive: false }).kind).toBe("deepen");
  });
});

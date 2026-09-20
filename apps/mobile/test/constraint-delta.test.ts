import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeFollowUp } from "../src/follow-up-route";
import { adoptReturnedChild, mutatingFollowUpKey, revisedQuestionForConstraintDelta } from "../src/constraint-delta";

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

  it("adopts a returned child for select, refresh, and poll and never uses the parent", async () => {
    const calls: string[] = [];
    const runId = await adoptReturnedChild({
      parentRunId: "parent-run",
      body: { runId: "child-run" },
      selectRun: (id) => calls.push(`select:${id}`),
      refresh: async (id) => { calls.push(`refresh:${id}`); },
      poll: (id) => calls.push(`poll:${id}`),
    });
    expect(runId).toBe("child-run");
    expect(calls).toEqual(["select:child-run", "refresh:child-run", "poll:child-run"]);
    expect(calls.some((call) => call.endsWith(":parent-run"))).toBe(false);
    const app = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(app).toContain("adoptReturnedChild");
    expect(app).toMatch(/onExplainFollowUp[\s\S]*adoptReturnedChild\(/);
    expect(app).toMatch(/action: "replace"[\s\S]*?adoptReturnedChild\(/);
  });

  it("refreshes the current run when the body has no child", async () => {
    const calls: string[] = [];
    const runId = await adoptReturnedChild({
      parentRunId: "parent-run",
      body: {},
      selectRun: (id) => calls.push(`select:${id}`),
      refresh: async (id) => { calls.push(`refresh:${id}`); },
      poll: (id) => calls.push(`poll:${id}`),
    });
    expect(runId).toBe("parent-run");
    expect(calls).toEqual(["refresh:parent-run"]);
  });
});

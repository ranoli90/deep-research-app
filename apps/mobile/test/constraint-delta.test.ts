import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeFollowUp } from "../src/follow-up-route";
import { adoptReturnedChild, followUpPayloadDigest, mutatingFollowUpKey } from "../src/constraint-delta";
import { sha256Hex } from "../src/sha256";
import { preparePendingFollowUp, submitPendingFollowUp, unresolvedFollowUp } from "../src/follow-up-admission";

describe("constraint delta and mutating follow-up identity", () => {
  it("does not concatenate the original question for a budget change", () => {
    const app = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(app).not.toContain("revisedQuestionForConstraintDelta");
    expect(app).toContain("Claim text is unavailable for this conclusion.");
    expect(app).toMatch(/change_constraint[\s\S]*onExplainFollowUp/);
    expect(routeFollowUp("Actually, under $1,500", { reportReady: true, runActive: false }).kind).toBe("change_constraint");
  });

  it("uses a collision-resistant key that distinguishes nearby deepen messages", () => {
    const a = mutatingFollowUpKey("run-1", 3, "Go deeper on battery life");
    const b = mutatingFollowUpKey("run-1", 3, "Go deeper on battery life");
    const c = mutatingFollowUpKey("run-1", 4, "Go deeper on battery life");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    const aa = mutatingFollowUpKey("run-1", 3, "Go deeper on Aa");
    const bb = mutatingFollowUpKey("run-1", 3, "Go deeper on BB");
    expect(aa).not.toBe(bb);
    expect(followUpPayloadDigest("run-1", 3, "Go deeper on Aa")).not.toBe(followUpPayloadDigest("run-1", 3, "Go deeper on BB"));
    expect(sha256Hex("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
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

  it("fails closed when a mutating follow-up response has no run identity", async () => {
    await expect(adoptReturnedChild({
      parentRunId: "parent-run",
      body: {},
      requireRunId: true,
      selectRun: () => undefined,
      refresh: async () => undefined,
      poll: () => undefined,
    })).rejects.toThrow(/not accepted/i);
  });

  it("persists a mutating follow-up identity before the POST and reuses it after a lost response", async () => {
    const parentRunId = "11111111-1111-4111-8111-111111111111";
    const pending = preparePendingFollowUp({ parentRunId, message: "Go deeper on battery life", expectedBriefRevision: 3, kind: "deepen" });
    expect(pending.idempotencyKey).toBe(mutatingFollowUpKey(parentRunId, 3, "Go deeper on battery life"));
    expect(pending.payloadDigest).toBe(followUpPayloadDigest(parentRunId, 3, "Go deeper on battery life"));
    expect(unresolvedFollowUp(pending)).toBe(true);
    const saved: unknown[] = [];
    const posts: string[] = [];
    await expect(submitPendingFollowUp(pending, {
      current: () => true,
      save: async (value) => { saved.push(value); },
      post: async () => { throw new Error("response lost"); },
    })).rejects.toThrow("response lost");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      parentRunId,
      message: "Go deeper on battery life",
      expectedBriefRevision: 3,
      idempotencyKey: pending.idempotencyKey,
      payloadDigest: pending.payloadDigest,
      requestId: pending.requestId,
      phase: "sent",
    });
    const body = await submitPendingFollowUp(pending, {
      current: () => true,
      save: async (value) => { saved.push(value); },
      post: async (_runId, message, revision, key) => {
        posts.push(`${message}:${revision}:${key}`);
        return { kind: "deepen", runId: "child" };
      },
    });
    expect(body).toEqual({ kind: "deepen", runId: "child" });
    expect(posts).toEqual([`Go deeper on battery life:3:${pending.idempotencyKey}`]);
  });

  it("does not treat an unresolved journal entry as replaceable by a different mutation", () => {
    const parentRunId = "11111111-1111-4111-8111-111111111111";
    const pending = preparePendingFollowUp({ parentRunId, message: "Go deeper on Aa", expectedBriefRevision: 3, kind: "deepen" });
    const other = preparePendingFollowUp({ parentRunId, message: "Go deeper on BB", expectedBriefRevision: 3, kind: "deepen" });
    expect(unresolvedFollowUp(pending)).toBe(true);
    expect(pending.idempotencyKey).not.toBe(other.idempotencyKey);
    const app = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(app).toContain("Retry the saved follow-up before sending a different request.");
    expect(app).toMatch(/if \(body\.kind === "explain"\) \{[\s\S]{0,900}followUpExplains/);
    expect(app).not.toMatch(/if \(body\.kind === "explain"\) \{[\s\S]{0,900}pendingFollowUp: null/);
  });
});

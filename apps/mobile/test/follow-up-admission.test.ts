import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api";
import { followUpPayloadDigest, mutatingFollowUpKey } from "../src/constraint-delta";
import {
  bindPendingFollowUp,
  FOLLOW_UP_JOURNAL_PHASES,
  preparePendingFollowUp,
  readPendingFollowUp,
  runMutatingFollowUp,
  submitPendingFollowUp,
  unresolvedFollowUp,
  withdrawPendingFollowUp,
  type PendingFollowUp,
} from "../src/follow-up-admission";
import { bindFollowUpExplain, recordFollowUpExplain } from "../src/follow-up-explain";
import { createSessionStorage, memoryStore } from "../src/persist";
import { applySnapshot, canSubmit, emptyState, startNewResearch } from "../src/state";

const parentRunId = "11111111-1111-4111-8111-111111111111";
const childRunId = "22222222-2222-4222-8222-222222222222";
const nextRequestId = "33333333-3333-4333-8333-333333333333";
const CLEANUP = "Saved follow-up request is invalid. Device cleanup is required before new research.";
const args = {
  parentRunId,
  message: "Go deeper on battery life",
  expectedBriefRevision: 3,
  kind: "deepen" as const,
};

function journalIo(over: {
  current?: () => boolean;
  save?: (value: PendingFollowUp) => Promise<void> | void;
  post?: (...postArgs: [string, string, number, string]) => Promise<unknown>;
  adopt?: (body: { runId: string }) => Promise<void>;
} = {}) {
  const saved: PendingFollowUp[] = [];
  const posts: string[] = [];
  const adopts: string[] = [];
  return {
    saved,
    posts,
    adopts,
    current: over.current ?? (() => true),
    save: async (value: PendingFollowUp) => {
      await over.save?.(value);
      saved.push(structuredClone(value));
    },
    post: async (runId: string, message: string, revision: number, key: string) => {
      posts.push(`${message}:${revision}:${key}`);
      if (over.post) return over.post(runId, message, revision, key);
      return { kind: "deepen", runId: childRunId, briefRevision: 4 };
    },
    adopt: async (body: { runId: string }) => {
      adopts.push(body.runId);
      await over.adopt?.(body);
    },
  };
}

function terminalJournal(phase: "adopted" | "rejected" | "withdrawn"): PendingFollowUp {
  const prepared = preparePendingFollowUp(args);
  return phase === "adopted"
    ? { ...prepared, phase, acceptedRunId: childRunId, acceptedBriefRevision: 4 }
    : { ...prepared, phase };
}

function damageTerminal(phase: "adopted" | "rejected" | "withdrawn"): PendingFollowUp {
  const pending = { ...terminalJournal(phase) } as Record<string, unknown>;
  if (phase === "adopted") pending.payloadDigest = "f".repeat(64);
  if (phase === "rejected") delete pending.requestId;
  if (phase === "withdrawn") pending.idempotencyKey = `${parentRunId}-followup-3-legacy`;
  return pending as unknown as PendingFollowUp;
}

describe("R-03/CL-04 mutating follow-up journal failure matrix", () => {
  it("persists prepared then sent before POST and keeps SHA-256 identity", async () => {
    const pending = preparePendingFollowUp(args);
    expect(pending.phase).toBe("prepared");
    expect(pending.idempotencyKey).toBe(mutatingFollowUpKey(parentRunId, 3, args.message));
    expect(pending.payloadDigest).toBe(followUpPayloadDigest(parentRunId, 3, args.message));
    const io = journalIo();
    const adopted = await runMutatingFollowUp({ ...args, pending, ...io });
    expect(io.saved.map((row) => row.phase)).toEqual(["prepared", "sent", "accepted", "adopted"]);
    expect(io.posts).toEqual([`${args.message}:3:${pending.idempotencyKey}`]);
    expect(io.adopts).toEqual([childRunId]);
    expect(adopted.phase).toBe("adopted");
    expect(adopted.acceptedRunId).toBe(childRunId);
    expect(FOLLOW_UP_JOURNAL_PHASES).toEqual(["prepared", "sent", "accepted", "adopted", "rejected", "withdrawn"]);
  });

  it("does not POST when prepared persist fails", async () => {
    const io = journalIo({ save: async (value) => { if (value.phase === "prepared") throw new Error("disk full"); } });
    await expect(runMutatingFollowUp({ ...args, pending: null, ...io })).rejects.toThrow("disk full");
    expect(io.posts).toEqual([]);
    expect(io.adopts).toEqual([]);
    expect(io.saved.map((row) => row.phase)).toEqual([]);
  });

  it("keeps prepared when sent persist fails and does not POST", async () => {
    const io = journalIo({ save: async (value) => { if (value.phase === "sent") throw new Error("disk full"); } });
    await expect(runMutatingFollowUp({ ...args, pending: null, ...io })).rejects.toThrow("disk full");
    expect(io.saved.map((row) => row.phase)).toEqual(["prepared"]);
    expect(io.posts).toEqual([]);
  });

  it("survives a lost response as sent and retries the same key", async () => {
    const pending = preparePendingFollowUp(args);
    const first = journalIo({ post: async () => { throw new Error("response lost"); } });
    await expect(runMutatingFollowUp({ ...args, pending, ...first })).rejects.toThrow("response lost");
    expect(first.saved.at(-1)?.phase).toBe("sent");
    expect(unresolvedFollowUp(first.saved.at(-1))).toBe(true);
    const restored = readPendingFollowUp(first.saved.at(-1))!;
    const second = journalIo();
    await runMutatingFollowUp({ ...args, pending: restored, ...second });
    expect(second.posts).toEqual([`${args.message}:3:${pending.idempotencyKey}`]);
    expect(second.saved[0]?.requestId).toBe(pending.requestId);
  });

  it("reuses the same request on double-tap and blocks a different mutation", () => {
    const first = bindPendingFollowUp(null, args);
    const again = bindPendingFollowUp(first, args);
    expect(again.requestId).toBe(first.requestId);
    expect(again.idempotencyKey).toBe(first.idempotencyKey);
    expect(() => bindPendingFollowUp(first, { ...args, message: "Go deeper on thermals" })).toThrow(
      "Retry the saved follow-up before sending a different request.",
    );
    expect(mutatingFollowUpKey(parentRunId, 3, "Go deeper on Aa")).not.toBe(mutatingFollowUpKey(parentRunId, 3, "Go deeper on BB"));
  });

  it.each(["adopted", "rejected", "withdrawn"] as const)(
    "strictly parses damaged %s before deciding a new request may replace it",
    (phase) => {
      const damaged = damageTerminal(phase);
      expect(() => bindPendingFollowUp(damaged, {
        ...args,
        message: "Investigate thermal throttling",
        requestId: nextRequestId,
      })).toThrow(CLEANUP);
    },
  );

  it.each(["adopted", "rejected", "withdrawn"] as const)(
    "allows a new request after a valid %s record is strictly validated",
    (phase) => {
      const next = bindPendingFollowUp(terminalJournal(phase), {
        ...args,
        message: "Investigate thermal throttling",
        requestId: nextRequestId,
      });
      expect(next).toMatchObject({
        phase: "prepared",
        message: "Investigate thermal throttling",
        requestId: nextRequestId,
      });
      expect(next.payloadDigest).toBe(followUpPayloadDigest(parentRunId, 3, "Investigate thermal throttling"));
    },
  );

  it.each(["adopted", "rejected", "withdrawn"] as const)(
    "production runner holds damaged %s without save, POST, adoption, or replacement identity",
    async (phase) => {
      const io = journalIo();
      await expect(runMutatingFollowUp({
        ...args,
        message: "Investigate thermal throttling",
        pending: damageTerminal(phase),
        ...io,
      })).rejects.toThrow(CLEANUP);
      expect(io.saved).toEqual([]);
      expect(io.posts).toEqual([]);
      expect(io.adopts).toEqual([]);
    },
  );

  it("keeps sent on 401 and does not mark rejected", async () => {
    const io = journalIo({ post: async () => { throw new ApiError(401, "Sign in required."); } });
    await expect(runMutatingFollowUp({ ...args, pending: null, ...io })).rejects.toMatchObject({ status: 401 });
    expect(io.saved.map((row) => row.phase)).toEqual(["prepared", "sent"]);
    expect(unresolvedFollowUp(io.saved.at(-1))).toBe(true);
  });

  it("persists rejected on 409 so a different mutation can proceed", async () => {
    const io = journalIo({ post: async () => { throw new ApiError(409, "stale_revision"); } });
    await expect(runMutatingFollowUp({ ...args, pending: null, ...io })).rejects.toMatchObject({ status: 409 });
    expect(io.saved.at(-1)?.phase).toBe("rejected");
    expect(unresolvedFollowUp(io.saved.at(-1))).toBe(false);
    const next = bindPendingFollowUp(io.saved.at(-1), { ...args, message: "Only official sources" });
    expect(next.phase).toBe("prepared");
    expect(next.message).toBe("Only official sources");
  });

  it("keeps sent when a mutating response is empty", async () => {
    const io = journalIo({ post: async () => ({}) });
    await expect(runMutatingFollowUp({ ...args, pending: null, ...io })).rejects.toThrow(/not accepted/i);
    expect(io.saved.map((row) => row.phase)).toEqual(["prepared", "sent"]);
    expect(io.adopts).toEqual([]);
    expect(unresolvedFollowUp(io.saved.at(-1))).toBe(true);
  });

  it("does not POST after the view is superseded", async () => {
    let current = true;
    const io = journalIo({
      current: () => current,
      save: async (value) => { if (value.phase === "prepared") current = false; },
    });
    await expect(runMutatingFollowUp({ ...args, pending: null, ...io })).rejects.toThrow("superseded");
    expect(io.posts).toEqual([]);
    expect(io.saved.map((row) => row.phase)).toEqual(["prepared"]);
  });

  it("keeps accepted when adopt fails and retries without a second POST", async () => {
    const io = journalIo({ adopt: async () => { throw new Error("child GET lost"); } });
    await expect(runMutatingFollowUp({ ...args, pending: null, ...io })).rejects.toThrow("child GET lost");
    expect(io.saved.at(-1)?.phase).toBe("accepted");
    expect(io.posts).toHaveLength(1);
    const retry = journalIo();
    await runMutatingFollowUp({ ...args, pending: io.saved.at(-1)!, ...retry });
    expect(retry.posts).toEqual([]);
    expect(retry.adopts).toEqual([childRunId]);
    expect(retry.saved.at(-1)?.phase).toBe("adopted");
  });

  it("withdraws a prepared journal and refuses to withdraw a sent one", async () => {
    const pending = preparePendingFollowUp(args);
    const saved: PendingFollowUp[] = [];
    const withdrawn = await withdrawPendingFollowUp(pending, {
      current: () => true,
      save: async (value) => { saved.push(value); },
    });
    expect(withdrawn.phase).toBe("withdrawn");
    expect(unresolvedFollowUp(withdrawn)).toBe(false);
    const sent = { ...pending, phase: "sent" as const };
    await expect(withdrawPendingFollowUp(sent, { current: () => true, save: async () => undefined })).rejects.toThrow(/Retry the saved follow-up/);
  });

  it("does not let a read-only explanation clear a pending mutation", () => {
    const pending = preparePendingFollowUp(args);
    const bound = bindFollowUpExplain({
      accountId: "acct-a",
      runId: parentRunId,
      reportId: "report-a",
      question: "Why did you choose that one?",
      answer: "Because of the owned passage.",
      evidenceComplete: true,
      citationPassageIds: ["passage-1"],
    });
    const recorded = recordFollowUpExplain({ pendingFollowUp: pending, followUpExplains: [] }, bound);
    expect(recorded.pendingFollowUp).toEqual(pending);
    expect(recorded.followUpExplains).toHaveLength(1);
    const app = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(app).toContain("recordFollowUpExplain");
    expect(app).toMatch(/if \(body\.kind === "explain"\) \{[\s\S]{0,900}followUpExplains/);
    expect(app).not.toMatch(/if \(body\.kind === "explain"\) \{[\s\S]{0,900}pendingFollowUp: null/);
  });

  it("blocks new research on unresolved journals and keeps them across child snapshots", () => {
    const pending = preparePendingFollowUp(args);
    const state = { ...emptyState(), signedIn: true, pendingFollowUp: pending };
    expect(startNewResearch(state)).toMatchObject({ ok: false, reason: expect.stringMatching(/saved follow-up/) });
    expect(canSubmit({ ...state, consentGranted: true, draft: "New question" }).reason).toMatch(/saved follow-up/);
    const child = applySnapshot(state, {
      runId: childRunId, lifecycle: "queued", phase: "preparing", outcome: null, reportId: null, labeledDemo: false,
    });
    expect(child.pendingFollowUp).toEqual(pending);
    const adopted = { ...pending, phase: "adopted" as const, acceptedRunId: childRunId };
    expect(startNewResearch({ ...state, pendingFollowUp: adopted }).ok).toBe(true);
  });

  it("restores an unresolved journal after restart and keeps Hermes newId", async () => {
    const pending = { ...preparePendingFollowUp(args), phase: "sent" as const };
    const cache = memoryStore(), credentials = memoryStore(), storage = createSessionStorage(cache, credentials);
    await storage.activate({ token: "a", accountId: "a" });
    await storage.persistRequired("a", { ...emptyState(), signedIn: true, pendingFollowUp: pending });
    const restored = await createSessionStorage(cache, credentials).hydrate();
    expect(restored.state.pendingFollowUp).toEqual(pending);
    const app = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(app).toContain("function newId()");
    expect(app).not.toMatch(/crypto\.randomUUID\s*\(/);
    expect(app).toContain("runMutatingFollowUp");
    expect(app).toContain("runAssumptionsMutation");
    expect(app).toContain("runPendingCorrection");
    expect(app).toContain("Retry the saved follow-up before sending a different request.");
    for (const file of ["follow-up-admission.ts", "pending-input.ts", "correction-draft.ts", "constraint-delta.ts", "App.tsx"]) {
      const src = readFileSync(join(import.meta.dirname, file === "App.tsx" ? "../App.tsx" : `../src/${file}`), "utf8");
      expect(src).not.toContain("@deep/research-core");
    }
    await expect(submitPendingFollowUp(pending, {
      current: () => true,
      save: async () => undefined,
      post: async () => ({ kind: "deepen", runId: childRunId }),
    })).resolves.toEqual({ kind: "deepen", runId: childRunId });
  });
});

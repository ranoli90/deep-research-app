import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeFollowUp } from "../src/follow-up-route";
import { adoptReturnedChild, followUpPayloadDigest, mutatingFollowUpKey, persistOwnedJournalSnapshot } from "../src/constraint-delta";
import { sha256Hex } from "../src/sha256";
import { preparePendingFollowUp, submitPendingFollowUp, unresolvedFollowUp, withFollowUpPhase } from "../src/follow-up-admission";
import { createSessionStorage, memoryStore } from "../src/persist";
import { createRequestScope, SupersededRequest } from "../src/request-scope";
import { emptyState, type UiState } from "../src/state";

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
    expect(app).toMatch(/onCorrect[\s\S]*?adoptReturnedChild\([\s\S]*?captureView:[\s\S]*?onView:/);
    expect(app).toMatch(/onExplainFollowUp[\s\S]*?adoptReturnedChild\([\s\S]*?captureView:[\s\S]*?onView:/);
    expect(app).toMatch(/action: "replace"[\s\S]*?adoptReturnedChild\([\s\S]*?captureView:[\s\S]*?onView:/);
    expect(app).toContain("requireOwnedSnapshot");
    expect(app).toMatch(/onCancel[\s\S]*?invalidateView\(token\)[\s\S]*?api\.cancel/);
    expect(app.match(/persistMutationJournal\(token, guard, "pendingFollowUp"/g)).toHaveLength(1);
    expect(app.match(/persistMutationJournal\(token, guard, "pendingAssumptions"/g)).toHaveLength(3);
    expect(app.match(/persistMutationJournal\(token, guard, "pendingCorrection"/g)).toHaveLength(1);
    expect(app).toMatch(/synchronize: \(next\) => \{[\s\S]*?latestUi\.current = next;[\s\S]*?setStateRaw/);
    expect(app).toMatch(/onExplainFollowUp[\s\S]*?!current\.consentGranted[\s\S]*?followUpBusy\.current = true/);
    expect(app).toMatch(/onRevoke=[\s\S]*?api\.invalidateView\(token\);[\s\S]*?latestUi\.current = denied;[\s\S]*?mutationJournalWrite\.current[\s\S]*?sessionStorage\.persistRequired\(token, revoked\)[\s\S]*?api\.consent\(token, false\)/);
    expect(app).not.toMatch(/onRevoke=[\s\S]{0,160}if \(correctionAttempt\.current\) api\.invalidateView/);
  });

  it("keeps the durable accepted journal in the authoritative state before a deferred render and child snapshot", async () => {
    const token = "token-a", accountId = "account-a";
    const parentRunId = "11111111-1111-4111-8111-111111111111";
    const childRunId = "22222222-2222-4222-8222-222222222222";
    const cache = memoryStore(), credentials = memoryStore();
    const storage = createSessionStorage(cache, credentials);
    await storage.activate({ token, accountId });
    const prepared = preparePendingFollowUp({ parentRunId, message: "Go deeper", expectedBriefRevision: 3, kind: "deepen" });
    const sent = withFollowUpPhase(prepared, "sent");
    const accepted = withFollowUpPhase(sent, "accepted", { acceptedRunId: childRunId, acceptedBriefRevision: 4 });
    const latest = { current: {
      ...emptyState(), signedIn: true, consentGranted: true, pendingFollowUp: sent,
      run: { runId: parentRunId, lifecycle: "terminal", phase: "writing", outcome: "completed", reportId: null, labeledDemo: false },
    } as UiState };
    await storage.persistRequired(token, latest.current);
    const scope = createRequestScope(); scope.setSession(token); scope.selectRun(parentRunId);
    const view = scope.capture("view", token, parentRunId);
    let rendered = false;
    await persistOwnedJournalSnapshot({
      field: "pendingFollowUp",
      saved: accepted,
      currentState: () => latest.current,
      persist: (next) => storage.persistRequired(token, next),
      current: view.current,
      stillOwned: () => scope.currentRun(token, parentRunId),
      synchronize: (next) => { latest.current = next; },
      render: () => { rendered = true; },
    });
    expect(latest.current.pendingFollowUp).toEqual(accepted);
    expect(rendered).toBe(true);

    // React may not have committed the journal render yet. Production adoption
    // spreads latestUi into the child opening snapshot, so accepted must survive.
    scope.selectRun(childRunId);
    latest.current = {
      ...latest.current,
      run: { runId: childRunId, lifecycle: "queued", phase: "preparing", outcome: null, reportId: null, labeledDemo: false },
    };
    await storage.persistRequired(token, latest.current);
    const childView = scope.capture("view", token, childRunId);
    const adopted = withFollowUpPhase(accepted, "adopted");
    await expect(persistOwnedJournalSnapshot({
      field: "pendingFollowUp",
      saved: adopted,
      currentState: () => latest.current,
      persist: async () => { throw new Error("disk full"); },
      current: childView.current,
      stillOwned: () => scope.currentRun(token, childRunId),
      synchronize: (next) => { latest.current = next; },
      render: () => undefined,
    })).rejects.toThrow("disk full");
    const restored = await createSessionStorage(cache, credentials).hydrate();
    expect(restored.state.pendingFollowUp).toEqual(accepted);
    expect(restored.state.pendingFollowUp?.phase).toBe("accepted");
    childView.release();
    view.release();
  });

  it("keeps accepted recovery held when consent invalidates the view during its durable save", async () => {
    const token = "token-a", accountId = "account-a";
    const parentRunId = "11111111-1111-4111-8111-111111111111";
    const childRunId = "22222222-2222-4222-8222-222222222222";
    const cache = memoryStore(), credentials = memoryStore();
    const storage = createSessionStorage(cache, credentials);
    await storage.activate({ token, accountId });
    const prepared = preparePendingFollowUp({ parentRunId, message: "Go deeper", expectedBriefRevision: 3, kind: "deepen" });
    const accepted = withFollowUpPhase(withFollowUpPhase(prepared, "sent"), "accepted", { acceptedRunId: childRunId });
    const latest = { current: {
      ...emptyState(), signedIn: true, consentGranted: true, pendingFollowUp: withFollowUpPhase(prepared, "sent"),
      run: { runId: parentRunId, lifecycle: "terminal", phase: "writing", outcome: "completed", reportId: null, labeledDemo: false },
    } as UiState };
    const scope = createRequestScope(); scope.setSession(token); scope.selectRun(parentRunId);
    const view = scope.capture("view", token, parentRunId);
    let rendered = false;
    let releasePersist!: () => void;
    let markStarted!: () => void;
    const persistStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const persistGate = new Promise<void>((resolve) => { releasePersist = resolve; });
    const mutation = persistOwnedJournalSnapshot({
      field: "pendingFollowUp",
      saved: accepted,
      currentState: () => latest.current,
      persist: async (next) => { markStarted(); await persistGate; await storage.persistRequired(token, next); },
      current: view.current,
      stillOwned: () => scope.currentRun(token, parentRunId),
      synchronize: (next) => { latest.current = next; },
      render: () => { rendered = true; },
    });
    await persistStarted;
    scope.invalidateView(token);
    latest.current = { ...latest.current, consentGranted: false };
    releasePersist();
    await expect(mutation).rejects.toBeInstanceOf(SupersededRequest);
    expect(rendered).toBe(false);
    expect(latest.current.pendingFollowUp).toEqual(accepted);
    latest.current = { ...latest.current, consentGranted: false };
    await storage.persistRequired(token, latest.current);
    const restored = await createSessionStorage(cache, credentials).hydrate();
    expect(restored.state.consentGranted).toBe(false);
    expect(restored.state.pendingFollowUp).toEqual(accepted);
    expect(unresolvedFollowUp(restored.state.pendingFollowUp)).toBe(true);
    view.release();
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
    expect(app).toContain("runMutatingFollowUp");
    expect(app).toMatch(/if \(body\.kind === "explain"\) \{[\s\S]{0,900}followUpExplains/);
    expect(app).not.toMatch(/if \(body\.kind === "explain"\) \{[\s\S]{0,900}pendingFollowUp: null/);
  });
});

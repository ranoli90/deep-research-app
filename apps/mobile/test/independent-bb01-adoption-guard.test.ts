import { afterEach, describe, expect, it, vi } from "vitest";
import { api, isSupersededRequest } from "../src/api";
import { adoptReturnedChild } from "../src/constraint-delta";
import {
  bindPendingFollowUp,
  runMutatingFollowUp,
  unresolvedFollowUp,
  type MutatingFollowUpKind,
  type PendingFollowUp,
} from "../src/follow-up-admission";
import {
  bindPendingAssumptions,
  runAssumptionsMutation,
  unresolvedAssumptions,
  type PendingAssumptions,
} from "../src/pending-input";
import {
  bindPendingCorrection,
  runPendingCorrection,
  unresolvedCorrection,
  type PendingCorrection,
} from "../src/correction-draft";
import { createSessionStorage, memoryStore, type SessionStorage } from "../src/persist";
import { createRequestScope, SupersededRequest } from "../src/request-scope";
import { applySnapshot, canSubmit, emptyState, startNewResearch, type UiState } from "../src/state";
import { applyRemoteInvalidation, redactInvalidatedContent } from "../src/remote-invalidation";

/**
 * BB-01 independent regressions.
 *
 * GREEN_GETTER (acceptance path after a recapture repair):
 *   let view = scope.capture("view", session, parentRunId)
 *   current = () => view.current()
 *   optional captureView(expectedRun) / onView / currentRun attached on the
 *   runner and adoptReturnedChild argument objects. Unfixed production
 *   runners ignore those ports (excess keys), so this file stays red on
 *   bb80cfd. A correct selectRun → captureView(child) → onView, then await
 *   refresh, rebinds the same getter so save(adopted)/clear can proceed
 *   without a frozen parent VIEW lease.
 *
 * Do NOT recapture inside the test adopt callback: that would green unfixed
 * runners and destroy the red baseline.
 *
 * NEGATIVE CONTROL: `current: () => true` is isolated below and is NOT acceptance.
 * Account-level capture is a forbidden shortcut: it survives unrelated run navigation.
 * Bound parent `guard.current` without onView remains today's App-shaped red control.
 */

const PARENT = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const TOKEN_A = "token-a";
const TOKEN_B = "token-b";
const ACCOUNT_A = "account-a";
const ACCOUNT_B = "account-b";
const DEEPEN = "Go deeper on battery life";
const NEXT_GOAL = "best noise-cancelling headphones under 300";
const ASSUMPTIONS = ["Quiet fans, no RGB"];
const CORRECTION = "Compare reef restoration in colder water";

type Scope = ReturnType<typeof createRequestScope>;
type GuardKind = "view" | "always-true-negative-control" | "account";
type ViewHandle = { current(): boolean; release(): void };
type ViewLease = {
  handoff: boolean;
  current: () => boolean;
  captureView: (runId: string) => ViewHandle;
  onView: (next: ViewHandle) => void;
  currentRun: (runId: string) => boolean;
  parentHandle: ViewHandle;
  captureViewCalls: string[];
  release: () => void;
};

function parentState(over: Partial<UiState> = {}): UiState {
  return {
    ...emptyState(),
    signedIn: true,
    consentGranted: true,
    draft: DEEPEN,
    status: "completed",
    run: {
      runId: PARENT,
      lifecycle: "terminal",
      phase: "writing",
      outcome: "completed",
      reportId: "report-parent",
      labeledDemo: false,
      brief: {
        originalQuestion: "best laptop for running AI under 2k",
        constraints: [],
        revision: 3,
        desiredOutcome: "a cited recommendation",
      },
    },
    report: {
      reportId: "report-parent",
      version: 1,
      blocks: [{ id: "answer", kind: "answer", text: "A cited answer.", claimIds: ["c1"], citationIds: ["p1"] }],
      limitations: [],
      labeledDemo: false,
    },
    attachments: [{ filename: "parent-private.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2, 3]) }],
    ...over,
  };
}

function childSnap(runId = CHILD) {
  return {
    runId,
    lifecycle: "queued" as const,
    phase: "preparing",
    outcome: null,
    reportId: null,
    labeledDemo: false,
    brief: {
      originalQuestion: "best laptop for running AI under 2k",
      constraints: [],
      revision: 4,
      desiredOutcome: "a cited recommendation",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  api.activateSession(null);
  vi.unstubAllGlobals();
});

type Harness = {
  token: string;
  accountId: string;
  cache: ReturnType<typeof memoryStore>;
  credentials: ReturnType<typeof memoryStore>;
  storage: SessionStorage;
  scope: Scope;
  box: { state: UiState };
  posts: string[];
  refreshes: string[];
  polls: string[];
  selects: string[];
  diskPhases: string[];
};

async function createHarness(): Promise<Harness> {
  const cache = memoryStore();
  const credentials = memoryStore();
  const storage = createSessionStorage(cache, credentials);
  await storage.activate({ token: TOKEN_A, accountId: ACCOUNT_A });
  const scope = createRequestScope();
  scope.setSession(TOKEN_A);
  scope.selectRun(PARENT);
  const box = { state: parentState() };
  await storage.persistRequired(TOKEN_A, box.state);
  return {
    token: TOKEN_A,
    accountId: ACCOUNT_A,
    cache,
    credentials,
    storage,
    scope,
    box,
    posts: [],
    refreshes: [],
    polls: [],
    selects: [],
    diskPhases: [],
  };
}

async function relaunch(h: Pick<Harness, "cache" | "credentials">) {
  return createSessionStorage(h.cache, h.credentials).hydrate();
}

function openJournalLease(h: Harness, kind: GuardKind, expectedRun: string): ViewLease {
  let view: ViewHandle = kind === "account"
    ? h.scope.capture("account", h.token)
    : h.scope.capture("view", h.token, expectedRun);
  const parentHandle = view;
  const captureViewCalls: string[] = [];
  const captureView = (runId: string): ViewHandle => {
    captureViewCalls.push(runId);
    if (kind !== "view") return view;
    return h.scope.capture("view", h.token, runId);
  };
  const onView = (next: ViewHandle) => {
    if (kind !== "view") return;
    if (view !== parentHandle && view !== next) view.release();
    view = next;
  };
  const current = kind === "always-true-negative-control" ? () => true : () => view.current();
  return {
    handoff: kind === "view",
    current,
    captureView,
    onView,
    currentRun: (runId) => h.scope.currentRun(h.token, runId),
    parentHandle,
    captureViewCalls,
    release: () => {
      view.release();
      if (parentHandle !== view) parentHandle.release();
    },
  };
}

/** Optional protocol ports. Unfixed runners/helpers ignore extra keys (fail closed). */
function attachHandoffPorts<T extends object>(args: T, lease: ViewLease): T {
  if (!lease.handoff) return args;
  Object.assign(args, {
    captureView: lease.captureView,
    onView: lease.onView,
    currentRun: lease.currentRun,
  });
  return args;
}

function selectOn(h: Harness, id: string) {
  h.selects.push(id);
  h.scope.selectRun(id);
}

async function persistJournal(h: Harness, current: () => boolean, patch: Partial<UiState>) {
  const next = { ...h.box.state, ...patch };
  await h.storage.persistRequired(h.token, next);
  if (!current()) throw new SupersededRequest();
  h.box.state = next;
}

type InvokeResult<T> = {
  error?: unknown;
  result?: T;
  parentLeaseCurrent: boolean;
  captureViewCalls: string[];
};

async function invokeFollowUp(h: Harness, opts: {
  guard?: GuardKind;
  message?: string;
  kind?: MutatingFollowUpKind;
  targetRunId?: string;
  afterAccepted?: () => Promise<void> | void;
  refresh?: (id: string) => Promise<void>;
  failRefresh?: string;
  failSavePhase?: PendingFollowUp["phase"];
} = {}): Promise<InvokeResult<PendingFollowUp>> {
  const pending = h.box.state.pendingFollowUp;
  const message = opts.message ?? pending?.message ?? DEEPEN;
  const kind = opts.kind ?? pending?.kind ?? "deepen";
  const parentRunId = pending?.parentRunId ?? h.box.state.run!.runId;
  const revision = pending?.expectedBriefRevision ?? h.box.state.run!.brief!.revision;
  h.scope.selectRun(parentRunId);
  const lease = openJournalLease(h, opts.guard ?? "view", parentRunId);
  try {
    const runnerArgs = {
      pending,
      parentRunId,
      message,
      expectedBriefRevision: revision,
      kind,
      current: lease.current,
      save: async (saved: PendingFollowUp) => {
        if (opts.failSavePhase === saved.phase) throw new Error("disk full");
        h.diskPhases.push(saved.phase);
        await persistJournal(h, lease.current, { pendingFollowUp: saved });
        if (saved.phase === "accepted") await opts.afterAccepted?.();
      },
      post: async (runId: string, msg: string, rev: number, key: string) => {
        h.posts.push(`${runId}:${msg}:${rev}:${key}`);
        return { kind, runId: opts.targetRunId ?? CHILD, briefRevision: 4 };
      },
      adopt: async (body: { runId: string; kind?: string; briefRevision?: number }) => {
        const adoptArgs = {
          parentRunId,
          body,
          requireRunId: true as const,
          selectRun: (id: string) => selectOn(h, id),
          refresh: async (id: string) => {
            h.refreshes.push(id);
            if (opts.failRefresh) throw new Error(opts.failRefresh);
            if (opts.refresh) await opts.refresh(id);
            else h.box.state = applySnapshot(h.box.state, childSnap(id));
          },
          poll: (id: string) => { h.polls.push(id); },
        };
        await adoptReturnedChild(attachHandoffPorts(adoptArgs, lease));
      },
    };
    const adopted = await runMutatingFollowUp(attachHandoffPorts(runnerArgs, lease));
    const cleared = adopted.phase === "adopted" ? null : adopted;
    await persistJournal(h, lease.current, {
      pendingFollowUp: cleared,
      draft: h.box.state.draft.trim() === message ? "" : h.box.state.draft,
    });
    return { result: adopted, parentLeaseCurrent: lease.parentHandle.current(), captureViewCalls: [...lease.captureViewCalls] };
  } catch (error) {
    return { error, parentLeaseCurrent: lease.parentHandle.current(), captureViewCalls: [...lease.captureViewCalls] };
  } finally {
    lease.release();
  }
}

async function invokeAssumptions(h: Harness, opts: {
  guard?: GuardKind;
  action?: "replace" | "confirm";
  afterAccepted?: () => Promise<void> | void;
} = {}): Promise<InvokeResult<PendingAssumptions>> {
  const pending = h.box.state.pendingAssumptions;
  const parentRunId = pending?.parentRunId ?? h.box.state.run!.runId;
  const revision = pending?.expectedBriefRevision ?? h.box.state.run!.brief!.revision;
  const action = opts.action ?? pending?.action ?? "replace";
  const values = action === "confirm" ? undefined : (pending?.values ?? ASSUMPTIONS);
  const targetRunId = action === "confirm" ? parentRunId : CHILD;
  h.scope.selectRun(parentRunId);
  const lease = openJournalLease(h, opts.guard ?? "view", parentRunId);
  try {
    const runnerArgs = {
      pending,
      parentRunId,
      action,
      values,
      expectedBriefRevision: revision,
      current: lease.current,
      save: async (saved: PendingAssumptions) => {
        h.diskPhases.push(saved.phase);
        await persistJournal(h, lease.current, { pendingAssumptions: saved });
        if (saved.phase === "accepted") await opts.afterAccepted?.();
      },
      post: async (runId: string, _body: unknown, key: string) => {
        h.posts.push(`${runId}:assumptions:${key}`);
        return action === "confirm" ? { briefRevision: 4 } : { runId: targetRunId, briefRevision: 4 };
      },
      adopt: async (body: { runId?: string; briefRevision?: number }) => {
        const adoptArgs = {
          parentRunId,
          body,
          requireRunId: action === "replace",
          selectRun: (id: string) => selectOn(h, id),
          refresh: async (id: string) => {
            h.refreshes.push(id);
            h.box.state = applySnapshot(h.box.state, childSnap(id));
          },
          poll: (id: string) => { h.polls.push(id); },
        };
        await adoptReturnedChild(attachHandoffPorts(adoptArgs, lease));
      },
    };
    const adopted = await runAssumptionsMutation(attachHandoffPorts(runnerArgs, lease));
    await persistJournal(h, lease.current, { pendingAssumptions: adopted.phase === "adopted" ? null : adopted });
    return { result: adopted, parentLeaseCurrent: lease.parentHandle.current(), captureViewCalls: [...lease.captureViewCalls] };
  } catch (error) {
    return { error, parentLeaseCurrent: lease.parentHandle.current(), captureViewCalls: [...lease.captureViewCalls] };
  } finally {
    lease.release();
  }
}

async function invokeCorrection(h: Harness, opts: {
  guard?: GuardKind;
  afterAccepted?: () => Promise<void> | void;
} = {}): Promise<InvokeResult<PendingCorrection>> {
  const pending = h.box.state.pendingCorrection;
  const parentRunId = pending?.parentRunId ?? h.box.state.run!.runId;
  const revision = pending?.expectedBriefRevision ?? h.box.state.run!.brief!.revision;
  const question = pending?.question ?? CORRECTION;
  h.scope.selectRun(parentRunId);
  const lease = openJournalLease(h, opts.guard ?? "view", parentRunId);
  try {
    const runnerArgs = {
      pending,
      parentRunId,
      question,
      expectedBriefRevision: revision,
      evidencePolicy: "reuse_snapshot" as const,
      current: lease.current,
      save: async (saved: PendingCorrection) => {
        h.diskPhases.push(saved.phase);
        await persistJournal(h, lease.current, { pendingCorrection: saved });
        if (saved.phase === "accepted") await opts.afterAccepted?.();
      },
      post: async (runId: string, text: string, rev: number, policy: "reuse_snapshot" | "refresh", key: string) => {
        h.posts.push(`${runId}:${text}:${rev}:${policy}:${key}`);
        return { runId: CHILD, briefRevision: 4 };
      },
      adopt: async (body: { runId: string; briefRevision?: number }) => {
        const adoptArgs = {
          parentRunId,
          body,
          requireRunId: true as const,
          selectRun: (id: string) => selectOn(h, id),
          refresh: async (id: string) => {
            h.refreshes.push(id);
            h.box.state = applySnapshot(h.box.state, childSnap(id));
          },
          poll: (id: string) => { h.polls.push(id); },
        };
        await adoptReturnedChild(attachHandoffPorts(adoptArgs, lease));
      },
    };
    const adopted = await runPendingCorrection(attachHandoffPorts(runnerArgs, lease));
    await persistJournal(h, lease.current, { pendingCorrection: adopted.phase === "adopted" ? null : adopted });
    return { result: adopted, parentLeaseCurrent: lease.parentHandle.current(), captureViewCalls: [...lease.captureViewCalls] };
  } catch (error) {
    return { error, parentLeaseCurrent: lease.parentHandle.current(), captureViewCalls: [...lease.captureViewCalls] };
  } finally {
    lease.release();
  }
}

function expectHandoffFinished(
  h: Harness,
  journal: PendingFollowUp | PendingAssumptions | PendingCorrection | null | undefined,
  kind: "followUp" | "assumptions" | "correction",
  parentLeaseCurrent: boolean,
) {
  expect(h.diskPhases).toEqual(["prepared", "sent", "accepted", "adopted"]);
  expect(journal?.phase).toBe("adopted");
  expect(journal?.acceptedRunId).toBe(CHILD);
  expect(h.selects).toEqual([CHILD]);
  expect(h.refreshes).toEqual([CHILD]);
  expect(h.polls).toEqual([CHILD]);
  expect(h.scope.currentRun(TOKEN_A, CHILD)).toBe(true);
  expect(parentLeaseCurrent, "parent VIEW lease must be dead after selectRun(child); skip-viewEpoch is not a fix").toBe(false);
  const childView = h.scope.capture("view", TOKEN_A, CHILD);
  expect(childView.current()).toBe(true);
  childView.release();
  expect(() => h.scope.capture("view", TOKEN_A, PARENT)).toThrow(/superseded/i);
  expect(h.posts).toHaveLength(1);
  if (kind === "followUp") {
    expect(h.box.state.pendingFollowUp).toBeNull();
    expect(unresolvedFollowUp(h.box.state.pendingFollowUp)).toBe(false);
  }
  if (kind === "assumptions") {
    expect(h.box.state.pendingAssumptions).toBeNull();
    expect(unresolvedAssumptions(h.box.state.pendingAssumptions)).toBe(false);
  }
  if (kind === "correction") {
    expect(h.box.state.pendingCorrection).toBeNull();
    expect(unresolvedCorrection(h.box.state.pendingCorrection)).toBe(false);
  }
}

describe("BB-01 real request-scope + production journal + adoption", () => {
  it("BB01-01 real parent-to-child view handoff persists prepared→sent→accepted→adopted, clears the journal, and allows a subsequent question", async () => {
    const h = await createHarness();
    const outcome = await invokeFollowUp(h);
    expect(outcome.error, `production view guard must not throw after intentional child adoption: ${String((outcome.error as Error)?.message ?? outcome.error)}`).toBeUndefined();
    expectHandoffFinished(h, outcome.result, "followUp", outcome.parentLeaseCurrent);
    expect(outcome.captureViewCalls).toContain(CHILD);
    const afterAdopt = h.scope.capture("view", TOKEN_A, CHILD);
    h.scope.selectRun(OTHER);
    expect(afterAdopt.current()).toBe(false);
    afterAdopt.release();
    expect(h.scope.currentRun(TOKEN_A, OTHER)).toBe(true);

    const disk = await relaunch(h);
    expect(disk.state.pendingFollowUp).toBeNull();
    expect(unresolvedFollowUp(disk.state.pendingFollowUp)).toBe(false);

    const nextState = { ...h.box.state, draft: NEXT_GOAL, attachments: [] };
    expect(canSubmit(nextState).ok).toBe(true);
    const started = startNewResearch(nextState);
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.next.attachments).toEqual([]);
      expect(started.next.pendingFollowUp).toBeNull();
      expect(started.next.draft).toBe("");
    }

    const next = bindPendingFollowUp(disk.state.pendingFollowUp, {
      parentRunId: CHILD,
      message: "Go deeper on thermals",
      expectedBriefRevision: 4,
      kind: "deepen",
    });
    expect(next.phase).toBe("prepared");
    expect(next.parentRunId).toBe(CHILD);
    expect(next.message).toBe("Go deeper on thermals");
    expect(next.requestId).not.toBe(outcome.result!.requestId);
  });

  it("NEGATIVE CONTROL (not acceptance): current: () => true reaches adopted and currently masks the view-guard defect", async () => {
    const h = await createHarness();
    const outcome = await invokeFollowUp(h, { guard: "always-true-negative-control" });
    expect(outcome.error).toBeUndefined();
    expectHandoffFinished(h, outcome.result, "followUp", outcome.parentLeaseCurrent);
    const view = h.scope.capture("view");
    expect(view.current()).toBe(true);
    h.scope.selectRun(OTHER);
    expect(view.current()).toBe(false);
    view.release();
  });

  it("BB01-02 same-run steering does not replace the view and still finalizes the journal", async () => {
    const h = await createHarness();
    const outcome = await invokeFollowUp(h, { kind: "steer", targetRunId: PARENT });
    expect(outcome.error).toBeUndefined();
    expect(outcome.result?.phase).toBe("adopted");
    expect(h.diskPhases).toEqual(["prepared", "sent", "accepted", "adopted"]);
    expect(h.selects).toEqual([]);
    expect(h.refreshes).toEqual([PARENT]);
    expect(h.polls).toEqual([]);
    expect(outcome.parentLeaseCurrent).toBe(true);
    expect(h.scope.currentRun(TOKEN_A, PARENT)).toBe(true);
    expect(h.box.state.pendingFollowUp).toBeNull();
    expect(canSubmit({ ...h.box.state, draft: NEXT_GOAL }).ok).toBe(true);
  });

  it("BB01-03 unrelated navigation between accepted response and adoption does not force the child or duplicate POST", async () => {
    const h = await createHarness();
    const outcome = await invokeFollowUp(h, {
      afterAccepted: () => { h.scope.selectRun(OTHER); },
    });
    expect(isSupersededRequest(outcome.error)).toBe(true);
    expect(h.diskPhases).toEqual(["prepared", "sent", "accepted"]);
    expect(h.selects).toEqual([]);
    expect(h.posts).toHaveLength(1);
    expect(h.scope.currentRun(TOKEN_A, OTHER)).toBe(true);
    expect(h.scope.currentRun(TOKEN_A, CHILD)).toBe(false);
    const disk = await relaunch(h);
    expect(disk.state.pendingFollowUp?.phase).toBe("accepted");
    expect(disk.state.pendingFollowUp?.acceptedRunId).toBe(CHILD);
    expect(disk.state.pendingFollowUp?.requestId).toBe(h.box.state.pendingFollowUp?.requestId);
    expect(unresolvedFollowUp(disk.state.pendingFollowUp)).toBe(true);
    expect(bindPendingFollowUp(disk.state.pendingFollowUp, {
      parentRunId: disk.state.pendingFollowUp!.parentRunId,
      message: disk.state.pendingFollowUp!.message,
      expectedBriefRevision: disk.state.pendingFollowUp!.expectedBriefRevision,
      kind: "deepen",
    }).idempotencyKey).toBe(disk.state.pendingFollowUp!.idempotencyKey);
    expect(h.posts).toHaveLength(1);
  });

  it("BB01-03b unrelated navigation during child refresh does not finalize adopted", async () => {
    const h = await createHarness();
    const outcome = await invokeFollowUp(h, {
      refresh: async (id) => {
        h.box.state = applySnapshot(h.box.state, childSnap(id));
        h.scope.selectRun(OTHER);
      },
    });
    expect(isSupersededRequest(outcome.error)).toBe(true);
    expect(h.diskPhases).toEqual(["prepared", "sent", "accepted"]);
    expect(h.scope.currentRun(TOKEN_A, OTHER)).toBe(true);
    expect(h.scope.currentRun(TOKEN_A, CHILD)).toBe(false);
    expect((await relaunch(h)).state.pendingFollowUp?.phase).toBe("accepted");
    expect(h.posts).toHaveLength(1);
  });

  it("BB01-04 account switch after accepted does not persist or render account A under B, and does not resend", async () => {
    const h = await createHarness();
    const outcome = await invokeFollowUp(h, {
      afterAccepted: async () => {
        h.scope.setSession(TOKEN_B);
        await h.storage.activate({ token: TOKEN_B, accountId: ACCOUNT_B });
      },
    });
    expect(outcome.error).toBeDefined();
    expect(h.selects).toEqual([]);
    expect(h.posts).toHaveLength(1);
    const underB = await relaunch(h);
    expect(underB.accountId).toBe(ACCOUNT_B);
    expect(underB.state.pendingFollowUp).toBeNull();
    expect(underB.state.report).toBeNull();
    expect(underB.state.draft).toBe("");
    await expect(h.storage.persistRequired(TOKEN_A, parentState({ pendingFollowUp: { ...h.box.state.pendingFollowUp! } }))).rejects.toThrow(/Session changed/);
  });

  it("BB01-04b cancellation invalidates the accepted parent view before child adoption", async () => {
    const h = await createHarness();
    const outcome = await invokeFollowUp(h, {
      afterAccepted: () => { h.scope.invalidateView(TOKEN_A); },
    });
    expect(isSupersededRequest(outcome.error)).toBe(true);
    expect(h.diskPhases).toEqual(["prepared", "sent", "accepted"]);
    expect(h.selects).toEqual([]);
    expect(h.posts).toHaveLength(1);
    expect(h.scope.currentRun(TOKEN_A, PARENT)).toBe(true);
    const disk = await relaunch(h);
    expect(disk.state.pendingFollowUp?.phase).toBe("accepted");
    expect(disk.state.pendingFollowUp?.acceptedRunId).toBe(CHILD);
  });
  it("BB01-05 deletion while the child loads does not return deleted snapshot, history, citation, or draft content", async () => {
    const h = await createHarness();
    const outcome = await invokeFollowUp(h, {
      refresh: async (id) => {
        const poisoned = {
          ...h.box.state,
          report: {
            reportId: "secret-report",
            blocks: [{ id: "answer", kind: "answer", text: "deleted source contents", claimIds: ["c1"], citationIds: ["p1"] }],
            limitations: [],
            labeledDemo: false,
          },
          previousReport: { reportId: "secret-report", blocks: [{ id: "answer", kind: "answer", text: "old deleted", claimIds: [], citationIds: [] }] },
          source: { passageId: "p1", title: "Secret", exactText: "deleted source contents", accessLevel: "full-text" as const },
        };
        const snap = { ...childSnap(id), contentInvalidated: true, reportId: "secret-report" };
        let hidden = applySnapshot(poisoned, snap);
        const account = h.scope.capture("account");
        try {
          await applyRemoteInvalidation(hidden, snap, {
            current: account.current,
            hide: () => { hidden = redactInvalidatedContent(hidden, id); },
            save: async (next, runId) => { await h.storage.redactRunContent(h.token, runId, next); h.box.state = next; },
          });
        } finally {
          account.release();
        }
        expect(h.box.state.report).toBeNull();
        expect(h.box.state.previousReport).toBeNull();
        expect(h.box.state.source).toBeNull();
        expect(JSON.stringify(h.box.state)).not.toMatch(/deleted source contents/);
      },
    });
    expect(h.refreshes).toEqual([CHILD]);
    expect(h.box.state.report).toBeNull();
    expect(h.box.state.run?.contentInvalidated).toBe(true);
    const disk = await relaunch(h);
    expect(disk.state.report).toBeNull();
    expect(disk.state.previousReport).toBeNull();
    expect(JSON.stringify(disk.state)).not.toMatch(/deleted source contents/);
    expect(outcome.error === undefined || isSupersededRequest(outcome.error)).toBe(true);
  });

  it("BB01-06 consent revoke plus logout after accepted does not resend and drops the account journal", async () => {
    const h = await createHarness();
    const outcome = await invokeFollowUp(h, {
      afterAccepted: async () => {
        h.box.state = { ...h.box.state, consentGranted: false };
        await h.storage.persistRequired(h.token, h.box.state);
        h.scope.setSession(null);
        await h.storage.clear();
      },
    });
    expect(outcome.error).toBeDefined();
    expect(h.posts).toHaveLength(1);
    expect(h.selects).toEqual([]);
    const disk = await relaunch(h);
    expect(disk.token).toBeNull();
    expect(disk.state.pendingFollowUp).toBeNull();
    expect(disk.state.report).toBeNull();
    expect(canSubmit({ ...emptyState(), draft: NEXT_GOAL, signedIn: true, consentGranted: false }).ok).toBe(false);
  });

  it("BB01-06a consent revoke alone fences follow-up adoption and retains accepted recovery", async () => {
    const h = await createHarness();
    const outcome = await invokeFollowUp(h, {
      afterAccepted: async () => {
        h.box.state = { ...h.box.state, consentGranted: false };
        await h.storage.persistRequired(h.token, h.box.state);
        h.scope.invalidateView(h.token);
      },
    });
    expect(isSupersededRequest(outcome.error)).toBe(true);
    expect(h.posts).toHaveLength(1);
    expect(h.selects).toEqual([]);
    const disk = await relaunch(h);
    expect(disk.state.consentGranted).toBe(false);
    expect(disk.state.pendingFollowUp?.phase).toBe("accepted");
    expect(disk.state.pendingFollowUp?.acceptedRunId).toBe(CHILD);
    expect(unresolvedFollowUp(disk.state.pendingFollowUp)).toBe(true);
  });

  it("BB01-06b consent revoke alone fences assumption adoption and retains accepted recovery", async () => {
    const h = await createHarness();
    const outcome = await invokeAssumptions(h, {
      afterAccepted: async () => {
        h.box.state = { ...h.box.state, consentGranted: false };
        await h.storage.persistRequired(h.token, h.box.state);
        h.scope.invalidateView(h.token);
      },
    });
    expect(isSupersededRequest(outcome.error)).toBe(true);
    expect(h.posts).toHaveLength(1);
    expect(h.selects).toEqual([]);
    const disk = await relaunch(h);
    expect(disk.state.consentGranted).toBe(false);
    expect(disk.state.pendingAssumptions?.phase).toBe("accepted");
    expect(disk.state.pendingAssumptions?.acceptedRunId).toBe(CHILD);
    expect(unresolvedAssumptions(disk.state.pendingAssumptions)).toBe(true);
  });

  it("BB01-07 persistence failure at each phase keeps the last durable identity and does not invent a rejection", async () => {
    const prepared = await createHarness();
    const failPrepared = await invokeFollowUp(prepared, { failSavePhase: "prepared" });
    expect((failPrepared.error as Error).message).toBe("disk full");
    expect(prepared.posts).toEqual([]);
    expect((await relaunch(prepared)).state.pendingFollowUp).toBeNull();

    const sent = await createHarness();
    const failSent = await invokeFollowUp(sent, { failSavePhase: "sent" });
    expect((failSent.error as Error).message).toBe("disk full");
    expect(sent.posts).toEqual([]);
    expect((await relaunch(sent)).state.pendingFollowUp?.phase).toBe("prepared");

    const accepted = await createHarness();
    const failAccepted = await invokeFollowUp(accepted, { failSavePhase: "accepted" });
    expect((failAccepted.error as Error).message).toBe("disk full");
    expect(accepted.posts).toHaveLength(1);
    const sentDisk = await relaunch(accepted);
    expect(sentDisk.state.pendingFollowUp?.phase).toBe("sent");
    expect(sentDisk.state.pendingFollowUp?.phase).not.toBe("rejected");
    accepted.box.state.pendingFollowUp = sentDisk.state.pendingFollowUp;
    const retried = await invokeFollowUp(accepted);
    expect(accepted.posts.length).toBeGreaterThanOrEqual(2);
    expect(accepted.posts[0]!.split(":")[3]).toBe(accepted.posts[1]!.split(":")[3]);
    expect(retried.result?.requestId ?? accepted.box.state.pendingFollowUp?.requestId).toBe(sentDisk.state.pendingFollowUp?.requestId);

    const adopted = await createHarness();
    const failAdopted = await invokeFollowUp(adopted, { failSavePhase: "adopted" });
    expect((failAdopted.error as Error).message).toBe("disk full");
    const acceptedDisk = await relaunch(adopted);
    expect(acceptedDisk.state.pendingFollowUp?.phase).toBe("accepted");
    expect(acceptedDisk.state.pendingFollowUp?.acceptedRunId).toBe(CHILD);
    expect(unresolvedFollowUp(acceptedDisk.state.pendingFollowUp)).toBe(true);
    adopted.box.state.pendingFollowUp = acceptedDisk.state.pendingFollowUp;
    const finish = await invokeFollowUp(adopted);
    expect(adopted.posts).toHaveLength(1);
    expect(finish.error).toBeUndefined();
    expect(finish.result?.phase).toBe("adopted");
    expect(adopted.box.state.pendingFollowUp).toBeNull();
  });

  it("BB01-08 lost child GET keeps accepted durable and retries adopt without a second POST", async () => {
    const h = await createHarness();
    const lost = await invokeFollowUp(h, { failRefresh: "child GET lost" });
    expect((lost.error as Error).message).toBe("child GET lost");
    expect(h.diskPhases).toEqual(["prepared", "sent", "accepted"]);
    expect(h.posts).toHaveLength(1);
    expect(h.selects).toEqual([CHILD]);
    const disk = await relaunch(h);
    expect(disk.state.pendingFollowUp?.phase).toBe("accepted");
    expect(disk.state.pendingFollowUp?.acceptedRunId).toBe(CHILD);
    expect(unresolvedFollowUp(disk.state.pendingFollowUp)).toBe(true);

    h.box.state.pendingFollowUp = disk.state.pendingFollowUp;
    h.box.state.draft = "a different composer draft that must not become a new paid request";
    const retry = await invokeFollowUp(h);
    expect(retry.error).toBeUndefined();
    expect(h.posts).toHaveLength(1);
    expect(retry.result?.phase).toBe("adopted");
    expect(retry.result?.requestId).toBe(disk.state.pendingFollowUp?.requestId);
    expect(retry.result?.acceptedRunId).toBe(CHILD);
    expect(h.box.state.pendingFollowUp).toBeNull();
  });

  it("BB01-09a relaunch of a prepared journal reuses the same requestId and must be able to finish adoption", async () => {
    const prepared = await createHarness();
    const pending = await invokeFollowUp(prepared, { failSavePhase: "sent" });
    expect(pending.error).toBeDefined();
    const preparedDisk = await relaunch(prepared);
    expect(preparedDisk.state.pendingFollowUp?.phase).toBe("prepared");
    prepared.box.state.pendingFollowUp = preparedDisk.state.pendingFollowUp;
    const fromPrepared = await invokeFollowUp(prepared);
    expect(fromPrepared.error).toBeUndefined();
    expect(fromPrepared.result?.requestId).toBe(preparedDisk.state.pendingFollowUp?.requestId);
    expect(fromPrepared.result?.phase).toBe("adopted");
    expect(prepared.box.state.pendingFollowUp).toBeNull();
  });

  it("BB01-09b relaunch of a sent journal POSTs the saved key once and finishes adoption", async () => {
    const sent = await createHarness();
    const pending = await invokeFollowUp(sent, { failRefresh: "child GET lost" });
    expect(pending.error).toBeDefined();
    const acceptedDisk = await relaunch(sent);
    const saved = acceptedDisk.state.pendingFollowUp!;
    sent.box.state.pendingFollowUp = { ...saved, phase: "sent", acceptedRunId: undefined, acceptedBriefRevision: undefined };
    await sent.storage.persistRequired(sent.token, sent.box.state);
    sent.posts.length = 0;
    const fromSent = await invokeFollowUp(sent);
    expect(fromSent.error).toBeUndefined();
    expect(fromSent.result?.phase).toBe("adopted");
    expect(fromSent.result?.requestId).toBe(saved.requestId);
    expect(sent.posts).toHaveLength(1);
    expect(sent.posts[0]).toContain(saved.idempotencyKey);
  });

  it("BB01-09c relaunch of an accepted journal adopts without a second POST and then allows new research", async () => {
    const accepted = await createHarness();
    const lost = await invokeFollowUp(accepted, { failRefresh: "child GET lost" });
    expect(lost.error).toBeDefined();
    const acceptedDisk = await relaunch(accepted);
    expect(acceptedDisk.state.pendingFollowUp?.phase).toBe("accepted");
    accepted.box.state.pendingFollowUp = acceptedDisk.state.pendingFollowUp;
    const fromAccepted = await invokeFollowUp(accepted);
    expect(fromAccepted.error).toBeUndefined();
    expect(accepted.posts).toHaveLength(1);
    expect(fromAccepted.result?.phase).toBe("adopted");
    expect(accepted.box.state.pendingFollowUp).toBeNull();
    expect(startNewResearch(accepted.box.state).ok).toBe(true);
  });

  it("BB01-10 a completed child deepen does not leave an accepted journal that blocks a different next goal", async () => {
    const h = await createHarness();
    const outcome = await invokeFollowUp(h);
    expect(outcome.error).toBeUndefined();
    expect(h.box.state.pendingFollowUp).toBeNull();
    h.box.state = { ...h.box.state, draft: NEXT_GOAL, attachments: [{ filename: "unrelated-private.txt", mime: "text/plain", text: "do not inherit" }] };
    expect(canSubmit(h.box.state).ok).toBe(true);
    expect(canSubmit(h.box.state).reason ?? "").not.toMatch(/saved follow-up/);
    const started = startNewResearch(h.box.state);
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.next.attachments).toEqual([]);
      expect(started.next.pendingFollowUp).toBeNull();
      expect(started.next.run).toBeNull();
    }
  });

  it("BB01-11a assumption replacement uses the same view-guard child handoff", async () => {
    const h = await createHarness();
    const outcome = await invokeAssumptions(h);
    expect(outcome.error, `assumption child handoff must finalize: ${String((outcome.error as Error)?.message ?? outcome.error)}`).toBeUndefined();
    expectHandoffFinished(h, outcome.result, "assumptions", outcome.parentLeaseCurrent);
    const disk = await relaunch(h);
    expect(disk.state.pendingAssumptions).toBeNull();
    expect(startNewResearch(h.box.state).ok).toBe(true);
  });

  it("BB01-11c assumption confirm is same-run and does not selectRun", async () => {
    const h = await createHarness();
    const outcome = await invokeAssumptions(h, { action: "confirm" });
    expect(outcome.error).toBeUndefined();
    expect(outcome.result?.phase).toBe("adopted");
    expect(h.selects).toEqual([]);
    expect(outcome.parentLeaseCurrent).toBe(true);
    expect(h.scope.currentRun(TOKEN_A, PARENT)).toBe(true);
    expect(h.box.state.pendingAssumptions).toBeNull();
  });

  it("BB01-11b assumption replacement still rejects unrelated navigation", async () => {
    const blocked = await createHarness();
    const nav = await invokeAssumptions(blocked, { afterAccepted: () => { blocked.scope.selectRun(OTHER); } });
    expect(isSupersededRequest(nav.error)).toBe(true);
    expect(blocked.diskPhases).toEqual(["prepared", "sent", "accepted"]);
    expect(blocked.scope.currentRun(TOKEN_A, OTHER)).toBe(true);
    expect(blocked.selects).toEqual([]);
    expect(unresolvedAssumptions((await relaunch(blocked)).state.pendingAssumptions)).toBe(true);
  });

  it("BB01-12a text correction uses the same view-guard child handoff and keeps a newer draft", async () => {
    const h = await createHarness();
    h.box.state = { ...h.box.state, draft: "newer draft kept on the device" };
    await h.storage.persistRequired(h.token, h.box.state);
    const outcome = await invokeCorrection(h);
    expect(outcome.error, `correction child handoff must finalize: ${String((outcome.error as Error)?.message ?? outcome.error)}`).toBeUndefined();
    expectHandoffFinished(h, outcome.result, "correction", outcome.parentLeaseCurrent);
    expect(h.box.state.draft).toBe("newer draft kept on the device");
    const disk = await relaunch(h);
    expect(disk.state.pendingCorrection).toBeNull();
    expect(disk.state.draft).toBe("newer draft kept on the device");
    expect(startNewResearch(h.box.state).ok).toBe(true);
  });

  it("BB01-12b text correction still rejects unrelated navigation", async () => {
    const blocked = await createHarness();
    const nav = await invokeCorrection(blocked, { afterAccepted: () => { blocked.scope.selectRun(OTHER); } });
    expect(isSupersededRequest(nav.error)).toBe(true);
    expect(blocked.diskPhases).toEqual(["prepared", "sent", "accepted"]);
    expect(unresolvedCorrection((await relaunch(blocked)).state.pendingCorrection)).toBe(true);
    expect(blocked.scope.currentRun(TOKEN_A, OTHER)).toBe(true);
    expect(blocked.selects).toEqual([]);
  });

  it("BB01-13 view/logout fences still reject stale work; account-level current() is a forbidden shortcut", async () => {
    const h = await createHarness();
    const view = h.scope.capture("view");
    const account = h.scope.capture("account");
    expect(view.current()).toBe(true);
    expect(account.current()).toBe(true);
    h.scope.selectRun(OTHER);
    expect(view.current()).toBe(false);
    expect(account.current()).toBe(true);
    view.release();
    account.release();

    const preparedThenNav = await createHarness();
    const preparedGuard = preparedThenNav.scope.capture("view");
    let blocked: { error?: unknown } = {};
    try {
      await runMutatingFollowUp({
        pending: null,
        parentRunId: PARENT,
        message: DEEPEN,
        expectedBriefRevision: 3,
        kind: "deepen",
        current: preparedGuard.current,
        save: async (saved) => {
          preparedThenNav.diskPhases.push(saved.phase);
          await persistJournal(preparedThenNav, preparedGuard.current, { pendingFollowUp: saved });
          if (saved.phase === "prepared") preparedThenNav.scope.selectRun(OTHER);
        },
        post: async () => {
          preparedThenNav.posts.push("POST");
          return { kind: "deepen", runId: CHILD, briefRevision: 4 };
        },
        adopt: async () => { preparedThenNav.selects.push("adopted"); },
      });
    } catch (error) {
      blocked = { error };
    } finally {
      preparedGuard.release();
    }
    expect(isSupersededRequest(blocked.error)).toBe(true);
    expect(preparedThenNav.posts).toEqual([]);
    expect(preparedThenNav.selects).toEqual([]);
    expect(preparedThenNav.diskPhases).toEqual(["prepared"]);

    const logout = await createHarness();
    logout.scope.selectRun(PARENT);
    const logoutView = logout.scope.capture("view");
    logout.scope.setSession(null);
    expect(logoutView.current()).toBe(false);
    logoutView.release();

    const accountGuard = await createHarness();
    const stolen = await invokeFollowUp(accountGuard, {
      guard: "account",
      afterAccepted: () => { accountGuard.scope.selectRun(OTHER); },
    });
    expect(stolen.error, "account current() ignoring unrelated navigation is the forbidden shortcut, not acceptance").toBeUndefined();
    expect(accountGuard.scope.currentRun(TOKEN_A, CHILD)).toBe(true);
    expect(accountGuard.box.state.pendingFollowUp).toBeNull();
  });

  it("BB01-14 recovery uses the saved parent/message/key, not current composer text or a newly generated request", async () => {
    const h = await createHarness();
    const lost = await invokeFollowUp(h, { failRefresh: "child GET lost" });
    expect(lost.error).toBeDefined();
    const saved = (await relaunch(h)).state.pendingFollowUp!;
    expect(saved.phase).toBe("accepted");
    const savedKey = saved.idempotencyKey;
    const savedId = saved.requestId;

    h.box.state.pendingFollowUp = saved;
    h.box.state.draft = "brand new composer text";
    h.scope.selectRun(CHILD);
    expect(() => bindPendingFollowUp(saved, {
      parentRunId: CHILD,
      message: "brand new composer text",
      expectedBriefRevision: 4,
      kind: "deepen",
    })).toThrow(/Retry the saved follow-up/);
    expect(bindPendingFollowUp(saved, {
      parentRunId: saved.parentRunId,
      message: saved.message,
      expectedBriefRevision: saved.expectedBriefRevision,
      kind: "deepen",
    }).requestId).toBe(savedId);

    const retry = await invokeFollowUp(h);
    expect(retry.error).toBeUndefined();
    expect(retry.result?.requestId).toBe(savedId);
    expect(retry.result?.idempotencyKey).toBe(savedKey);
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]).toContain(savedKey);
    expect(h.box.state.pendingFollowUp).toBeNull();
  });

  it("BB01-13 late production api.getRun after selectRun(child) cannot apply the parent snapshot", async () => {
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => response.promise));
    api.activateSession(TOKEN_A);
    api.selectRun(PARENT);
    const pending = api.getRun(TOKEN_A, PARENT).catch((error) => error);
    api.selectRun(CHILD);
    response.resolve(Response.json({ runId: PARENT, reportId: "parent-only", secret: "must not render" }));
    expect(isSupersededRequest(await pending)).toBe(true);
    expect(api.currentRun(TOKEN_A, CHILD)).toBe(true);
  });
});

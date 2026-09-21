import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { followUpPayloadDigest, mutatingFollowUpKey } from "../src/constraint-delta";
import {
  preparePendingFollowUp,
  readPendingFollowUp,
  runMutatingFollowUp,
  type PendingFollowUp,
} from "../src/follow-up-admission";
import { preparePendingAssumptions, readPendingAssumptions } from "../src/pending-input";
import { preparePendingCorrection, readPendingCorrection } from "../src/correction-draft";
import { createSessionStorage, hydrateOnLaunch, memoryStore } from "../src/persist";
import { emptyState, startNewResearch, type UiState } from "../src/state";

/** This-wave journal is pendingFollowUp only. Do not edit persist.ts / pending-input.ts / correction-draft.ts. */
const SNAPSHOT_KEY = "deep.ui.v2";
const ACCOUNT = "acct-a";
const TOKEN = "token-a";
const parentRunId = "11111111-1111-4111-8111-111111111111";
const childRunId = "22222222-2222-4222-8222-222222222222";
const foreignRunId = "33333333-3333-4333-8333-333333333333";
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NON_HEX_DIGEST = "x".repeat(64);
const DEVICE_CLEANUP = "Saved follow-up request is invalid. Device cleanup is required before new research.";
const followUpArgs = {
  parentRunId,
  message: "Go deeper on battery life",
  expectedBriefRevision: 3,
  kind: "deepen" as const,
};

function seedFollowUp(): PendingFollowUp {
  return preparePendingFollowUp({ ...followUpArgs, requestId });
}

function sessionState(over: Partial<UiState> = {}): UiState {
  return {
    ...emptyState(),
    signedIn: true,
    consentGranted: true,
    routeMode: "controlled-research",
    status: "completed",
    run: {
      runId: parentRunId,
      lifecycle: "terminal",
      phase: "completed",
      outcome: "completed",
      reportId: "rep-1",
      labeledDemo: false,
      brief: { originalQuestion: "best laptop for running AI under 2k", constraints: [], revision: 3 },
    },
    report: {
      reportId: "rep-1",
      blocks: [{ id: "answer", kind: "text", text: "Owned answer", claimIds: [], citationIds: [] }],
      limitations: [],
      labeledDemo: false,
    },
    ...over,
  };
}

async function activateStore() {
  const cache = memoryStore();
  const credentials = memoryStore();
  const storage = createSessionStorage(cache, credentials);
  await storage.activate({ accountId: ACCOUNT, token: TOKEN });
  return { cache, credentials, storage };
}

async function persistFollowUp(journal: PendingFollowUp) {
  const { cache, credentials, storage } = await activateStore();
  await storage.persistRequired(TOKEN, sessionState({ pendingFollowUp: journal }));
  const planted = (await cache.getItem(SNAPSHOT_KEY))!;
  expect(JSON.parse(planted).state.pendingFollowUp).toEqual(expect.objectContaining({
    parentRunId, requestId, payloadDigest: journal.payloadDigest,
  }));
  return { cache, credentials, planted };
}

async function persistThenPatch(journal: PendingFollowUp, patch: (row: Record<string, unknown>) => void) {
  const seeded = await persistFollowUp(journal);
  const envelope = JSON.parse(seeded.planted) as { accountId: string; state: Record<string, unknown> };
  patch(envelope.state.pendingFollowUp as Record<string, unknown>);
  const planted = JSON.stringify(envelope);
  await seeded.cache.setItem(SNAPSHOT_KEY, planted);
  return { ...seeded, planted };
}

function reopen(cache: ReturnType<typeof memoryStore>, credentials: ReturnType<typeof memoryStore>) {
  return createSessionStorage(cache, credentials);
}

/** Execute-only runner stub. `current: () => true` is not BB-01 request-scope acceptance. */
async function replayHydratedFollowUp(
  cache: ReturnType<typeof memoryStore>,
  credentials: ReturnType<typeof memoryStore>,
  pending: PendingFollowUp,
) {
  const posts: string[] = [];
  const adopts: string[] = [];
  const storage = reopen(cache, credentials);
  const hydrated = await hydrateOnLaunch(storage);
  expect(hydrated.token).toBe(TOKEN);
  expect(hydrated.state.pendingFollowUp).toEqual(pending);
  await runMutatingFollowUp({
    pending: hydrated.state.pendingFollowUp,
    parentRunId: pending.parentRunId,
    message: pending.message,
    expectedBriefRevision: pending.expectedBriefRevision,
    kind: pending.kind ?? "deepen",
    current: () => true,
    save: async (saved) => {
      await storage.persistRequired(TOKEN, { ...hydrated.state, pendingFollowUp: saved });
    },
    post: async (_runId, _message, _revision, key) => {
      posts.push(key);
      return { kind: "deepen", runId: pending.acceptedRunId ?? childRunId, briefRevision: 4 };
    },
    adopt: async (body) => { adopts.push(body.runId); },
  });
  return { posts, adopts, hydrated };
}

async function expectDeviceCleanup(
  cache: ReturnType<typeof memoryStore>,
  credentials: ReturnType<typeof memoryStore>,
  planted: string,
) {
  const posts: string[] = [];
  const storage = reopen(cache, credentials);
  let admitted: PendingFollowUp | null | undefined;
  try {
    const hydrated = await hydrateOnLaunch(storage);
    admitted = hydrated.state.pendingFollowUp;
    if (admitted) {
      try {
        await runMutatingFollowUp({
          pending: admitted,
          parentRunId: admitted.parentRunId,
          message: admitted.message,
          expectedBriefRevision: admitted.expectedBriefRevision,
          kind: admitted.kind ?? "deepen",
          current: () => true, // execute-only; not BB-01 request-scope acceptance
          save: async (saved) => {
            await storage.persistRequired(TOKEN, { ...hydrated.state, pendingFollowUp: saved });
          },
          post: async (_runId, _message, _revision, key) => {
            posts.push(key);
            return { kind: "deepen", runId: childRunId, briefRevision: 4 };
          },
          adopt: async () => undefined,
        });
      } catch { /* still must not have POSTed */ }
    }
  } catch (error) {
    expect((error as Error).message).toBe(DEVICE_CLEANUP);
    expect(await cache.getItem(SNAPSHOT_KEY)).toBe(planted);
    await expect(hydrateOnLaunch(reopen(cache, credentials))).rejects.toThrow(DEVICE_CLEANUP);
    const stored = JSON.parse((await cache.getItem(SNAPSHOT_KEY))!).state.pendingFollowUp;
    expect(stored).toEqual(JSON.parse(planted).state.pendingFollowUp);
    return stored as Record<string, unknown>;
  }
  expect(posts, "malformed journal must not POST").toEqual([]);
  throw new Error(`hydrate admitted pendingFollowUp phase=${admitted?.phase} digest=${admitted?.payloadDigest} requestId=${admitted?.requestId} acceptedRunId=${admitted?.acceptedRunId}`);
}

describe("BB-03 pendingFollowUp persist/hydrate fail-closed (this wave)", () => {
  it("BB03-01 hydrating 64 non-hex payloadDigest from deep.ui.v2 rejects and does not POST", async () => {
    const pending = seedFollowUp();
    expect(pending.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    const { cache, credentials, planted } = await persistThenPatch(pending, (row) => {
      row.payloadDigest = NON_HEX_DIGEST;
    });
    expect(planted).toContain(NON_HEX_DIGEST);
    const stored = await expectDeviceCleanup(cache, credentials, planted);
    expect(stored.payloadDigest).toBe(NON_HEX_DIGEST);
    expect(stored.phase).not.toBeUndefined();
  });

  it("BB03-02 foreign hex digest is not admitted or rebound", async () => {
    const pending = seedFollowUp();
    const foreignDigest = followUpPayloadDigest(parentRunId, 3, "Go deeper on thermals");
    expect(foreignDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(foreignDigest).not.toBe(pending.payloadDigest);
    const { cache, credentials, planted } = await persistThenPatch(pending, (row) => {
      row.payloadDigest = foreignDigest;
    });
    await expectDeviceCleanup(cache, credentials, planted);
  });

  it("BB03-02 rewritten message/revision under the original digest is not rebound", async () => {
    const pending = seedFollowUp();
    const { cache, credentials, planted } = await persistThenPatch(pending, (row) => {
      row.message = "Go deeper on thermals";
      row.expectedBriefRevision = 9;
    });
    const stored = await expectDeviceCleanup(cache, credentials, planted);
    expect(stored.payloadDigest).toBe(pending.payloadDigest);
    expect(stored.message).toBe("Go deeper on thermals");
    expect(stored.requestId).toBe(requestId);
    expect(stored.payloadDigest).not.toBe(followUpPayloadDigest(parentRunId, 9, "Go deeper on thermals"));
  });

  it("BB03-02 canonical digest of the new payload with the old idempotencyKey is not rebound", async () => {
    const pending = seedFollowUp();
    const { cache, credentials, planted } = await persistThenPatch(pending, (row) => {
      row.message = "Go deeper on thermals";
      row.payloadDigest = followUpPayloadDigest(parentRunId, 3, "Go deeper on thermals");
    });
    const stored = await expectDeviceCleanup(cache, credentials, planted);
    expect(stored.idempotencyKey).toBe(pending.idempotencyKey);
    expect(stored.idempotencyKey).not.toBe(mutatingFollowUpKey(parentRunId, 3, "Go deeper on thermals"));
  });

  it("BB03-02 uppercase 64-hex digest of the correct payload is not a supported legacy format", async () => {
    const pending = seedFollowUp();
    const { cache, credentials, planted } = await persistThenPatch(pending, (row) => {
      row.payloadDigest = pending.payloadDigest.toUpperCase();
    });
    await expectDeviceCleanup(cache, credentials, planted);
  });

  it.each(["posted", "sending", "PREPARED", "", 1] as const)(
    "BB03-03 unknown/malformed phase %j never becomes prepared",
    async (phase) => {
      const pending = seedFollowUp();
      const { cache, credentials, planted } = await persistThenPatch(pending, (row) => {
        row.phase = phase as never;
      });
      const stored = await expectDeviceCleanup(cache, credentials, planted);
      expect(stored.phase).toBe(phase);
      expect(stored.requestId).toBe(requestId);
    },
  );

  it("BB03-03 omitted phase never becomes prepared", async () => {
    const pending = seedFollowUp();
    const { cache, credentials, planted } = await persistThenPatch(pending, (row) => {
      delete row.phase;
    });
    const stored = await expectDeviceCleanup(cache, credentials, planted);
    expect(stored.phase).toBeUndefined();
  });

  it("BB03-03 extra schema/version key is unsupported this wave (no stamp)", async () => {
    const pending = seedFollowUp();
    const { cache, credentials, planted } = await persistThenPatch(pending, (row) => {
      row.schema = "pending-follow-up.v0-rolling";
    });
    await expectDeviceCleanup(cache, credentials, planted);
  });

  it.each([
    ["accepted without acceptedRunId", (row: Record<string, unknown>) => {
      row.phase = "accepted"; delete row.acceptedRunId; row.acceptedBriefRevision = 4;
    }],
    ["accepted with non-uuid acceptedRunId", (row: Record<string, unknown>) => {
      row.phase = "accepted"; row.acceptedRunId = "not-a-uuid"; row.acceptedBriefRevision = 4;
    }],
    ["adopted without acceptedRunId", (row: Record<string, unknown>) => {
      row.phase = "adopted"; delete row.acceptedRunId; row.acceptedBriefRevision = 4;
    }],
  ] as const)("BB03-04 %s is Device-cleanup and does not POST", async (_name, patch) => {
    const { cache, credentials, planted } = await persistThenPatch(seedFollowUp(), patch);
    await expectDeviceCleanup(cache, credentials, planted);
  });

  it.each([0, "4"] as const)("BB03-04 acceptedBriefRevision %j when present is Device-cleanup", async (revision) => {
    const { cache, credentials, planted } = await persistThenPatch(seedFollowUp(), (row) => {
      row.phase = "accepted";
      row.acceptedRunId = childRunId;
      row.acceptedBriefRevision = revision as never;
    });
    await expectDeviceCleanup(cache, credentials, planted);
  });

  it.each([
    ["missing payloadDigest", (row: Record<string, unknown>) => { delete row.payloadDigest; }],
    ["63-char digest", (row: Record<string, unknown>) => { row.payloadDigest = "a".repeat(63); }],
    ["65-char digest", (row: Record<string, unknown>) => { row.payloadDigest = `${String(row.payloadDigest)}a`; }],
    ["missing requestId", (row: Record<string, unknown>) => { delete row.requestId; }],
    ["non-uuid requestId", (row: Record<string, unknown>) => { row.requestId = "pending-request"; }],
    ["unbound idempotencyKey", (row: Record<string, unknown>) => {
      row.idempotencyKey = `${parentRunId}-followup-3-${"0".repeat(64)}`;
    }],
  ] as const)("BB03-06 %s fails closed without minting a replacement identity", async (_name, patch) => {
    const pending = seedFollowUp();
    const { cache, credentials, planted } = await persistThenPatch(pending, (row) => { patch(row); });
    await expectDeviceCleanup(cache, credentials, planted);
  });

  it("BB03-06 two hydrates of a blob with missing requestId both throw and do not mint", async () => {
    const { cache, credentials, planted } = await persistThenPatch(seedFollowUp(), (row) => {
      delete row.requestId;
    });
    await expect(hydrateOnLaunch(reopen(cache, credentials))).rejects.toThrow(DEVICE_CLEANUP);
    await expect(hydrateOnLaunch(reopen(cache, credentials))).rejects.toThrow(DEVICE_CLEANUP);
    expect(await cache.getItem(SNAPSHOT_KEY)).toBe(planted);
    expect(JSON.parse(planted).state.pendingFollowUp.requestId).toBeUndefined();
  });

  it("BB03-K1 unknown kind rewrite_history is Device-cleanup", async () => {
    const { cache, credentials, planted } = await persistThenPatch(seedFollowUp(), (row) => {
      row.kind = "rewrite_history";
    });
    await expectDeviceCleanup(cache, credentials, planted);
  });

  it("BB03-K1 missing kind remains allowed on a well-formed prepared journal", async () => {
    const pending = seedFollowUp();
    const { cache, credentials } = await persistThenPatch(pending, (row) => { delete row.kind; });
    const hydrated = await hydrateOnLaunch(reopen(cache, credentials));
    expect(hydrated.state.pendingFollowUp?.kind).toBeUndefined();
    expect(hydrated.state.pendingFollowUp?.requestId).toBe(requestId);
    expect(hydrated.state.pendingFollowUp?.phase).toBe("prepared");
    expect(hydrated.state.pendingFollowUp?.payloadDigest).toBe(pending.payloadDigest);
  });
});

describe("BB-03 implicit v1 / same-run hydrate (must stay green at bb80cfd and after repair)", () => {
  it("BB03-C1 well-formed prepared persistRequired then hydrate equals stored pending", async () => {
    const pending = seedFollowUp();
    const { cache, credentials } = await persistFollowUp(pending);
    const hydrated = await hydrateOnLaunch(reopen(cache, credentials));
    expect(hydrated.state.pendingFollowUp).toEqual(pending);
    expect(pending.payloadDigest).not.toBe(followUpPayloadDigest(parentRunId, 3, "Go deeper on BB"));
  });

  it("BB03-C2/C8 well-formed sent and rejected journals restore phase and identities", async () => {
    for (const phase of ["sent", "rejected"] as const) {
      const pending = { ...seedFollowUp(), phase };
      const { cache, credentials } = await persistFollowUp(pending);
      const first = await hydrateOnLaunch(reopen(cache, credentials));
      const second = await hydrateOnLaunch(reopen(cache, credentials));
      expect(first.state.pendingFollowUp).toEqual(pending);
      expect(second.state.pendingFollowUp).toEqual(pending);
      expect(first.state.pendingFollowUp?.phase).toBe(phase);
      expect(first.state.pendingFollowUp?.requestId).toBe(requestId);
      if (phase === "sent") expect(startNewResearch(first.state).ok).toBe(false);
    }
  });

  it("BB03-C3 null journals stay null and hydrate does not invent a follow-up", async () => {
    expect(readPendingFollowUp(null)).toBeNull();
    const { cache, credentials, storage } = await activateStore();
    await storage.persistRequired(TOKEN, sessionState({ pendingFollowUp: null }));
    const hydrated = await hydrateOnLaunch(reopen(cache, credentials));
    expect(hydrated.state.pendingFollowUp).toBeNull();
  });

  it("BB03-C6/BB03-07 same-run acceptedRunId === parentRunId hydrates, no POST, not Device-cleanup", async () => {
    const pending: PendingFollowUp = {
      ...seedFollowUp(),
      phase: "accepted",
      acceptedRunId: parentRunId,
    };
    expect(pending.acceptedRunId).toBe(parentRunId);
    expect(pending).not.toHaveProperty("acceptedBriefRevision");
    const { cache, credentials } = await persistFollowUp(pending);
    const first = await hydrateOnLaunch(reopen(cache, credentials));
    const second = await hydrateOnLaunch(reopen(cache, credentials));
    expect(first.state.pendingFollowUp).toEqual(pending);
    expect(second.state.pendingFollowUp).toEqual(pending);
    expect(first.state.pendingFollowUp?.acceptedRunId).toBe(parentRunId);
    const replay = await replayHydratedFollowUp(cache, credentials, pending);
    expect(replay.posts).toEqual([]);
    expect(replay.adopts).toEqual([parentRunId]);
  });

  it("BB03-C7 implicit v1 accepted omits acceptedBriefRevision, hydrates, adopts child, post=[]", async () => {
    const pending: PendingFollowUp = {
      ...seedFollowUp(),
      phase: "accepted",
      acceptedRunId: childRunId,
    };
    expect(pending).not.toHaveProperty("acceptedBriefRevision");
    const { cache, credentials } = await persistFollowUp(pending);
    const first = await hydrateOnLaunch(reopen(cache, credentials));
    const second = await hydrateOnLaunch(reopen(cache, credentials));
    expect(first.state.pendingFollowUp).toEqual(pending);
    expect(second.state.pendingFollowUp).toEqual(pending);
    expect(first.state.pendingFollowUp).not.toHaveProperty("acceptedBriefRevision");
    const replay = await replayHydratedFollowUp(cache, credentials, pending);
    expect(replay.posts).toEqual([]);
    expect(replay.adopts).toEqual([childRunId]);
  });

  it("BB03-07 accepted child UUID with revision hydrates and adopts without POST", async () => {
    const pending: PendingFollowUp = {
      ...seedFollowUp(),
      phase: "accepted",
      acceptedRunId: childRunId,
      acceptedBriefRevision: 4,
    };
    const { cache, credentials } = await persistFollowUp(pending);
    const hydrated = await hydrateOnLaunch(reopen(cache, credentials));
    expect(hydrated.state.pendingFollowUp).toEqual(pending);
    const replay = await replayHydratedFollowUp(cache, credentials, pending);
    expect(replay.posts).toEqual([]);
    expect(replay.adopts).toEqual([childRunId]);
  });

  it("BB03-05 well-formed foreign UUID acceptedRunId hydrates; ownership is not a parser fact", async () => {
    const pending: PendingFollowUp = {
      ...seedFollowUp(),
      phase: "accepted",
      acceptedRunId: foreignRunId,
      acceptedBriefRevision: 4,
    };
    const { cache, credentials } = await persistFollowUp(pending);
    const hydrated = await hydrateOnLaunch(reopen(cache, credentials));
    expect(hydrated.state.pendingFollowUp).toEqual(pending);
    expect(hydrated.state.pendingFollowUp?.acceptedRunId).toBe(foreignRunId);
    const replay = await replayHydratedFollowUp(cache, credentials, pending);
    expect(replay.posts).toEqual([]);
    expect(replay.adopts).toEqual([foreignRunId]);
  });

  it("BB03-06 unscoped legacy deep.ui is not migrated into a sendable journal", async () => {
    const pending = seedFollowUp();
    const legacy = memoryStore({
      "deep.token": "legacy-secret",
      "deep.ui": JSON.stringify({ accountId: ACCOUNT, state: sessionState({ pendingFollowUp: pending }) }),
    });
    const restored = await hydrateOnLaunch(createSessionStorage(legacy, memoryStore()));
    expect(restored.token).toBeNull();
    expect(restored.state.pendingFollowUp).toBeNull();
    expect(await legacy.getItem("deep.ui")).toBeNull();
    expect(await legacy.getItem("deep.token")).toBeNull();
  });

  it("App.tsx still launches through hydrateOnLaunch and cannot retry a follow-up without a token", () => {
    const app = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(app).toContain("hydrateOnLaunch(sessionStorage)");
    expect(app).toContain("runMutatingFollowUp");
    expect(app).toMatch(/if \(!token \|\| !current\.run \|\| followUpBusy\.current\) return;/);
  });
});

describe("RES-04 sibling durable journals", () => {
  it("rejects malformed assumption/correction digest and phase records", () => {
    const assumption = preparePendingAssumptions({
      parentRunId,
      action: "replace",
      values: ["Quiet fans"],
      expectedBriefRevision: 3,
      requestId,
    });
    const correction = preparePendingCorrection({
      parentRunId,
      question: "Correct the battery comparison",
      expectedBriefRevision: 3,
      evidencePolicy: "reuse_snapshot",
      requestId,
    });
    expect(() => readPendingAssumptions({ ...assumption, payloadDigest: NON_HEX_DIGEST })).toThrow(/Device cleanup/);
    expect(() => readPendingAssumptions({ ...assumption, phase: "posting" })).toThrow(/Device cleanup/);
    expect(() => readPendingCorrection({ ...correction, payloadDigest: NON_HEX_DIGEST })).toThrow(/Device cleanup/);
    expect(() => readPendingCorrection({ ...correction, phase: "posting" })).toThrow(/Device cleanup/);
  });
});

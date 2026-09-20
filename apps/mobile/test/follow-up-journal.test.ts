import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { followUpPayloadDigest, mutatingFollowUpKey } from "../src/constraint-delta";
import {
  preparePendingFollowUp,
  readPendingFollowUp as readPendingFollowUpFromAdmission,
  runMutatingFollowUp,
  submitPendingFollowUp,
  unresolvedFollowUp,
} from "../src/follow-up-admission";
import {
  FOLLOW_UP_JOURNAL_PHASES,
  readPendingFollowUp,
  unresolvedJournalPhase,
  withFollowUpPhase,
  type PendingFollowUp,
} from "../src/follow-up-journal";
import { createSessionStorage, memoryStore } from "../src/persist";
import { readPendingQueryAuthorization } from "../src/query-authorization";
import { emptyState, startNewResearch } from "../src/state";
import { preparePendingAssumptions, readPendingAssumptions } from "../src/pending-input";
import { preparePendingCorrection, readPendingCorrection } from "../src/correction-draft";

const SNAPSHOT_KEY = "deep.ui.v2";
const ACCOUNT = "acct-a";
const TOKEN = "token-a";
const CLEANUP = "Saved follow-up request is invalid. Device cleanup is required before new research.";
const parentRunId = "11111111-1111-4111-8111-111111111111";
const childRunId = "22222222-2222-4222-8222-222222222222";
const foreignRunId = "33333333-3333-4333-8333-333333333333";
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const followUpMessage = "Go deeper on battery life";
const expectedBriefRevision = 3;
const NON_HEX_DIGEST = "x".repeat(64);

const args = {
  parentRunId,
  message: followUpMessage,
  expectedBriefRevision,
  kind: "deepen" as const,
  requestId,
};

function seedPrepared(): PendingFollowUp {
  return preparePendingFollowUp(args);
}

function acceptedJournal(over: {
  acceptedRunId: string;
  acceptedBriefRevision?: number;
  phase?: "accepted" | "adopted";
}): PendingFollowUp {
  const base = seedPrepared();
  const row: PendingFollowUp = {
    ...base,
    phase: over.phase ?? "accepted",
    acceptedRunId: over.acceptedRunId,
  };
  if (over.acceptedBriefRevision !== undefined) row.acceptedBriefRevision = over.acceptedBriefRevision;
  return readPendingFollowUp(row)!;
}

async function activateStore() {
  const cache = memoryStore();
  const credentials = memoryStore();
  const storage = createSessionStorage(cache, credentials);
  await storage.activate({ accountId: ACCOUNT, token: TOKEN });
  return { cache, credentials, storage };
}

function sessionWith(pending: PendingFollowUp | null) {
  return { ...emptyState(), signedIn: true, consentGranted: true, pendingFollowUp: pending };
}

async function persistJournal(pending: PendingFollowUp | null) {
  const { cache, credentials, storage } = await activateStore();
  await storage.persistRequired(TOKEN, sessionWith(pending));
  return { cache, credentials, storage };
}

async function persistThenPatch(pending: PendingFollowUp, patch: (row: Record<string, unknown>) => void) {
  const { cache, credentials } = await persistJournal(pending);
  const envelope = JSON.parse((await cache.getItem(SNAPSHOT_KEY))!) as {
    accountId: string;
    state: { pendingFollowUp: Record<string, unknown> };
  };
  expect(envelope.accountId).toBe(ACCOUNT);
  patch(envelope.state.pendingFollowUp);
  const planted = JSON.stringify(envelope);
  await cache.setItem(SNAPSHOT_KEY, planted);
  return { cache, credentials, planted, tampered: envelope.state.pendingFollowUp };
}

function reopen(cache: ReturnType<typeof memoryStore>, credentials: ReturnType<typeof memoryStore>) {
  return createSessionStorage(cache, credentials);
}

async function expectHydrateCleanup(
  cache: ReturnType<typeof memoryStore>,
  credentials: ReturnType<typeof memoryStore>,
  planted: string,
) {
  await expect(reopen(cache, credentials).hydrate()).rejects.toThrow(CLEANUP);
  expect(await cache.getItem(SNAPSHOT_KEY)).toBe(planted);
}

async function postsFromSubmit(pending: unknown) {
  const posts: string[] = [];
  await expect(submitPendingFollowUp(pending as PendingFollowUp, {
    current: () => true, // runner stub, not BB-01 request-scope acceptance
    save: async () => undefined,
    post: async (_runId, _message, _revision, key) => {
      posts.push(key);
      return { kind: "deepen", runId: childRunId, briefRevision: 4 };
    },
  })).rejects.toThrow(CLEANUP);
  return posts;
}

async function dispatchAccepted(pending: PendingFollowUp) {
  const posts: string[] = [];
  const adopts: string[] = [];
  const adopted = await runMutatingFollowUp({
    pending,
    parentRunId: pending.parentRunId,
    message: pending.message,
    expectedBriefRevision: pending.expectedBriefRevision,
    kind: pending.kind ?? "deepen",
    current: () => true, // runner stub, not BB-01 request-scope acceptance
    save: async () => undefined,
    post: async (_runId, _message, _revision, key) => {
      posts.push(key);
      return { kind: "deepen", runId: childRunId, briefRevision: 4 };
    },
    adopt: async (body) => { adopts.push(body.runId); },
  });
  return { posts, adopts, adopted };
}

describe("BB-03 follow-up journal parser extract", () => {
  it("re-exports parser symbols from follow-up-admission without a second implementation", () => {
    expect(readPendingFollowUpFromAdmission).toBe(readPendingFollowUp);
    const admission = readFileSync(join(import.meta.dirname, "../src/follow-up-admission.ts"), "utf8");
    expect(admission).toContain('from "./follow-up-journal"');
    expect(admission).not.toContain("payloadDigest.length === 64");
    expect(admission).not.toMatch(/export function readPendingFollowUp/);
    expect(admission).toContain("export async function runMutatingFollowUp");
    expect(admission).toContain("export async function submitPendingFollowUp");
  });

  it("does not mint identities or import research-core / crypto.randomUUID", () => {
    const journal = readFileSync(join(import.meta.dirname, "../src/follow-up-journal.ts"), "utf8");
    expect(journal).not.toContain("newFollowUpRequestId");
    expect(journal).not.toContain("crypto.randomUUID");
    expect(journal).not.toContain("@deep/research-core");
    expect(journal).toContain("/^[a-f0-9]{64}$/");
    expect(journal).toMatch(/\$\/i/);
  });
});

describe("BB03-01 digest format invalid", () => {
  it("rejects a 64-char non-hex payloadDigest through persist/hydrate and does not POST", async () => {
    const pending = seedPrepared();
    expect(pending.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, (row) => {
      row.payloadDigest = NON_HEX_DIGEST;
    });
    expect(planted).toContain(NON_HEX_DIGEST);
    await expectHydrateCleanup(cache, credentials, planted);
    expect(() => readPendingFollowUp(tampered)).toThrow(CLEANUP);
    expect(await postsFromSubmit(tampered)).toEqual([]);
    expect(JSON.parse((await cache.getItem(SNAPSHOT_KEY))!).state.pendingFollowUp.payloadDigest).toBe(NON_HEX_DIGEST);
  });

  it.each([
    ["missing digest", (row: Record<string, unknown>) => { delete row.payloadDigest; }],
    ["63-char digest", (row: Record<string, unknown>) => { row.payloadDigest = "a".repeat(63); }],
    ["65-char digest", (row: Record<string, unknown>) => { row.payloadDigest = `${row.payloadDigest}a`; }],
  ] as const)("%s is not a legacy format and does not rebind", async (_name, patch) => {
    const pending = seedPrepared();
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, patch);
    await expectHydrateCleanup(cache, credentials, planted);
    expect(() => readPendingFollowUp(tampered)).toThrow(CLEANUP);
    expect(await postsFromSubmit(tampered)).toEqual([]);
  });
});

describe("BB03-02 digest payload mismatch", () => {
  it("rejects a well-formed hex digest bound to a different payload", async () => {
    const pending = seedPrepared();
    const foreignDigest = followUpPayloadDigest(parentRunId, expectedBriefRevision, "Go deeper on thermals");
    expect(foreignDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(foreignDigest).not.toBe(pending.payloadDigest);
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, (row) => {
      row.payloadDigest = foreignDigest;
    });
    await expectHydrateCleanup(cache, credentials, planted);
    expect(() => readPendingFollowUp(tampered)).toThrow(CLEANUP);
    expect(await postsFromSubmit(tampered)).toEqual([]);
  });

  it("rejects rewritten message/revision/parent under the original digest without rebinding", async () => {
    const pending = seedPrepared();
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, (row) => {
      row.message = "Go deeper on thermals";
      row.expectedBriefRevision = 9;
      row.parentRunId = childRunId;
    });
    await expectHydrateCleanup(cache, credentials, planted);
    const stored = JSON.parse((await cache.getItem(SNAPSHOT_KEY))!).state.pendingFollowUp;
    expect(stored.payloadDigest).toBe(pending.payloadDigest);
    expect(stored.message).toBe("Go deeper on thermals");
    expect(stored.requestId).toBe(requestId);
    expect(stored.payloadDigest).not.toBe(followUpPayloadDigest(childRunId, 9, "Go deeper on thermals"));
    expect(await postsFromSubmit(tampered)).toEqual([]);
  });

  it("rejects a new canonical digest paired with the old idempotency key", async () => {
    const pending = seedPrepared();
    const nextMessage = "Go deeper on thermals";
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, (row) => {
      row.message = nextMessage;
      row.payloadDigest = followUpPayloadDigest(parentRunId, expectedBriefRevision, nextMessage);
    });
    expect(tampered.idempotencyKey).toBe(pending.idempotencyKey);
    expect(tampered.payloadDigest).not.toBe(pending.payloadDigest);
    await expectHydrateCleanup(cache, credentials, planted);
    expect(await postsFromSubmit(tampered)).toEqual([]);
  });

  it("rejects uppercase 64-hex of the correct payload", async () => {
    const pending = seedPrepared();
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, (row) => {
      row.payloadDigest = String(row.payloadDigest).toUpperCase();
    });
    expect(tampered.payloadDigest).toBe(pending.payloadDigest.toUpperCase());
    await expectHydrateCleanup(cache, credentials, planted);
    expect(() => readPendingFollowUp(tampered)).toThrow(CLEANUP);
    expect(await postsFromSubmit(tampered)).toEqual([]);
  });
});

describe("BB03-03 unknown phase/version never becomes prepared", () => {
  it.each(["posted", "sending", "PREPARED", "", 1, null] as const)(
    "phase %j fails closed and is not recovered as prepared",
    async (phase) => {
      const pending = seedPrepared();
      const { cache, credentials, planted, tampered } = await persistThenPatch(pending, (row) => {
        row.phase = phase as never;
      });
      await expectHydrateCleanup(cache, credentials, planted);
      expect(() => readPendingFollowUp(tampered)).toThrow(CLEANUP);
      expect(JSON.parse(planted).state.pendingFollowUp.phase).toBe(phase);
      expect(JSON.parse(planted).state.pendingFollowUp.requestId).toBe(requestId);
      expect(await postsFromSubmit(tampered)).toEqual([]);
    },
  );

  it("omitted phase fails closed", async () => {
    const pending = seedPrepared();
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, (row) => {
      delete row.phase;
    });
    await expectHydrateCleanup(cache, credentials, planted);
    expect(() => readPendingFollowUp(tampered)).toThrow(CLEANUP);
    expect(await postsFromSubmit(tampered)).toEqual([]);
  });

  it("extra schema key fails closed and is not stamped as recovery", async () => {
    const pending = seedPrepared();
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, (row) => {
      row.schema = "pending-follow-up.v0-rolling";
    });
    await expectHydrateCleanup(cache, credentials, planted);
    expect(() => readPendingFollowUp(tampered)).toThrow(CLEANUP);
    expect(await postsFromSubmit(tampered)).toEqual([]);
  });
});

describe("BB03-04 accepted identity missing vs valid same-run / omitted revision", () => {
  it.each([
    ["accepted without acceptedRunId", (row: Record<string, unknown>) => {
      row.phase = "accepted";
      delete row.acceptedRunId;
      row.acceptedBriefRevision = 4;
    }],
    ["accepted with non-uuid acceptedRunId", (row: Record<string, unknown>) => {
      row.phase = "accepted";
      row.acceptedRunId = "not-a-run-id";
      row.acceptedBriefRevision = 4;
    }],
    ["adopted without acceptedRunId", (row: Record<string, unknown>) => {
      row.phase = "adopted";
      delete row.acceptedRunId;
      row.acceptedBriefRevision = 4;
    }],
    ["adopted with non-uuid acceptedRunId", (row: Record<string, unknown>) => {
      row.phase = "adopted";
      row.acceptedRunId = "not-a-run-id";
    }],
  ] as const)("%s fails closed and does not POST", async (_name, patch) => {
    const pending = seedPrepared();
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, patch);
    await expectHydrateCleanup(cache, credentials, planted);
    expect(() => readPendingFollowUp(tampered)).toThrow(CLEANUP);
    expect(await postsFromSubmit(tampered)).toEqual([]);
  });

  it("acceptedRunId === parentRunId hydrates as same-run and does not POST", async () => {
    const pending = acceptedJournal({ acceptedRunId: parentRunId, acceptedBriefRevision: 4 });
    const { cache, credentials } = await persistJournal(pending);
    const first = await reopen(cache, credentials).hydrate();
    const second = await reopen(cache, credentials).hydrate();
    expect(first.state.pendingFollowUp).toEqual(pending);
    expect(second.state.pendingFollowUp).toEqual(pending);
    expect(first.state.pendingFollowUp?.acceptedRunId).toBe(parentRunId);
    const dispatched = await dispatchAccepted(first.state.pendingFollowUp!);
    expect(dispatched.posts).toEqual([]);
    expect(dispatched.adopts).toEqual([parentRunId]);
  });

  it("accepted child UUID with omitted acceptedBriefRevision hydrates and does not POST", async () => {
    const pending = acceptedJournal({ acceptedRunId: childRunId });
    expect(pending.acceptedBriefRevision).toBeUndefined();
    const { cache, credentials } = await persistJournal(pending);
    const restored = await reopen(cache, credentials).hydrate();
    expect(restored.state.pendingFollowUp).toEqual(pending);
    expect(restored.state.pendingFollowUp).not.toHaveProperty("acceptedBriefRevision");
    const dispatched = await dispatchAccepted(restored.state.pendingFollowUp!);
    expect(dispatched.posts).toEqual([]);
    expect(dispatched.adopts).toEqual([childRunId]);
  });

  it("accepted child UUID with positive acceptedBriefRevision hydrates", async () => {
    const pending = acceptedJournal({ acceptedRunId: childRunId, acceptedBriefRevision: 4 });
    const { cache, credentials } = await persistJournal(pending);
    const restored = await reopen(cache, credentials).hydrate();
    expect(restored.state.pendingFollowUp).toEqual(pending);
    expect(restored.state.pendingFollowUp?.acceptedBriefRevision).toBe(4);
  });

  it("present non-positive acceptedBriefRevision fails closed", async () => {
    const pending = acceptedJournal({ acceptedRunId: childRunId, acceptedBriefRevision: 4 });
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, (row) => {
      row.acceptedBriefRevision = 0;
    });
    await expectHydrateCleanup(cache, credentials, planted);
    expect(() => readPendingFollowUp(tampered)).toThrow(CLEANUP);
  });
});

describe("BB03-05 foreign-looking accepted UUID is parser-accepted", () => {
  it("hydrates acceptedRunId === foreignRunId and does not Device-cleanup parent-id", async () => {
    const pending = acceptedJournal({ acceptedRunId: foreignRunId, acceptedBriefRevision: 4 });
    const { cache, credentials } = await persistJournal(pending);
    const restored = await reopen(cache, credentials).hydrate();
    expect(restored.state.pendingFollowUp?.acceptedRunId).toBe(foreignRunId);
    expect(restored.state.pendingFollowUp?.parentRunId).toBe(parentRunId);
    const sameRun = acceptedJournal({ acceptedRunId: parentRunId });
    expect(readPendingFollowUp(sameRun)?.acceptedRunId).toBe(parentRunId);
    const dispatched = await dispatchAccepted(restored.state.pendingFollowUp!);
    expect(dispatched.posts).toEqual([]);
    expect(dispatched.adopts).toEqual([foreignRunId]);
  });
});

describe("BB03-06 deterministic implicit v1 load without minting", () => {
  it("two hydrates of implicit v1 sent yield identical identities", async () => {
    const pending = withFollowUpPhase(seedPrepared(), "sent");
    const { cache, credentials } = await persistJournal(pending);
    const first = await reopen(cache, credentials).hydrate();
    const second = await reopen(cache, credentials).hydrate();
    expect(first.state.pendingFollowUp).toEqual(pending);
    expect(second.state.pendingFollowUp).toEqual(first.state.pendingFollowUp);
    expect(first.state.pendingFollowUp?.requestId).toBe(requestId);
    expect(first.state.pendingFollowUp?.phase).toBe("sent");
  });

  it("two hydrates of accepted parent-id and omitted-revision child are identity-stable", async () => {
    for (const pending of [
      acceptedJournal({ acceptedRunId: parentRunId }),
      acceptedJournal({ acceptedRunId: childRunId }),
    ]) {
      const { cache, credentials } = await persistJournal(pending);
      const first = await reopen(cache, credentials).hydrate();
      const second = await reopen(cache, credentials).hydrate();
      expect(first.state.pendingFollowUp).toEqual(pending);
      expect(second.state.pendingFollowUp).toEqual(first.state.pendingFollowUp);
      expect(first.state.pendingFollowUp?.requestId).toBe(requestId);
      expect(first.state.pendingFollowUp?.acceptedRunId).toBe(pending.acceptedRunId);
    }
  });

  it.each([
    ["omitted requestId", (row: Record<string, unknown>) => { delete row.requestId; }],
    ["invalid requestId", (row: Record<string, unknown>) => { row.requestId = "bad"; }],
  ] as const)("%s throws Device cleanup and does not mint", async (_name, patch) => {
    const pending = seedPrepared();
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, patch);
    await expectHydrateCleanup(cache, credentials, planted);
    await expectHydrateCleanup(cache, credentials, planted);
    expect(() => readPendingFollowUp(tampered)).toThrow(CLEANUP);
    expect(() => readPendingFollowUp(tampered)).toThrow(CLEANUP);
    expect(await postsFromSubmit(tampered)).toEqual([]);
    expect(JSON.parse((await cache.getItem(SNAPSHOT_KEY))!).state.pendingFollowUp.requestId ?? "missing").not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("rolling-hash / unbound idempotency key is not upgraded into a sendable SHA-256 request", async () => {
    const pending = seedPrepared();
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, (row) => {
      row.idempotencyKey = `${parentRunId}-followup-${expectedBriefRevision}-rollinghash`;
    });
    await expectHydrateCleanup(cache, credentials, planted);
    expect(await postsFromSubmit(tampered)).toEqual([]);
    expect(mutatingFollowUpKey(parentRunId, expectedBriefRevision, followUpMessage)).not.toContain("rollinghash");
  });
});

describe("BB03-07 accepted recovery avoids provider resend", () => {
  it.each([
    ["child id with revision", acceptedJournal({ acceptedRunId: childRunId, acceptedBriefRevision: 4 })],
    ["child id without revision", acceptedJournal({ acceptedRunId: childRunId })],
    ["parent id same-run", acceptedJournal({ acceptedRunId: parentRunId, acceptedBriefRevision: 4 })],
  ] as const)("%s hydrates and submit/run post() is empty", async (_name, pending) => {
    const { cache, credentials } = await persistJournal(pending);
    const restored = await reopen(cache, credentials).hydrate();
    expect(restored.state.pendingFollowUp?.acceptedRunId).toBe(pending.acceptedRunId);
    expect(restored.state.pendingFollowUp?.requestId).toBe(requestId);
    const posts: string[] = [];
    await expect(submitPendingFollowUp(restored.state.pendingFollowUp!, {
      current: () => true,
      save: async () => undefined,
      post: async (_runId, _message, _revision, key) => {
        posts.push(key);
        return { kind: "deepen", runId: childRunId };
      },
    })).resolves.toMatchObject({ runId: pending.acceptedRunId });
    expect(posts).toEqual([]);
    const dispatched = await dispatchAccepted(restored.state.pendingFollowUp!);
    expect(dispatched.posts).toEqual([]);
    expect(dispatched.adopts).toEqual([pending.acceptedRunId]);
  });
});

describe("BB03-08 sent and rejected stay durable phases", () => {
  it("hydrates well-formed sent without coercing to prepared or minting requestId", async () => {
    const pending = withFollowUpPhase(seedPrepared(), "sent");
    const { cache, credentials } = await persistJournal(pending);
    const restored = await reopen(cache, credentials).hydrate();
    expect(restored.state.pendingFollowUp?.phase).toBe("sent");
    expect(restored.state.pendingFollowUp?.requestId).toBe(requestId);
    expect(unresolvedFollowUp(restored.state.pendingFollowUp)).toBe(true);
    expect(startNewResearch({ ...emptyState(), signedIn: true, pendingFollowUp: restored.state.pendingFollowUp }).ok).toBe(false);
  });

  it("hydrates well-formed rejected without coercing to prepared", async () => {
    const pending = withFollowUpPhase(seedPrepared(), "rejected");
    const { cache, credentials } = await persistJournal(pending);
    const restored = await reopen(cache, credentials).hydrate();
    expect(restored.state.pendingFollowUp).toEqual(pending);
    expect(restored.state.pendingFollowUp?.phase).toBe("rejected");
    expect(unresolvedFollowUp(restored.state.pendingFollowUp)).toBe(false);
    expect(unresolvedJournalPhase("rejected")).toBe(false);
  });
});

describe("BB03-K1 unknown kind", () => {
  it("throws Device cleanup for rewrite_history and allows missing kind", async () => {
    const pending = seedPrepared();
    const { cache, credentials, planted, tampered } = await persistThenPatch(pending, (row) => {
      row.kind = "rewrite_history";
    });
    await expectHydrateCleanup(cache, credentials, planted);
    expect(() => readPendingFollowUp(tampered)).toThrow(CLEANUP);
    const withoutKind = preparePendingFollowUp({
      parentRunId,
      message: followUpMessage,
      expectedBriefRevision,
      requestId,
    });
    expect(withoutKind.kind).toBeUndefined();
    const { cache: cache2, credentials: credentials2 } = await persistJournal(withoutKind);
    const restored = await reopen(cache2, credentials2).hydrate();
    expect(restored.state.pendingFollowUp).toEqual(withoutKind);
  });
});

describe("BB-03 controls", () => {
  it("BB03-C1 well-formed prepared persist/hydrate equals stored pending", async () => {
    const pending = seedPrepared();
    const { cache, credentials } = await persistJournal(pending);
    const restored = await reopen(cache, credentials).hydrate();
    expect(restored.state.pendingFollowUp).toEqual(pending);
    expect(restored.state.pendingFollowUp?.phase).toBe("prepared");
    expect(mutatingFollowUpKey(parentRunId, expectedBriefRevision, "Go deeper on Aa"))
      .not.toBe(mutatingFollowUpKey(parentRunId, expectedBriefRevision, "Go deeper on BB"));
  });

  it("BB03-C2 well-formed sent restores after restart", async () => {
    const pending = withFollowUpPhase(seedPrepared(), "sent");
    const { cache, credentials } = await persistJournal(pending);
    const restored = await reopen(cache, credentials).hydrate();
    expect(restored.state.pendingFollowUp).toEqual(pending);
  });

  it("BB03-C3 null journals stay null and hydrate does not invent a follow-up", async () => {
    expect(readPendingFollowUp(null)).toBeNull();
    expect(readPendingFollowUp(undefined)).toBeNull();
    const { cache, credentials } = await persistJournal(null);
    const restored = await reopen(cache, credentials).hydrate();
    expect(restored.state.pendingFollowUp).toBeNull();
  });

  it("BB03-C5 query-authorization digest remains hex-only", () => {
    const pending = {
      id: parentRunId,
      proposedQuery: "coral kelp restoration",
      queryDigest: "a".repeat(64),
      briefRevision: 1,
      terms: ["nightfall"],
    };
    expect(() => readPendingQueryAuthorization({ ...pending, queryDigest: "short" })).toThrow(/will not continue/);
    expect(() => readPendingQueryAuthorization({ ...pending, queryDigest: "A".repeat(64) })).toThrow(/will not continue/);
  });

  it("withFollowUpPhase reconstructs without minting and treats undefined revision as omitted", () => {
    const prepared = seedPrepared();
    const sent = withFollowUpPhase(prepared, "sent");
    expect(sent.requestId).toBe(prepared.requestId);
    expect(sent.payloadDigest).toBe(prepared.payloadDigest);
    expect(sent.idempotencyKey).toBe(prepared.idempotencyKey);
    const accepted = withFollowUpPhase(sent, "accepted", {
      acceptedRunId: childRunId,
      acceptedBriefRevision: undefined,
    });
    expect(accepted.phase).toBe("accepted");
    expect(accepted.acceptedRunId).toBe(childRunId);
    expect(accepted.acceptedBriefRevision).toBeUndefined();
    expect(accepted.requestId).toBe(requestId);
    expect(() => withFollowUpPhase(sent, "accepted")).toThrow(CLEANUP);
  });

  it("uppercase UUID identities remain readable (uuid regex keeps /i)", () => {
    const pending = seedPrepared();
    const upper = {
      ...pending,
      parentRunId: parentRunId.toUpperCase(),
      requestId: requestId.toUpperCase(),
      payloadDigest: followUpPayloadDigest(parentRunId.toUpperCase(), expectedBriefRevision, followUpMessage),
      idempotencyKey: mutatingFollowUpKey(parentRunId.toUpperCase(), expectedBriefRevision, followUpMessage),
    };
    expect(readPendingFollowUp(upper)?.parentRunId).toBe(parentRunId.toUpperCase());
    expect(readPendingFollowUp(upper)?.requestId).toBe(requestId.toUpperCase());
  });

  it("known phases remain exactly the durable set", () => {
    expect(FOLLOW_UP_JOURNAL_PHASES).toEqual(["prepared", "sent", "accepted", "adopted", "rejected", "withdrawn"]);
  });

  it("sibling parsers reject missing immutable identities and unknown phases instead of coercing them", () => {
    const assumptions = preparePendingAssumptions({
      parentRunId,
      action: "replace",
      values: ["Quiet fans"],
      expectedBriefRevision,
      requestId,
    });
    const correction = preparePendingCorrection({
      parentRunId,
      question: "Compare battery life in cold weather",
      expectedBriefRevision,
      evidencePolicy: "reuse_snapshot",
      requestId,
    });
    for (const row of [assumptions, correction]) {
      const missingRequest = { ...row } as Record<string, unknown>;
      delete missingRequest.requestId;
      const unknownPhase = { ...row, phase: "posting" };
      if ("action" in row) {
        expect(() => readPendingAssumptions(missingRequest)).toThrow(/Device cleanup/);
        expect(() => readPendingAssumptions(unknownPhase)).toThrow(/Device cleanup/);
      } else {
        expect(() => readPendingCorrection(missingRequest)).toThrow(/Device cleanup/);
        expect(() => readPendingCorrection(unknownPhase)).toThrow(/Device cleanup/);
      }
    }
  });
});

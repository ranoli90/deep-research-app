import { describe, expect, it } from "vitest";
import {
  assumptionsPayloadDigest,
  bindPendingAssumptions,
  mutatingAssumptionsKey,
  preparePendingAssumptions,
  readPendingAssumptions,
  runAssumptionsMutation,
  type PendingAssumptions,
} from "../src/pending-input";
import {
  bindPendingCorrection,
  correctionPayloadDigest,
  mutatingCorrectionKey,
  preparePendingCorrection,
  readPendingCorrection,
  runPendingCorrection,
  type PendingCorrection,
} from "../src/correction-draft";
import { createSessionStorage, memoryStore } from "../src/persist";
import { emptyState } from "../src/state";

const SNAPSHOT_KEY = "deep.ui.v2";
const ACCOUNT = "account-a";
const TOKEN = "token-a";
const parentRunId = "11111111-1111-4111-8111-111111111111";
const childRunId = "22222222-2222-4222-8222-222222222222";
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const revision = 3;
const assumptions = ["Quiet fans", "Linux support"];
const question = "Compare reef restoration in colder water";
const ASSUMPTION_CLEANUP = "Saved assumption request is invalid. Device cleanup is required before new research.";
const CORRECTION_CLEANUP = "Saved correction request is invalid. Device cleanup is required before new research.";

function assumptionPrepared(): PendingAssumptions {
  return preparePendingAssumptions({
    parentRunId,
    action: "replace",
    values: assumptions,
    expectedBriefRevision: revision,
    requestId,
  });
}

function correctionPrepared(): PendingCorrection {
  return preparePendingCorrection({
    parentRunId,
    question,
    expectedBriefRevision: revision,
    evidencePolicy: "reuse_snapshot",
    requestId,
  });
}

const copy = (value: object): Record<string, unknown> => ({ ...value });

async function activatedStorage() {
  const cache = memoryStore();
  const credentials = memoryStore();
  const storage = createSessionStorage(cache, credentials);
  await storage.activate({ accountId: ACCOUNT, token: TOKEN });
  return { cache, credentials, storage };
}

async function plantDamage(
  field: "pendingAssumptions" | "pendingCorrection",
  pending: PendingAssumptions | PendingCorrection,
  patch: (row: Record<string, unknown>) => void,
) {
  const { cache, credentials, storage } = await activatedStorage();
  await storage.persistRequired(TOKEN, {
    ...emptyState(),
    signedIn: true,
    consentGranted: true,
    [field]: pending,
  });
  const envelope = JSON.parse((await cache.getItem(SNAPSHOT_KEY))!) as {
    accountId: string;
    state: Record<string, unknown>;
  };
  const row = envelope.state[field] as Record<string, unknown>;
  patch(row);
  const planted = JSON.stringify(envelope);
  await cache.setItem(SNAPSHOT_KEY, planted);
  return { cache, credentials, planted, row };
}

async function expectDamagedHydrationHeld(
  cache: ReturnType<typeof memoryStore>,
  credentials: ReturnType<typeof memoryStore>,
  planted: string,
  message: string,
) {
  await expect(createSessionStorage(cache, credentials).hydrate()).rejects.toThrow(message);
  expect(await cache.getItem(SNAPSHOT_KEY)).toBe(planted);
}

async function expectAssumptionDoesNotPost(pending: unknown) {
  const posts: string[] = [];
  await expect(runAssumptionsMutation({
    pending: pending as PendingAssumptions,
    parentRunId,
    action: "replace",
    values: assumptions,
    expectedBriefRevision: revision,
    current: () => true,
    save: async () => undefined,
    post: async () => { posts.push("posted"); return { runId: childRunId }; },
    adopt: async () => undefined,
  })).rejects.toThrow(ASSUMPTION_CLEANUP);
  expect(posts).toEqual([]);
}

async function expectCorrectionDoesNotPost(pending: unknown) {
  const posts: string[] = [];
  await expect(runPendingCorrection({
    pending: pending as PendingCorrection,
    parentRunId,
    question,
    expectedBriefRevision: revision,
    evidencePolicy: "reuse_snapshot",
    current: () => true,
    save: async () => undefined,
    post: async () => { posts.push("posted"); return { runId: childRunId }; },
    adopt: async () => undefined,
  })).rejects.toThrow(CORRECTION_CLEANUP);
  expect(posts).toEqual([]);
}

describe("RES-04 assumption durable-record parser", () => {
  it.each([
    ["missing digest", (row: Record<string, unknown>) => { delete row.payloadDigest; }],
    ["non-hex digest", (row: Record<string, unknown>) => { row.payloadDigest = "x".repeat(64); }],
    ["uppercase digest", (row: Record<string, unknown>) => { row.payloadDigest = String(row.payloadDigest).toUpperCase(); }],
    ["foreign digest", (row: Record<string, unknown>) => {
      row.payloadDigest = assumptionsPayloadDigest(parentRunId, revision, "replace", ["Different"]);
    }],
    ["old key", (row: Record<string, unknown>) => { row.idempotencyKey = `${parentRunId}-assumptions-${revision}-rolling`; }],
    ["missing requestId", (row: Record<string, unknown>) => { delete row.requestId; }],
    ["invalid requestId", (row: Record<string, unknown>) => { row.requestId = "not-a-uuid"; }],
    ["missing phase", (row: Record<string, unknown>) => { delete row.phase; }],
    ["unknown phase", (row: Record<string, unknown>) => { row.phase = "posting"; }],
    ["implicit legacy marker", (row: Record<string, unknown>) => { row.version = "assumption-journal.v0"; }],
    ["rewritten values", (row: Record<string, unknown>) => { row.values = ["Different"]; }],
    ["rewritten revision", (row: Record<string, unknown>) => { row.expectedBriefRevision = 9; }],
    ["confirm carrying values", (row: Record<string, unknown>) => { row.action = "confirm"; }],
    ["sent carrying accepted id", (row: Record<string, unknown>) => { row.phase = "sent"; row.acceptedRunId = childRunId; }],
    ["accepted replace missing run id", (row: Record<string, unknown>) => { row.phase = "accepted"; delete row.acceptedRunId; }],
    ["accepted invalid run id", (row: Record<string, unknown>) => { row.phase = "accepted"; row.acceptedRunId = "bad"; }],
    ["accepted invalid revision", (row: Record<string, unknown>) => {
      row.phase = "accepted"; row.acceptedRunId = childRunId; row.acceptedBriefRevision = 0;
    }],
  ] as const)("rejects %s without coercion", async (_name, patch) => {
    const row = copy(assumptionPrepared());
    patch(row);
    expect(() => readPendingAssumptions(row)).toThrow(ASSUMPTION_CLEANUP);
    await expectAssumptionDoesNotPost(row);
  });

  it("binds digest and key to parent/revision/action/canonical values", () => {
    const pending = assumptionPrepared();
    expect(pending.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(pending.payloadDigest).toBe(assumptionsPayloadDigest(parentRunId, revision, "replace", assumptions));
    expect(pending.idempotencyKey).toBe(mutatingAssumptionsKey(parentRunId, revision, "replace", assumptions));
    expect(readPendingAssumptions(pending)).toEqual(pending);
    expect(bindPendingAssumptions(pending, {
      parentRunId, action: "replace", values: assumptions, expectedBriefRevision: revision,
    })).toEqual(pending);
  });

  it("accepts a legitimate confirmation using the same run identity and no values", async () => {
    const prepared = preparePendingAssumptions({
      parentRunId,
      action: "confirm",
      expectedBriefRevision: revision,
      requestId,
    });
    const accepted = readPendingAssumptions({
      ...prepared,
      phase: "accepted",
      acceptedRunId: parentRunId,
      acceptedBriefRevision: 4,
    })!;
    expect(accepted.values).toBeUndefined();
    expect(accepted.acceptedRunId).toBe(parentRunId);
    const posts: string[] = [];
    const adopted: Array<{ runId?: string; briefRevision?: number }> = [];
    const result = await runAssumptionsMutation({
      pending: accepted,
      parentRunId,
      action: "confirm",
      expectedBriefRevision: revision,
      current: () => true,
      save: async () => undefined,
      post: async () => { posts.push("posted"); return {}; },
      adopt: async (body) => { adopted.push(body); },
    });
    expect(posts).toEqual([]);
    expect(adopted).toEqual([{ runId: parentRunId, briefRevision: 4 }]);
    expect(result).toMatchObject({ phase: "adopted", requestId, acceptedRunId: parentRunId, acceptedBriefRevision: 4 });
  });

  it("hydrates an accepted replacement and adopts it without another POST", async () => {
    const accepted = readPendingAssumptions({
      ...assumptionPrepared(),
      phase: "accepted",
      acceptedRunId: childRunId,
      acceptedBriefRevision: 4,
    })!;
    const { cache, credentials, storage } = await activatedStorage();
    await storage.persistRequired(TOKEN, { ...emptyState(), signedIn: true, pendingAssumptions: accepted });
    const restored = await createSessionStorage(cache, credentials).hydrate();
    expect(restored.state.pendingAssumptions).toEqual(accepted);
    const posts: string[] = [];
    const adopted: string[] = [];
    const result = await runAssumptionsMutation({
      pending: restored.state.pendingAssumptions,
      parentRunId,
      action: "replace",
      values: assumptions,
      expectedBriefRevision: revision,
      current: () => true,
      save: async () => undefined,
      post: async () => { posts.push("posted"); return { runId: childRunId }; },
      adopt: async (body) => { adopted.push(body.runId ?? "missing"); },
    });
    expect(posts).toEqual([]);
    expect(adopted).toEqual([childRunId]);
    expect(result.phase).toBe("adopted");
    expect(result.requestId).toBe(requestId);
  });

  it("holds damaged protected storage on restart instead of clearing or authorizing POST", async () => {
    const damaged = await plantDamage("pendingAssumptions", assumptionPrepared(), (row) => { delete row.requestId; });
    await expectDamagedHydrationHeld(damaged.cache, damaged.credentials, damaged.planted, ASSUMPTION_CLEANUP);
    await expectAssumptionDoesNotPost(damaged.row);
  });
});

describe("RES-04 correction durable-record parser", () => {
  it.each([
    ["missing digest", (row: Record<string, unknown>) => { delete row.payloadDigest; }],
    ["non-hex digest", (row: Record<string, unknown>) => { row.payloadDigest = "x".repeat(64); }],
    ["uppercase digest", (row: Record<string, unknown>) => { row.payloadDigest = String(row.payloadDigest).toUpperCase(); }],
    ["foreign digest", (row: Record<string, unknown>) => {
      row.payloadDigest = correctionPayloadDigest(parentRunId, revision, "Different", "reuse_snapshot");
    }],
    ["old key", (row: Record<string, unknown>) => { row.idempotencyKey = `${parentRunId}-corr-${revision}-rolling`; }],
    ["missing requestId", (row: Record<string, unknown>) => { delete row.requestId; }],
    ["invalid requestId", (row: Record<string, unknown>) => { row.requestId = "not-a-uuid"; }],
    ["missing phase", (row: Record<string, unknown>) => { delete row.phase; }],
    ["unknown phase", (row: Record<string, unknown>) => { row.phase = "posting"; }],
    ["implicit legacy marker", (row: Record<string, unknown>) => { row.version = "correction-journal.v0"; }],
    ["rewritten question", (row: Record<string, unknown>) => { row.question = "Different"; }],
    ["rewritten policy", (row: Record<string, unknown>) => { row.evidencePolicy = "refresh"; }],
    ["sent carrying accepted id", (row: Record<string, unknown>) => { row.phase = "sent"; row.acceptedRunId = childRunId; }],
    ["accepted missing run id", (row: Record<string, unknown>) => { row.phase = "accepted"; delete row.acceptedRunId; }],
    ["accepted invalid run id", (row: Record<string, unknown>) => { row.phase = "accepted"; row.acceptedRunId = "bad"; }],
    ["accepted invalid revision", (row: Record<string, unknown>) => {
      row.phase = "accepted"; row.acceptedRunId = childRunId; row.acceptedBriefRevision = -1;
    }],
  ] as const)("rejects %s without coercion", async (_name, patch) => {
    const row = copy(correctionPrepared());
    patch(row);
    expect(() => readPendingCorrection(row)).toThrow(CORRECTION_CLEANUP);
    await expectCorrectionDoesNotPost(row);
  });

  it("binds digest and key to parent/revision/question/policy", () => {
    const pending = correctionPrepared();
    expect(pending.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(pending.payloadDigest).toBe(correctionPayloadDigest(parentRunId, revision, question, "reuse_snapshot"));
    expect(pending.idempotencyKey).toBe(mutatingCorrectionKey(parentRunId, revision, question, "reuse_snapshot"));
    expect(readPendingCorrection(pending)).toEqual(pending);
    expect(bindPendingCorrection(pending, {
      parentRunId, question, expectedBriefRevision: revision, evidencePolicy: "reuse_snapshot",
    })).toEqual(pending);
  });

  it("hydrates accepted correction with omitted revision and adopts without another POST", async () => {
    const accepted = readPendingCorrection({
      ...correctionPrepared(),
      phase: "accepted",
      acceptedRunId: childRunId,
    })!;
    const { cache, credentials, storage } = await activatedStorage();
    await storage.persistRequired(TOKEN, { ...emptyState(), signedIn: true, pendingCorrection: accepted });
    const restored = await createSessionStorage(cache, credentials).hydrate();
    expect(restored.state.pendingCorrection).toEqual(accepted);
    const posts: string[] = [];
    const adopted: string[] = [];
    const result = await runPendingCorrection({
      pending: restored.state.pendingCorrection,
      parentRunId,
      question,
      expectedBriefRevision: revision,
      evidencePolicy: "reuse_snapshot",
      current: () => true,
      save: async () => undefined,
      post: async () => { posts.push("posted"); return { runId: childRunId }; },
      adopt: async (body) => { adopted.push(body.runId); },
    });
    expect(posts).toEqual([]);
    expect(adopted).toEqual([childRunId]);
    expect(result).toMatchObject({ phase: "adopted", requestId, acceptedRunId: childRunId });
    expect(result.acceptedBriefRevision).toBeUndefined();
  });

  it("hydrates well-formed sent/rejected records without changing identity or phase", async () => {
    for (const phase of ["sent", "rejected"] as const) {
      const pending = readPendingCorrection({ ...correctionPrepared(), phase })!;
      expect(readPendingCorrection(pending)).toEqual(pending);
      expect(readPendingCorrection(pending)?.requestId).toBe(requestId);
    }
  });

  it("holds damaged protected storage on restart instead of clearing or authorizing POST", async () => {
    const damaged = await plantDamage("pendingCorrection", correctionPrepared(), (row) => { row.phase = "posting"; });
    await expectDamagedHydrationHeld(damaged.cache, damaged.credentials, damaged.planted, CORRECTION_CLEANUP);
    await expectCorrectionDoesNotPost(damaged.row);
  });
});

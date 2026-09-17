import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type PgBoss from "pg-boss";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, grantConsent } from "../src/modules/access.js";
import { claimLease, insertBrief, insertConversation, insertRun, renewLease } from "../src/modules/runs.js";
import { dispatchPendingRuns } from "../src/modules/run-dispatch.js";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import { createQueue } from "../src/adapters/queue.js";
import { admitRun } from "../src/modules/run-admission.js";
import { CreateRunRequestSchema } from "@deep/contracts";
import { liveSpendUsedMicro, reserveLiveAttempt } from "../src/modules/live-spend.js";
import { loadConfig } from "../src/platform/config.js";
import { updateIntentState } from "../src/modules/billing.js";
import { fencedSession, LostWorkerLease } from "../src/worker/fenced-session.js";

let pool: pg.Pool;
let boss: PgBoss;
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
  pool = createPool(url);
  await migrate(pool);
  boss = await createQueue(url);
});
afterAll(async () => { await boss.stop({ graceful: false, timeout: 2000 }); await pool.end(); });

async function runCase(test: (runId: string, accountId: string) => Promise<void>) {
  const accountId = await withTx(pool, async (db) => {
    const session = await createDevSession(db);
    await grantConsent(db, session.accountId);
    return session.accountId;
  });
  const runId = crypto.randomUUID();
  try {
    await withTx(pool, async (db) => {
      const conversationId = await insertConversation(db, accountId, "W02 execution test");
      const briefId = crypto.randomUUID();
      await insertBrief(db, { id: briefId, conversationId, originalQuestion: "W02 execution test", language: "en",
        attachmentIds: [], sourceRestrictions: [], nonGoals: [], constraints: [], assumptions: [], budgetPolicyId: "default",
        consentPolicyVersion: CONSENT_POLICY_VERSION, revision: 1 }, accountId);
      await insertRun(db, { id: runId, accountId, conversationId, briefId, routeMode: "fixture", briefRevision: 1,
        consentEpoch: 1, idempotencyKey: crypto.randomUUID(), budgetMicro: 100_000 });
    });
    await test(runId, accountId);
  } finally {
    await withTx(pool, async (db) => {
      await db.query("DELETE FROM pgboss.job WHERE name = 'research-run' AND data->>'runId' IN (SELECT id::text FROM runs WHERE account_id = $1)", [accountId]);
      for (const table of ["provider_intents", "run_actions", "run_leases", "run_dispatch_outbox", "run_events", "reservations"])
        await db.query(`DELETE FROM ${table} WHERE run_id IN (SELECT id FROM runs WHERE account_id = $1)`, [accountId]);
      await db.query("DELETE FROM runs WHERE account_id = $1", [accountId]);
      for (const table of ["research_briefs", "conversations", "allowance_accounts", "sessions", "consent_records"])
        await db.query(`DELETE FROM ${table} WHERE account_id = $1`, [accountId]);
      await db.query("DELETE FROM accounts WHERE id = $1", [accountId]);
    });
  }
}

describe("W02 real PostgreSQL execution boundaries", () => {
  it("A08 concurrent reservations cannot exceed one project bucket; unknown attempts are not resent", async () => runCase(async (runId) => {
    const fence = (await claimLease(pool, runId, "budget-attempt", 30_000))!;
    const scope = crypto.randomUUID();
    const config = loadConfig({ DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: "200000", LIVE_BUDGET_SCOPE: scope });
    const base = { runId, fence, briefRevision: 1, kind: "search", route: "openrouter:test", requestDigest: "fixed-test-request", reserveMicro: 150_000 };
    const results = await Promise.allSettled([
      reserveLiveAttempt(pool, config, { ...base, logicalKey: "first" }),
      reserveLiveAttempt(pool, config, { ...base, logicalKey: "second" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled"), results.map((r) => r.status === "rejected" ? String(r.reason) : "issued").join("; ")).toHaveLength(1);
    expect(await liveSpendUsedMicro(pool, scope)).toBe(150_000);
    const index = results.findIndex((r) => r.status === "fulfilled");
    const accepted = results[index] as PromiseFulfilledResult<{ intentId: string; issue: boolean }>;
    await updateIntentState(pool, accepted.value.intentId, "outcome-unknown");
    const replay = await reserveLiveAttempt(pool, config, { ...base, logicalKey: index === 0 ? "first" : "second" });
    expect(replay).toEqual({ intentId: accepted.value.intentId, issue: false });
    expect(await liveSpendUsedMicro(pool, scope)).toBe(150_000);
    await updateIntentState(pool, replay.intentId, "confirmed", 12_345);
    await updateIntentState(pool, replay.intentId, "confirmed", 12_345);
    expect(await liveSpendUsedMicro(pool, scope)).toBe(12_345);
    await expect(updateIntentState(pool, replay.intentId, "confirmed", 1)).rejects.toThrow("conflicting");
  }));
  it("A14 a stale session cannot mutate the active run", async () => runCase(async (runId, accountId) => {
    const fence = (await claimLease(pool, runId, "old", 30_000))!;
    const session = fencedSession(pool, { runId, accountId, owner: "old", fence, briefRevision: 1, leaseMs: 30_000 });
    try {
      await pool.query("UPDATE run_leases SET expires_at = now() - interval '1 second' WHERE run_id = $1", [runId]);
      const next = await claimLease(pool, runId, "new", 30_000);
      await expect(session.write(async (db) => { await db.query("UPDATE runs SET lifecycle = 'terminal' WHERE id = $1", [runId]); })).rejects.toBeInstanceOf(LostWorkerLease);
      const run = await pool.query("SELECT lifecycle, worker_lease_fence FROM runs WHERE id = $1", [runId]);
      expect(run.rows[0].lifecycle).toBe("running");
      expect(Number(run.rows[0].worker_lease_fence)).toBe(next);
    } finally { session.stop(); }
  }));
  it("A43 concurrent conflicting idempotency reuse accepts one full request", async () => runCase(async (_runId, accountId) => {
    const key = crypto.randomUUID();
    const request = CreateRunRequestSchema.parse({ question: "Compare unfamiliar tools", routeMode: "fixture" });
    const results = await Promise.allSettled([
      admitRun(pool, accountId, key, request),
      admitRun(pool, accountId, key, { ...request, outputPreferences: "detailed" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("idempotency_conflict");
    const reservations = await pool.query("SELECT count(*)::int AS n FROM reservations WHERE account_id = $1", [accountId]);
    expect(reservations.rows[0].n).toBe(1);
  }));
  it("A43 identical concurrent admission reserves and dispatches only once", async () => runCase(async (_runId, accountId) => {
    const key = crypto.randomUUID();
    const request = CreateRunRequestSchema.parse({ question: "Compare unfamiliar tools" });
    const results = await Promise.all([admitRun(pool, accountId, key, request), admitRun(pool, accountId, key, request)]);
    expect(results[0].runId).toBe(results[1].runId);
    expect(results.map((r) => r.reused).sort()).toEqual([false, true]);
    const outbox = await pool.query("SELECT count(*)::int AS n FROM run_dispatch_outbox WHERE run_id = $1", [results[0].runId]);
    expect(outbox.rows[0].n).toBe(1);
  }));
  it("A24 wrong-owner parent is denied before admission", async () => runCase(async (parentId) => {
    await runCase(async (_runId, accountId) => {
      await expect(admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question: "test", parentRunId: parentId })))
        .rejects.toMatchObject({ code: "permission_denied" });
      const charges = await pool.query("SELECT count(*)::int AS n FROM reservations WHERE account_id = $1", [accountId]);
      expect(charges.rows[0].n).toBe(0);
    });
  }));
  it("A13 two connections starting together cannot acquire the same live lease", async () => runCase(async (runId) => {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await Promise.all([a.query("BEGIN"), b.query("BEGIN")]);
      // Both transactions exist before either acquisition; the row lock serializes them.
      const first = claimLease(a, runId, "same-display-name", 30_000).then(async (fence) => { await a.query("COMMIT"); return fence; });
      const second = claimLease(b, runId, "same-display-name", 30_000).then(async (fence) => { await b.query("COMMIT"); return fence; });
      const results = await Promise.all([first, second]);
      expect(results.filter((f) => f !== null)).toHaveLength(1);
      expect(results.filter((f) => f === null)).toHaveLength(1);
    } finally { await Promise.all([a.query("ROLLBACK"), b.query("ROLLBACK")]); a.release(); b.release(); }
  }));
  it("A14 expired owner cannot renew after takeover", async () => runCase(async (runId) => {
    const old = await claimLease(pool, runId, "old-attempt", 30_000);
    await pool.query("UPDATE run_leases SET expires_at = now() - interval '1 second' WHERE run_id = $1", [runId]);
    const current = await claimLease(pool, runId, "new-attempt", 30_000);
    expect(current).toBeGreaterThan(old!);
    expect(await renewLease(pool, runId, "old-attempt", old!, 30_000)).toBe(false);
    expect(await renewLease(pool, runId, "new-attempt", current!, 30_000)).toBe(true);
  }));
  it("A11 admission remains dispatchable after commit without contacting queue", async () => runCase(async (runId) => {
    const row = await pool.query("SELECT state FROM run_dispatch_outbox WHERE run_id = $1", [runId]);
    expect(row.rows[0].state).toBe("pending");
    expect(await dispatchPendingRuns(pool, boss, 1, runId)).toBe(1);
    expect(await dispatchPendingRuns(pool, boss, 1, runId)).toBe(0);
    const delivered = await pool.query("SELECT data FROM pgboss.job WHERE name = 'research-run' AND data->>'runId' = $1", [runId]);
    expect(delivered.rows).toEqual([{ data: { runId } }]);
  }));
  it("A12 queue failure preserves pending admission for retry", async () => runCase(async (runId) => {
    const queue = { send: async () => { throw new Error("controlled queue failure"); } } as unknown as PgBoss;
    expect(await dispatchPendingRuns(pool, queue, 1, runId)).toBe(0);
    const result = await pool.query("SELECT state, attempts FROM run_dispatch_outbox WHERE run_id = $1", [runId]);
    expect(result.rows[0]).toEqual({ state: "pending", attempts: 1 });
  }));
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type PgBoss from "pg-boss";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { claimLease, insertBrief, insertConversation, insertRun, renewLease } from "../src/modules/runs.js";
import { dispatchPendingRuns } from "../src/modules/run-dispatch.js";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import { createQueue } from "../src/adapters/queue.js";
import { admitRun } from "../src/modules/run-admission.js";
import { CreateRunRequestSchema } from "@deep/contracts";
import { liveSpendUsedMicro, reserveLiveAttempt } from "../src/modules/live-spend.js";
import { measureRunCost } from "../src/modules/run-cost.js";
import { loadConfig } from "../src/platform/config.js";
import { recordIntent, reconcileIntent, reserveAllowance, settleRun, updateIntentState } from "../src/modules/billing.js";
import { fencedSession, LostWorkerLease } from "../src/worker/fenced-session.js";

const budgetEnv = { OPENROUTER_API_KEY: "nonbillable-test-key", LIVE_KEY_SPEND_CAP_MICRO: "1000000000" };
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
      for (const table of ["research_briefs", "conversations", "allowance_accounts", "sessions", "consent_records", "tombstones"])
        await db.query(`DELETE FROM ${table} WHERE account_id = $1`, [accountId]);
      await db.query("DELETE FROM accounts WHERE id = $1", [accountId]);
    });
  }
}

describe("W02 real PostgreSQL execution boundaries", () => {
  it("A08 concurrent reservations cannot exceed one project bucket; unknown attempts are not resent", async () => runCase(async (runId, accountId) => {
    await withTx(pool, (db) => reserveAllowance(db, accountId, runId, 100_000));
    const fence = (await claimLease(pool, runId, "budget-attempt", 30_000))!;
    const scope = crypto.randomUUID();
    const config = loadConfig({ ...budgetEnv, DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: "60000", LIVE_BUDGET_SCOPE: scope });
    const base = { runId, fence, briefRevision: 1, kind: "search", route: "openrouter:test", requestDigest: "fixed-test-request", reserveMicro: 40_000 };
    const results = await Promise.allSettled([
      reserveLiveAttempt(pool, config, { ...base, logicalKey: "first" }),
      reserveLiveAttempt(pool, config, { ...base, logicalKey: "second" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled"), results.map((r) => r.status === "rejected" ? String(r.reason) : "issued").join("; ")).toHaveLength(1);
    expect(await liveSpendUsedMicro(pool, scope)).toBe(40_000);
    const index = results.findIndex((r) => r.status === "fulfilled");
    const accepted = results[index] as PromiseFulfilledResult<{ intentId: string; issue: boolean }>;
    await updateIntentState(pool, accepted.value.intentId, "outcome-unknown");
    const replay = await reserveLiveAttempt(pool, config, { ...base, logicalKey: index === 0 ? "first" : "second" });
    expect(replay).toEqual({ intentId: accepted.value.intentId, issue: false });
    expect(await liveSpendUsedMicro(pool, scope)).toBe(40_000);
    await updateIntentState(pool, replay.intentId, "confirmed", 12_345);
    await updateIntentState(pool, replay.intentId, "confirmed", 12_345);
    expect(await liveSpendUsedMicro(pool, scope)).toBe(12_345);
    await expect(updateIntentState(pool, replay.intentId, "confirmed", 1)).rejects.toThrow("conflicting");
  }));
  it("A08 run cap blocks concurrent calls despite a larger project cap", async () => runCase(async (runId, accountId) => {
    await withTx(pool, (db) => reserveAllowance(db, accountId, runId, 100_000));
    const fence = (await claimLease(pool, runId, "run-cap", 30_000))!;
    const config = loadConfig({ ...budgetEnv, DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: "1000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() });
    const base = { runId, fence, briefRevision: 1, kind: "search", route: "openrouter:test", requestDigest: "run-cap", reserveMicro: 60_000 };
    const results = await Promise.allSettled([reserveLiveAttempt(pool, config, { ...base, logicalKey: "a" }), reserveLiveAttempt(pool, config, { ...base, logicalKey: "b" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message).toBe("run_spend_cap_exhausted");
  }));
  it("A08 issuance requires an active account allowance reservation", async () => runCase(async (runId) => {
    const fence = (await claimLease(pool, runId, "no-allowance", 30_000))!;
    const config = loadConfig({ ...budgetEnv, DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: "1000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() });
    await expect(reserveLiveAttempt(pool, config, { runId, fence, briefRevision: 1, kind: "search", route: "openrouter:test", requestDigest: "no-allowance", reserveMicro: 1, logicalKey: "a" })).rejects.toThrow("missing_active_run_allowance");
  }));
  it("A09 unknown provider outcome retains allowance until an actual receipt; repeated settlement is idempotent", async () => runCase(async (runId, accountId) => {
    await withTx(pool, (db) => reserveAllowance(db, accountId, runId, 100_000));
    await pool.query("UPDATE runs SET route_mode = 'controlled-research' WHERE id = $1", [runId]);
    const fence = (await claimLease(pool, runId, "unknown-cost", 30_000))!;
    const config = loadConfig({ ...budgetEnv, DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: "1000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() });
    const intent = await reserveLiveAttempt(pool, config, { runId, fence, briefRevision: 1, kind: "search", route: "openrouter:test", requestDigest: "unknown-cost", reserveMicro: 60_000, logicalKey: "a" });
    await updateIntentState(pool, intent.intentId, "outcome-unknown");
    await withTx(pool, (db) => settleRun(db, accountId, runId, 0));
    const held = await pool.query("SELECT state FROM reservations WHERE run_id = $1", [runId]);
    expect(held.rows[0].state).toBe("reserved");
    const allowance = await pool.query("SELECT reserved_micro, settled_micro FROM allowance_accounts WHERE account_id = $1", [accountId]);
    expect(allowance.rows[0]).toEqual({ reserved_micro: "100000", settled_micro: "0" });
    await updateIntentState(pool, intent.intentId, "confirmed", 12_345);
    await Promise.all([withTx(pool, (db) => settleRun(db, accountId, runId, 0)), withTx(pool, (db) => settleRun(db, accountId, runId, 0))]);
    const settled = await pool.query("SELECT reserved_micro, settled_micro FROM allowance_accounts WHERE account_id = $1", [accountId]);
    expect(settled.rows[0]).toEqual({ reserved_micro: "0", settled_micro: "12345" });
  }));
  it("A09 actual receipt overrun is recorded without clamping or stealing another account reservation", async () => runCase(async (runId, accountId) => {
    await withTx(pool, (db) => reserveAllowance(db, accountId, runId, 100_000));
    await pool.query("UPDATE runs SET route_mode = 'controlled-research' WHERE id = $1", [runId]);
    const fence = (await claimLease(pool, runId, "overrun", 30_000))!;
    const config = loadConfig({ ...budgetEnv, DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: "1000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() });
    const intent = await reserveLiveAttempt(pool, config, { runId, fence, briefRevision: 1, kind: "search", route: "openrouter:test", requestDigest: "overrun", reserveMicro: 60_000, logicalKey: "a" });
    await updateIntentState(pool, intent.intentId, "confirmed", 123_456);
    await runCase(async (_otherRun, otherAccount) => {
      await expect(withTx(pool, (db) => settleRun(db, otherAccount, runId, 0))).rejects.toThrow("settlement_owner_mismatch");
    });
    await withTx(pool, (db) => settleRun(db, accountId, runId, 0));
    const allowance = await pool.query("SELECT reserved_micro, settled_micro FROM allowance_accounts WHERE account_id = $1", [accountId]);
    expect(allowance.rows[0]).toEqual({ reserved_micro: "0", settled_micro: "123456" });
    const spent = await pool.query("SELECT spent_micro FROM runs WHERE id = $1", [runId]);
    expect(spent.rows[0].spent_micro).toBe("123456");
    await expect(reserveLiveAttempt(pool, config, { runId, fence, briefRevision: 1, kind: "search", route: "openrouter:test", requestDigest: "overrun2", reserveMicro: 1, logicalKey: "b" })).rejects.toThrow("missing_active_run_allowance");
  }));
  it("A08 the same provider key cannot bypass its cap through different project scopes or accounts", async () => runCase(async (runA, accountA) => runCase(async (runB, accountB) => {
    await withTx(pool, (db) => reserveAllowance(db, accountA, runA, 100_000));
    await withTx(pool, (db) => reserveAllowance(db, accountB, runB, 100_000));
    const [fenceA, fenceB] = await Promise.all([claimLease(pool, runA, "key-a", 30_000), claimLease(pool, runB, "key-b", 30_000)]);
    const legacy = await pool.query<{ used: string }>("SELECT COALESCE(SUM(COALESCE(confirmed_micro, reserved_max_micro)),0)::text AS used FROM provider_intents i WHERE route LIKE 'openrouter:%' AND to_jsonb(i)->>'provider_key_scope' IS NULL");
    const config = { ...loadConfig({ ...budgetEnv, DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: "1000000", OPENROUTER_API_KEY: "nonbillable-shared-test-key" }), liveKeySpendCapMicro: Number(legacy.rows[0]!.used) + 60_000 };
    const args = { briefRevision: 1, kind: "search", route: "openrouter:test", requestDigest: "key-cap", reserveMicro: 40_000, logicalKey: "a" };
    const results = await Promise.allSettled([
      reserveLiveAttempt(pool, { ...config, liveBudgetScope: crypto.randomUUID() }, { ...args, runId: runA, fence: fenceA! }),
      reserveLiveAttempt(pool, { ...config, openRouterApiKey: " nonbillable-shared-test-key ", liveBudgetScope: crypto.randomUUID() }, { ...args, runId: runB, fence: fenceB! }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message).toBe("provider_key_cap_exhausted");
  })));
  it.each(["missing key", "zero cap"])("A08 provider-key gate fails closed: %s", async (which) => runCase(async (runId, accountId) => {
    await withTx(pool, (db) => reserveAllowance(db, accountId, runId, 100_000));
    const fence = (await claimLease(pool, runId, "key-deny", 30_000))!;
    const config = { ...loadConfig({ ...budgetEnv, DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: "1000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() }),
      openRouterApiKey: which === "missing key" ? undefined : "nonbillable-test-key", liveKeySpendCapMicro: which === "zero cap" ? 0 : 1_000_000 };
    await expect(reserveLiveAttempt(pool, config, { runId, fence, briefRevision: 1, kind: "search", route: "openrouter:test", requestDigest: "key-deny", reserveMicro: 1, logicalKey: "a" }))
      .rejects.toThrow(which === "missing key" ? "missing_provider_key" : "provider_key_cap_exhausted");
    const intents = await pool.query("SELECT id FROM provider_intents WHERE run_id = $1", [runId]);
    expect(intents.rows).toHaveLength(0);
  }));
  it("A08 unattributed legacy receipts consume the key budget until reconciled", async () => runCase(async (runId, accountId) => {
    await withTx(pool, (db) => reserveAllowance(db, accountId, runId, 100_000));
    const fence = (await claimLease(pool, runId, "legacy-key", 30_000))!;
    const prior = await pool.query<{ used: string }>("SELECT COALESCE(SUM(COALESCE(confirmed_micro, reserved_max_micro)),0)::text AS used FROM provider_intents WHERE route LIKE 'openrouter:%' AND provider_key_scope IS NULL");
    const legacy = await recordIntent(pool, runId, { correlationId: crypto.randomUUID(), route: "openrouter:legacy", digest: "legacy-test", reserved: 3_000, state: "outcome-unknown" });
    const config = { ...loadConfig({ ...budgetEnv, DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: "1000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() }), liveKeySpendCapMicro: Number(prior.rows[0]!.used) + 3_000 };
    const args = { runId, fence, briefRevision: 1, kind: "search", route: "openrouter:test", requestDigest: "legacy-key", reserveMicro: 1_000, logicalKey: "a" };
    await expect(reserveLiveAttempt(pool, config, args)).rejects.toThrow("provider_key_cap_exhausted");
    await updateIntentState(pool, legacy, "confirmed", 0);
    const accepted = await reserveLiveAttempt(pool, config, args);
    expect(accepted.issue).toBe(true);
    const identity = await pool.query<{ provider_key_scope: string }>("SELECT provider_key_scope FROM provider_intents WHERE id = $1", [accepted.intentId]);
    expect(identity.rows[0]?.provider_key_scope).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.rows[0]?.provider_key_scope).not.toContain("nonbillable-test-key");
  }));
  it("A08 different provider keys have distinct buckets while retaining a shared project cap", async () => runCase(async (runA, accountA) => runCase(async (runB, accountB) => {
    await withTx(pool, (db) => reserveAllowance(db, accountA, runA, 100_000));
    await withTx(pool, (db) => reserveAllowance(db, accountB, runB, 100_000));
    const [fenceA, fenceB] = await Promise.all([claimLease(pool, runA, "separate-a", 30_000), claimLease(pool, runB, "separate-b", 30_000)]);
    const legacy = await pool.query<{ used: string }>("SELECT COALESCE(SUM(COALESCE(confirmed_micro, reserved_max_micro)),0)::text AS used FROM provider_intents WHERE route LIKE 'openrouter:%' AND provider_key_scope IS NULL");
    const config = { ...loadConfig({ ...budgetEnv, DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: "80000", LIVE_BUDGET_SCOPE: crypto.randomUUID() }), liveKeySpendCapMicro: Number(legacy.rows[0]!.used) + 40_000 };
    const args = { briefRevision: 1, kind: "search", route: "openrouter:test", requestDigest: "separate-key", reserveMicro: 40_000, logicalKey: "a" };
    const results = await Promise.all([
      reserveLiveAttempt(pool, { ...config, openRouterApiKey: "nonbillable-distinct-a" }, { ...args, runId: runA, fence: fenceA! }),
      reserveLiveAttempt(pool, { ...config, openRouterApiKey: "nonbillable-distinct-b" }, { ...args, runId: runB, fence: fenceB! }),
    ]);
    expect(results.every((result) => result.issue)).toBe(true);
    expect(await liveSpendUsedMicro(pool, config.liveBudgetScope)).toBe(80_000);
    const scopes = await pool.query("SELECT DISTINCT provider_key_scope FROM provider_intents WHERE id = ANY($1::uuid[])", [results.map((r) => r.intentId)]);
    expect(scopes.rows).toHaveLength(2);
  })));
  it("A09 a late confirmed receipt reconciles terminal allowance once without replaying the provider", async () => runCase(async (runId, accountId) => {
    await withTx(pool, (db) => reserveAllowance(db, accountId, runId, 100_000));
    await pool.query("UPDATE runs SET route_mode = 'controlled-research' WHERE id = $1", [runId]);
    const fence = (await claimLease(pool, runId, "late-receipt", 30_000))!;
    const config = loadConfig({ ...budgetEnv, DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: "1000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() });
    const intent = await reserveLiveAttempt(pool, config, { runId, fence, briefRevision: 1, kind: "search", route: "openrouter:test", requestDigest: "late-receipt", reserveMicro: 60_000, logicalKey: "a" });
    await updateIntentState(pool, intent.intentId, "outcome-unknown");
    await pool.query("UPDATE runs SET lifecycle = 'terminal', terminal_outcome = 'cancelled' WHERE id = $1", [runId]);
    await withTx(pool, (db) => settleRun(db, accountId, runId, 0));
    await Promise.all([reconcileIntent(pool, intent.intentId, 12_345), reconcileIntent(pool, intent.intentId, 12_345)]);
    const allowance = await pool.query("SELECT reserved_micro, settled_micro FROM allowance_accounts WHERE account_id = $1", [accountId]);
    expect(allowance.rows[0]).toEqual({ reserved_micro: "0", settled_micro: "12345" });
    expect((await pool.query("SELECT spent_micro FROM runs WHERE id = $1", [runId])).rows[0].spent_micro).toBe("12345");
    expect(await measureRunCost(pool, runId, accountId)).toMatchObject({ allowanceReconciled: true });
    await expect(reconcileIntent(pool, intent.intentId, 99)).rejects.toThrow("conflicting_or_missing_provider_receipt");
    expect((await pool.query("SELECT count(*)::int AS n FROM provider_intents WHERE run_id = $1", [runId])).rows[0].n).toBe(1);
  }));
  it("A09 cost inspection distinguishes held provider cost from confirmed and simulated costs", async () => runCase(async (runId, accountId) => {
    await pool.query("UPDATE runs SET route_mode = 'controlled-research', spent_micro = 60000 WHERE id = $1", [runId]);
    const intent = await recordIntent(pool, runId, { correlationId: crypto.randomUUID(), route: "openrouter:test:web", digest: "cost-view", reserved: 60_000, state: "outcome-unknown" });
    await recordIntent(pool, runId, { correlationId: crypto.randomUUID(), route: "fixture:synthesize", digest: "historical-simulation", reserved: 4_000, state: "confirmed" });
    const unknown = await measureRunCost(pool, runId, accountId);
    expect(unknown).toMatchObject({ spentMicro: 0, confirmedProviderMicro: 0, heldProviderMicro: 60_000, unknownProviderIntents: 1, intentTotalMicro: 60_000, reconciled: false });
    await reconcileIntent(pool, intent, 12_345);
    const known = await measureRunCost(pool, runId, accountId);
    expect(known).toMatchObject({ spentMicro: 12_345, confirmedProviderMicro: 12_345, heldProviderMicro: 0, unknownProviderIntents: 0, intentTotalMicro: 12_345, reconciled: true });
    expect(await measureRunCost(pool, runId, crypto.randomUUID())).toBeNull();
  }));
  it("A09 a receipt after deletion settles only incurred cost without restoring private data", async () => runCase(async (runId, accountId) => {
    await withTx(pool, (db) => reserveAllowance(db, accountId, runId, 100_000));
    await pool.query("UPDATE runs SET route_mode = 'controlled-research' WHERE id = $1", [runId]);
    const intent = await recordIntent(pool, runId, { correlationId: crypto.randomUUID(), route: "openrouter:test", digest: "private-old-query", reserved: 60_000, state: "outcome-unknown" });
    await deleteAccount(pool, accountId);
    await reconcileIntent(pool, intent, 12_345);
    const allowance = await pool.query("SELECT reserved_micro, settled_micro FROM allowance_accounts WHERE account_id = $1", [accountId]);
    expect(allowance.rows[0]).toEqual({ reserved_micro: "0", settled_micro: "12345" });
    expect((await pool.query("SELECT deleted_at FROM accounts WHERE id = $1", [accountId])).rows[0].deleted_at).not.toBeNull();
    expect((await pool.query("SELECT original_question FROM research_briefs WHERE account_id = $1", [accountId])).rows[0].original_question).toBe("[deleted]");
    expect((await pool.query("SELECT request_digest FROM provider_intents WHERE id = $1", [intent])).rows[0].request_digest).toBe("[deleted]");
    expect((await pool.query("SELECT id FROM sessions WHERE account_id = $1", [accountId])).rows).toHaveLength(0);
  }));
  it("A09 historical settlements without receipt basis stay explicitly unreconciled and are not retroactively charged", async () => runCase(async (runId, accountId) => {
    await withTx(pool, (db) => reserveAllowance(db, accountId, runId, 100_000));
    await pool.query("UPDATE runs SET route_mode = 'controlled-research', lifecycle = 'terminal', terminal_outcome = 'cancelled' WHERE id = $1", [runId]);
    const intent = await recordIntent(pool, runId, { correlationId: crypto.randomUUID(), route: "openrouter:test", digest: "historical", reserved: 60_000, state: "outcome-unknown" });
    await withTx(pool, async (db) => {
      await db.query("UPDATE reservations SET state = 'settled', settled_micro = NULL, settlement_basis = NULL WHERE run_id = $1", [runId]);
      await db.query("UPDATE allowance_accounts SET reserved_micro = 0, settled_micro = 7000 WHERE account_id = $1", [accountId]);
    });
    await reconcileIntent(pool, intent, 12_345);
    expect(await measureRunCost(pool, runId, accountId)).toMatchObject({ confirmedProviderMicro: 12_345, allowanceReconciled: false });
    expect((await pool.query("SELECT settled_micro FROM allowance_accounts WHERE account_id = $1", [accountId])).rows[0].settled_micro).toBe("7000");
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

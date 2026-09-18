import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { insertBrief, insertConversation, insertRun, claimLease, markTerminal } from "../src/modules/runs.js";
import { reserveAllowance, settleRun, updateIntentState } from "../src/modules/billing.js";
import { reserveLiveAttempt } from "../src/modules/live-spend.js";
import { measureRunCost } from "../src/modules/run-cost.js";
import { repairHistoricalAccounting, reconcileProviderIntent } from "../src/modules/provider-reconciliation.js";
import { loadConfig } from "../src/platform/config.js";
import type { GenerationReceipt } from "../src/ports/provider-receipt.js";

let pool: pg.Pool;
beforeAll(async () => {
  pool = createPool(process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test");
  await migrate(pool);
});
afterAll(async () => { await pool.end(); });
async function caseWithRun(test: (x: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const x = await setup();
  try { await test(x); } finally { await deleteAccount(pool, x.accountId); }
}
async function setup(modelPolicyId: "openrouter-openai-mini-text-v1" | "openrouter-azure-mini-zdr-text-v1" = "openrouter-openai-mini-text-v1") {
  const accountId = await withTx(pool, async db => {
    const s = await createDevSession(db); await grantConsent(db, s.accountId); return s.accountId;
  });
  const runId = crypto.randomUUID(), key = `nonbillable-receipt-${crypto.randomUUID()}`, scope = crypto.randomUUID();
  const config = loadConfig({ DATABASE_URL: "postgres://localhost/test", OPENROUTER_API_KEY: key,
    LIVE_BUDGET_SCOPE: scope, LIVE_SPEND_CAP_MICRO: "1000000", LIVE_KEY_SPEND_CAP_MICRO: "1000000" });
  await withTx(pool, async db => {
    const conversationId = await insertConversation(db, accountId, "Receipt recovery control"), briefId = crypto.randomUUID();
    await insertBrief(db, { id: briefId, conversationId, originalQuestion: "Receipt recovery control", language: "en",
      attachmentIds: [], sourceRestrictions: [], nonGoals: [], constraints: [], assumptions: [], budgetPolicyId: "default",
      consentPolicyVersion: CONSENT_POLICY_VERSION, revision: 1 }, accountId);
    await insertRun(db, { id: runId, accountId, conversationId, briefId, routeMode: "controlled-research", briefRevision: 1,
      consentEpoch: 1, idempotencyKey: crypto.randomUUID(), budgetMicro: 100_000, modelPolicyId });
    await reserveAllowance(db, accountId, runId, 100_000);
  });
  const fence = (await claimLease(pool, runId, crypto.randomUUID(), 60_000))!;
  const intentId = (await reserveLiveAttempt(pool, config, { runId, fence, briefRevision: 1, kind: "brief",
    route: "openrouter:openai/gpt-4o-mini:brief", requestDigest: "f".repeat(64), reserveMicro: 20_000, logicalKey: "receipt-test" })).intentId;
  const providerId = `gen-${crypto.randomUUID()}`;
  await pool.query("UPDATE provider_intents SET receipt=$2,state='outcome-unknown' WHERE id=$1", [intentId,
    JSON.stringify({ providerId, requestedModel: "openai/gpt-4o-mini", actualMicro: null })]);
  const receipt: GenerationReceipt = { version: "openrouter-generation-cost.v1", providerId, model: "openai/gpt-4o-mini",
    provider: "OpenAI", actualMicro: 1234, rawCost: "0.001234", retrievedAt: new Date().toISOString(), responseDigest: "a".repeat(64) };
  return { accountId, runId, fence, intentId, config, receipt };
}
const signal = () => new AbortController().signal;
it("W02 reconciles an actual lookup receipt after terminal cancellation without network locks or duplicate settlement", async () => caseWithRun(async x => {
  await withTx(pool, async db => { await markTerminal(db, x.runId, "cancelled"); await settleRun(db, x.accountId, x.runId, 0); });
  expect((await measureRunCost(pool, x.runId, x.accountId))?.heldProviderMicro).toBe(20_000);
  let probes: Promise<unknown> = Promise.resolve(), arrivals = 0, release!: () => void;
  const bothLookups = new Promise<void>(resolve => { release = resolve; });
  const lookup = async () => {
    // Serialize the test probes themselves, then release both receipts together.
    // Otherwise two successful NOWAIT probes can collide with each other.
    probes = probes.then(() => withTx(pool, async db => {
      await db.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE NOWAIT", [x.accountId]);
      await db.query("SELECT id FROM runs WHERE id=$1 FOR UPDATE NOWAIT", [x.runId]);
    }));
    await probes;
    if (++arrivals === 2) release();
    await bothLookups;
    return { kind: "receipt" as const, receipt: x.receipt };
  };
  const outcomes = await Promise.all([1, 2].map(() => reconcileProviderIntent(pool, x.config, x.intentId, lookup, signal())));
  expect(outcomes.map(v => v.kind)).toEqual(["reconciled", "reconciled"]);
  expect(outcomes.filter(v => "reused" in v && v.reused)).toHaveLength(1);
  const cost = await measureRunCost(pool, x.runId, x.accountId);
  expect(cost).toMatchObject({ confirmedProviderMicro: 1234, heldProviderMicro: 0, allowanceReconciled: true });
  expect((await pool.query("SELECT reserved_micro,settled_micro FROM allowance_accounts WHERE account_id=$1", [x.accountId])).rows[0])
    .toEqual({ reserved_micro: "0", settled_micro: "1234" });
  expect((await pool.query("SELECT receipt FROM provider_intents WHERE id=$1", [x.intentId])).rows[0].receipt.actualMicro).toBeNull();
}));
it("W02 absent metadata and unavailable credential provenance retain unknown holds without a lookup", async () => caseWithRun(async x => {
  let calls = 0;
  const lookup = async () => { calls++; return { kind: "unavailable" as const, reason: "receipt_http_404" }; };
  expect(await reconcileProviderIntent(pool, x.config, x.intentId, lookup, signal())).toEqual({ kind: "unavailable", reason: "receipt_http_404" });
  expect((await measureRunCost(pool, x.runId, x.accountId))?.heldProviderMicro).toBe(20_000);
  await pool.query("UPDATE provider_intents SET provider_key_scope=NULL WHERE id=$1", [x.intentId]);
  expect((await reconcileProviderIntent(pool, x.config, x.intentId, lookup, signal())).kind).toBe("unavailable");
  expect(calls).toBe(1);
}));
it("W02 deletion during lookup permits only minimal financial settlement", async () => caseWithRun(async x => {
  const result = await reconcileProviderIntent(pool, x.config, x.intentId, async () => {
    await deleteAccount(pool, x.accountId); return { kind: "receipt", receipt: x.receipt };
  }, signal());
  expect(result.kind).toBe("reconciled");
  expect((await pool.query("SELECT 1 FROM model_operation_results WHERE account_id=$1", [x.accountId])).rowCount).toBe(0);
  expect((await measureRunCost(pool, x.runId, x.accountId))?.allowanceReconciled).toBe(true);
}));
it("W02 mismatched generation, route and cost cannot settle a different intent", async () => caseWithRun(async x => {
  for (const patch of [{ providerId: "wrong" }, { model: "different/model" }, { provider: "Different" }, { actualMicro: 1 }]) {
    await expect(reconcileProviderIntent(pool, x.config, x.intentId, async () => ({ kind: "receipt", receipt: { ...x.receipt, ...patch } }), signal()))
      .rejects.toThrow("receipt_route_or_cost_mismatch");
  }
  expect((await measureRunCost(pool, x.runId, x.accountId))?.heldProviderMicro).toBe(20_000);
}));
it("W02 confirmed overruns remain visible and block new issuance even with spare caps", async () => caseWithRun(async x => {
  const receipt = { ...x.receipt, actualMicro: 25_000, rawCost: "0.025" };
  await reconcileProviderIntent(pool, x.config, x.intentId, async () => ({ kind: "receipt", receipt }), signal());
  expect((await measureRunCost(pool, x.runId, x.accountId))?.confirmedProviderMicro).toBe(25_000);
  await expect(reserveLiveAttempt(pool, x.config, { runId: x.runId, fence: x.fence, briefRevision: 1, kind: "brief",
    route: "openrouter:openai/gpt-4o-mini:brief", requestDigest: "e".repeat(64), reserveMicro: 1, logicalKey: "after-overrun" }))
    .rejects.toThrow("provider_overrun_requires_review");
}));
it("W02 a generation receipt cannot be charged to two intents", async () => caseWithRun(async x => {
  const second = await reserveLiveAttempt(pool, x.config, { runId: x.runId, fence: x.fence, briefRevision: 1, kind: "brief",
    route: "openrouter:openai/gpt-4o-mini:brief", requestDigest: "d".repeat(64), reserveMicro: 20_000, logicalKey: "second-receipt" });
  await pool.query("UPDATE provider_intents SET receipt=$2 WHERE id=$1", [second.intentId, JSON.stringify({ providerId: x.receipt.providerId })]);
  const lookup = async () => ({ kind: "receipt" as const, receipt: x.receipt });
  await reconcileProviderIntent(pool, x.config, x.intentId, lookup, signal());
  await expect(reconcileProviderIntent(pool, x.config, second.intentId, lookup, signal())).rejects.toThrow(/unique constraint/);
  expect((await measureRunCost(pool, x.runId, x.accountId))).toMatchObject({ confirmedProviderMicro: 1234, heldProviderMicro: 20_000 });
}));
it("W02 historical estimated settlement is atomically restored to unknown hold then reconciled by receipt", async () => caseWithRun(async x => {
  await updateIntentState(pool, x.intentId, "confirmed", 20_000);
  await withTx(pool, async db => { await markTerminal(db, x.runId, "completed"); await settleRun(db, x.accountId, x.runId, 20_000); });
  expect(await repairHistoricalAccounting(pool, x.runId, x.accountId)).toEqual({ kind: "repaired", repaired: 1 });
  expect(await repairHistoricalAccounting(pool, x.runId, x.accountId)).toEqual({ kind: "unchanged", repaired: 0 });
  expect((await measureRunCost(pool, x.runId, x.accountId))).toMatchObject({ confirmedProviderMicro: 0, heldProviderMicro: 20_000, reservationState: "reserved" });
  expect((await pool.query("SELECT settled_micro,reserved_micro FROM allowance_accounts WHERE account_id=$1", [x.accountId])).rows[0])
    .toEqual({ settled_micro: "0", reserved_micro: "100000" });
  await reconcileProviderIntent(pool, x.config, x.intentId, async () => ({ kind: "receipt", receipt: x.receipt }), signal());
  expect((await measureRunCost(pool, x.runId, x.accountId))).toMatchObject({ confirmedProviderMicro: 1234, allowanceReconciled: true });
  expect(await repairHistoricalAccounting(pool, x.runId, x.accountId)).toEqual({ kind: "unchanged", repaired: 0 });
}));
it("W02 missing historical settlement basis and owner mismatch cannot invent a refund", async () => caseWithRun(async x => {
  await updateIntentState(pool, x.intentId, "confirmed", 20_000);
  await withTx(pool, async db => { await markTerminal(db, x.runId, "completed"); await settleRun(db, x.accountId, x.runId, 20_000); });
  await pool.query("UPDATE reservations SET settled_micro=NULL WHERE run_id=$1", [x.runId]);
  expect(await repairHistoricalAccounting(pool, x.runId, x.accountId)).toEqual({ kind: "blocked", reason: "historical_settlement_basis_missing" });
  await expect(repairHistoricalAccounting(pool, x.runId, crypto.randomUUID())).rejects.toThrow("accounting_owner_mismatch");
  expect((await pool.query("SELECT confirmed_micro FROM provider_intents WHERE id=$1", [x.intentId])).rows[0].confirmed_micro).toBe("20000");
}));
it("W02 historical overruns cannot release unresolved liability through a smaller original hold", async () => caseWithRun(async x => {
  await pool.query("UPDATE provider_intents SET reserved_max_micro=120000 WHERE id=$1", [x.intentId]);
  await updateIntentState(pool, x.intentId, "confirmed", 120_000);
  await withTx(pool, async db => { await markTerminal(db, x.runId, "completed"); await settleRun(db, x.accountId, x.runId, 120_000); });
  const before = (await pool.query("SELECT settled_micro,reserved_micro FROM allowance_accounts WHERE account_id=$1", [x.accountId])).rows[0];
  expect(await repairHistoricalAccounting(pool, x.runId, x.accountId)).toEqual({ kind: "blocked", reason: "historical_hold_insufficient" });
  expect((await pool.query("SELECT settled_micro,reserved_micro FROM allowance_accounts WHERE account_id=$1", [x.accountId])).rows[0]).toEqual(before);
  expect((await pool.query("SELECT confirmed_micro,state FROM provider_intents WHERE id=$1", [x.intentId])).rows[0])
    .toEqual({ confirmed_micro: "120000", state: "confirmed" });
  expect((await pool.query("SELECT 1 FROM provider_accounting_repairs WHERE intent_id=$1", [x.intentId])).rowCount).toBe(0);
}));
it("W02 an unsettled historical reservation must cover all remaining intent liability", async () => caseWithRun(async x => {
  await updateIntentState(pool, x.intentId, "confirmed", 20_000);
  await pool.query("UPDATE reservations SET amount_micro=10000 WHERE run_id=$1", [x.runId]);
  await withTx(pool, async db => { await markTerminal(db, x.runId, "completed"); });
  expect(await repairHistoricalAccounting(pool, x.runId, x.accountId)).toEqual({ kind: "blocked", reason: "historical_hold_insufficient" });
  expect((await pool.query("SELECT confirmed_micro FROM provider_intents WHERE id=$1", [x.intentId])).rows[0].confirmed_micro).toBe("20000");
}));
for (const variant of ["shared-key", "shared-project", "legacy-key"] as const) {
  it(`W02 ${variant} receipt settlement and admission serialize across accounts`, async () => caseWithRun(async x => caseWithRun(async y => {
    const { createHash } = await import("node:crypto");
    const yKey = createHash("sha256").update(`openrouter:${y.config.openRouterApiKey!.trim()}`).digest("hex");
    await pool.query("UPDATE provider_intents SET provider_key_scope=$2,scope_key=$3 WHERE id=$1", [x.intentId,
      variant === "legacy-key" ? null : variant === "shared-key" ? yKey : createHash("sha256").update(`openrouter:${x.config.openRouterApiKey!.trim()}`).digest("hex"),
      variant === "shared-project" ? y.config.liveBudgetScope : x.config.liveBudgetScope]);
    const barrier = await pool.connect();
    let admission: Promise<unknown> | undefined, receipt: Promise<unknown> | undefined;
    async function waitFor(sql: string) {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        if ((await pool.query(sql)).rows[0]?.waiting) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error("Expected database lock waiter did not appear");
    }
    try {
      await barrier.query("BEGIN");
      await barrier.query("LOCK TABLE run_actions IN SHARE MODE");
      admission = reserveLiveAttempt(pool, y.config, { runId: y.runId, fence: y.fence, briefRevision: 1, kind: "brief",
        route: "openrouter:openai/gpt-4o-mini:brief", requestDigest: "c".repeat(64), reserveMicro: 1, logicalKey: "racing-admission" });
      await waitFor("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation='run_actions'::regclass AND NOT granted) AS waiting");
      receipt = updateIntentState(pool, x.intentId, "confirmed", 25_000);
      await waitFor("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting");
      await barrier.query("COMMIT");
      await Promise.all([admission, receipt]);
      await expect(reserveLiveAttempt(pool, y.config, { runId: y.runId, fence: y.fence, briefRevision: 1, kind: "brief",
        route: "openrouter:openai/gpt-4o-mini:brief", requestDigest: "b".repeat(64), reserveMicro: 1, logicalKey: "after-race" }))
        .rejects.toThrow("provider_overrun_requires_review");
    } finally {
      await barrier.query("ROLLBACK"); barrier.release();
      await Promise.allSettled([admission, receipt].filter(Boolean));
      // Production retains deleted-account financial records. Remove only this synthetic
      // legacy key ambiguity after exercising the global guard, so it cannot poison later suites.
      if (variant === "legacy-key") await pool.query("UPDATE provider_intents SET provider_key_scope=$2 WHERE id=$1", [x.intentId,
        createHash("sha256").update(`openrouter:${x.config.openRouterApiKey!.trim()}`).digest("hex")]);
    }
  })));
}

it.each([false,true])("W02 Azure text admission reconciles its exact structured or independent discovery provider: discovery=%s", async discovery => {
 const x=await setup("openrouter-azure-mini-zdr-text-v1");
 try {
  if(discovery) await pool.query("UPDATE provider_intents SET route='openrouter:openai/gpt-4o-mini:public-discovery.v1' WHERE id=$1",[x.intentId]);
  const provider=discovery?"OpenAI":"Azure";
  await expect(reconcileProviderIntent(pool,x.config,x.intentId,async()=>({kind:"receipt",receipt:{...x.receipt,provider:discovery?"Azure":"OpenAI"}}),signal())).rejects.toThrow("receipt_route_or_cost_mismatch");
  expect((await measureRunCost(pool,x.runId,x.accountId))?.heldProviderMicro).toBe(20_000);
  expect(await reconcileProviderIntent(pool,x.config,x.intentId,async()=>({kind:"receipt",receipt:{...x.receipt,provider}}),signal())).toMatchObject({kind:"reconciled",actualMicro:1234});
 } finally {await deleteAccount(pool,x.accountId);}
});

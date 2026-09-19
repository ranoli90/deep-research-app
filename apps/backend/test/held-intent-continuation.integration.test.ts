import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { CreateRunRequestSchema } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, grantConsent } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { claimLease, cancelRun } from "../src/modules/runs.js";
import { performModelOperation } from "../src/worker/model-gateway.js";
import { fencedSession } from "../src/worker/fenced-session.js";
import { processRun } from "../src/worker/executor.js";
import { loadConfig } from "../src/platform/config.js";
import { AZURE_ZDR_MODEL_POLICY } from "../src/ports/model-policy.js";
import { AuthorizationSchema, evaluationQuestionDigest, sha256 } from "../src/evaluation/authorization.js";
import { preservedHeldExposure } from "../src/evaluation/held-intent-continuation.js";
const pool = createPool(process.env.TEST_DATABASE_URL!);
const originalFetch = globalThis.fetch;
beforeAll(() => migrate(pool));
afterEach(() => { globalThis.fetch = originalFetch; });
afterAll(() => pool.end());
async function setup() {
  const accountId = await withTx(pool, async db => { const a = await createDevSession(db); await grantConsent(db, a.accountId); return a.accountId; });
  const question = "Explain database isolation using a public example.";
  const admitted = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question, routeMode: "controlled-research" }), { modelPolicyId: AZURE_ZDR_MODEL_POLICY.id });
  const key = `nonbillable-${crypto.randomUUID()}`, budgetScope = `evaluation:${crypto.randomUUID()}`;
  const config = loadConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL!, LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true", OPENROUTER_API_KEY: key, LIVE_SPEND_CAP_MICRO: "1000000", LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_BUDGET_SCOPE: budgetScope });
  const owner = crypto.randomUUID(), fence = (await claimLease(pool, admitted.runId, owner, 30000))!;
  const session = fencedSession(pool, { runId: admitted.runId, accountId, owner, fence, briefRevision: 1, leaseMs: 30000 });
  const transport = vi.fn(async () => { throw new Error("Synthetic unknown external outcome"); });
  globalThis.fetch = transport;
  try {
    expect(await performModelOperation(pool, config, session, { runId: admitted.runId, accountId, fence, briefRevision: 1, evidenceRevision: 0, operation: "brief", context: { question, task: null, passages: [], sources: [], assertions: [], approvedClaimKeys: [], draft: null } })).toMatchObject({ kind: "result", result: { status: "outcome_unknown" } });
  } finally { session.stop(); }
  await pool.query("UPDATE run_leases SET expires_at=now() WHERE run_id=$1 AND owner=$2 AND fence=$3", [admitted.runId, owner, fence]);
  await cancelRun(pool, admitted.runId);
  await processRun(pool, { ...config, liveRouteEnabled: false, structuredModelEnabled: false, openRouterApiKey: undefined }, admitted.runId);
  expect((await pool.query("SELECT lifecycle FROM runs WHERE id=$1", [admitted.runId])).rows[0].lifecycle).toBe("terminal");
  const intent = (await pool.query("SELECT * FROM provider_intents WHERE run_id=$1", [admitted.runId])).rows[0];
  const expected = { intentId: intent.id, runId: admitted.runId, requestDigest: intent.request_digest, receiptDigest: sha256(JSON.stringify(intent.receipt)), questionDigest: evaluationQuestionDigest(question), reservedMicro: Number(intent.reserved_max_micro), policyId: AZURE_ZDR_MODEL_POLICY.id };
  const grant = AuthorizationSchema.parse({ version: "matched-evaluation-authorization.v1", approvalId: crypto.randomUUID(), approvalReference: "synthetic-no-paid-authority", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), protocolSha256: "0".repeat(64), freezeSha256: "0".repeat(64), taskIds: ["MC-D02"], budgetMicro: 100000, accountId, budgetScope, sourceMode: "frozen_supplied_document", exclusiveDatabaseAcknowledged: true, heldIntentContinuation: { version: "held-intent-continuation.v1", intents: [expected] } });
  const snapshot = async () => ({ intents: (await pool.query("SELECT * FROM provider_intents WHERE run_id=$1", [admitted.runId])).rows, reservations: (await pool.query("SELECT * FROM reservations WHERE run_id=$1", [admitted.runId])).rows, operations: (await pool.query("SELECT * FROM model_operation_results WHERE run_id=$1", [admitted.runId])).rows });
  return { accountId, grant, expected, intent, transport, snapshot, keyScope: sha256(`openrouter:${key}`) };
}
it("W02 admits only exact terminal unknown snapshots and never settles, releases, or resends the hold", async () => {
  const x = await setup(), before = await x.snapshot();
  expect(await preservedHeldExposure(pool, x.grant, x.keyScope)).toEqual({ preservedHeldMicro: x.expected.reservedMicro, preservedUnknownIntents: 1 });
  expect(await preservedHeldExposure(pool, x.grant, x.keyScope)).toEqual({ preservedHeldMicro: x.expected.reservedMicro, preservedUnknownIntents: 1 });
  expect(await preservedHeldExposure(pool, { ...x.grant, heldIntentContinuation: undefined }, x.keyScope)).toEqual({});
  expect(await x.snapshot()).toEqual(before);
  expect(x.transport).toHaveBeenCalledTimes(1);
  expect(before.intents[0]).toMatchObject({ state: "outcome-unknown", confirmed_micro: null, reserved_max_micro: String(x.expected.reservedMicro) });
});
it("W02 rejects altered grant, key, budget and every bound snapshot field without changing financial state", async () => {
  const x = await setup(), before = await x.snapshot();
  for (const patch of [{ intentId: crypto.randomUUID() }, { runId: crypto.randomUUID() }, { requestDigest: "1".repeat(64) }, { receiptDigest: "1".repeat(64) }, { questionDigest: "1".repeat(64) }, { reservedMicro: 1 }, { policyId: "openrouter-openai-mini-text-v1" }]) {
    await expect(preservedHeldExposure(pool, { ...x.grant, heldIntentContinuation: { version: "held-intent-continuation.v1", intents: [{ ...x.expected, ...patch }] } }, x.keyScope)).rejects.toThrow("held_intent_snapshot_mismatch");
  }
  for (const patch of [{ accountId: crypto.randomUUID() }, { budgetScope: "evaluation:wrong" }]) await expect(preservedHeldExposure(pool, { ...x.grant, ...patch }, x.keyScope)).rejects.toThrow("held_intent_snapshot_mismatch");
  await expect(preservedHeldExposure(pool, x.grant, "0".repeat(64))).rejects.toThrow("held_intent_snapshot_mismatch");
  await expect(preservedHeldExposure(pool, { ...x.grant, budgetMicro: x.expected.reservedMicro }, x.keyScope)).rejects.toThrow("held_intent_budget_unavailable");
  await expect(preservedHeldExposure(pool, { ...x.grant, heldIntentContinuation: { version: "held-intent-continuation.v1", intents: [x.expected, x.expected] } }, x.keyScope)).rejects.toThrow("duplicate_held_intent");
  expect(await x.snapshot()).toEqual(before); expect(x.transport).toHaveBeenCalledTimes(1);
});
it("W02 rejects stale revisions, mismatched logical actions, changed receipts, and nonterminal or reconciled rows", async () => {
  const x = await setup(), before = await x.snapshot();
  const mutations = [
    "UPDATE runs SET lifecycle='running' WHERE id=$1",
    "UPDATE runs SET evidence_revision=evidence_revision+1 WHERE id=$1",
    "UPDATE model_operation_results SET brief_revision=brief_revision+1 WHERE run_id=$1",
    "UPDATE model_operation_results SET evidence_revision=evidence_revision+1 WHERE run_id=$1",
    "UPDATE run_actions SET brief_revision=brief_revision+1 WHERE run_id=$1",
    "UPDATE run_actions SET logical_key='unrelated' WHERE run_id=$1",
    "UPDATE run_actions SET kind='assess_support' WHERE run_id=$1",
    "UPDATE run_actions SET request_digest='changed' WHERE run_id=$1",
    "UPDATE provider_intents SET state='confirmed',confirmed_micro=0 WHERE run_id=$1",
    "UPDATE provider_intents SET reserved_max_micro=reserved_max_micro+1 WHERE run_id=$1",
    "UPDATE provider_intents SET receipt=jsonb_set(receipt,'{actualMicro}','0') WHERE run_id=$1",
    "UPDATE model_operation_results SET result=jsonb_set(result,'{status}','\"succeeded\"') WHERE run_id=$1",
  ];
  const db = await pool.connect();
  try { for (const sql of mutations) { await db.query("BEGIN"); try { await db.query(sql, [x.expected.runId]); await expect(preservedHeldExposure(db, x.grant, x.keyScope)).rejects.toThrow("held_intent_snapshot_mismatch"); } finally { await db.query("ROLLBACK"); } } }
  finally { db.release(); }
  expect(await x.snapshot()).toEqual(before); expect(x.transport).toHaveBeenCalledTimes(1);
});

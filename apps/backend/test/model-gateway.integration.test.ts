import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { CreateRunRequestSchema } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { claimLease } from "../src/modules/runs.js";
import { insertSource, insertVersionAndPassage } from "../src/modules/evidence.js";
import { loadConfig } from "../src/platform/config.js";
import { fencedSession, LostWorkerLease } from "../src/worker/fenced-session.js";
import { ensureResearchTask, TASK_MODEL_VERSIONS } from "../src/worker/research-task.js";
import { loadResearchTask } from "../src/modules/research-tasks.js";
import { performModelOperation } from "../src/worker/model-gateway.js";
import { STRUCTURED_CALL_RESERVE_MICRO } from "../src/adapters/model/policy.js";
const originalFetch = globalThis.fetch;
let pool: pg.Pool;
beforeAll(async () => { pool = createPool(process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test"); await migrate(pool); });
afterEach(() => { globalThis.fetch = originalFetch; });
afterAll(async () => { await pool.end(); });
const question = "Compare coral and kelp restoration.";
const span = { start: 0, end: question.length, quote: question };
const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
const brief = { objective: question, objectiveProvenance: span, intendedOutput: "comparison",
  criteria: [{ key: "c1", description: "Compare restoration", field: "restoration", operator: "compare", value: null, unit: null,
    importance: "hard", scope, provenance: span, group: "g1", groupOperator: "all", unresolvedAlternatives: [] }],
  questions: [{ key: "q1", text: question, criterionKeys: ["c1"], importance: "critical", evidenceStandard: "documented outcomes" }],
  assumptions: [], openAmbiguities: [], explicitExclusions: [] };
const context = { question, task: null, passages: [], sources: [], assertions: [], approvedClaimKeys: [], draft: null };
const response = (output: unknown = brief) => new Response(JSON.stringify({ id: "provider-test-id", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000001" }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] }), { status: 200 });
async function runCase(test: (x: { runId: string; accountId: string; fence: number; session: ReturnType<typeof fencedSession>; config: ReturnType<typeof loadConfig> }) => Promise<void>) {
  const accountId = await withTx(pool, async (db) => { const s = await createDevSession(db); await grantConsent(db, s.accountId); return s.accountId; });
  const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question, routeMode: "controlled-research" }));
  const owner = crypto.randomUUID(); const fence = (await claimLease(pool, runId, owner, 30_000))!;
  const session = fencedSession(pool, { runId, accountId, owner, fence, briefRevision: 1, leaseMs: 30_000 });
  const config = loadConfig({ DATABASE_URL: "postgres://localhost/test", LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true",
    OPENROUTER_API_KEY: "nonbillable-test-key", LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_SPEND_CAP_MICRO: "1000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() });
  try { await test({ runId, accountId, fence, session, config }); }
  finally {
    session.stop();
    await withTx(pool, async (db) => {
      for (const table of ["provider_intents", "run_actions", "run_leases", "run_dispatch_outbox", "run_events", "reservations", "passages", "sources"]) {
        if (table === "sources") await db.query("DELETE FROM source_versions WHERE source_id IN (SELECT id FROM sources WHERE run_id=$1)", [runId]);
        await db.query(`DELETE FROM ${table} WHERE run_id=$1`, [runId]);
      }
      await db.query("DELETE FROM runs WHERE id=$1", [runId]);
      for (const table of ["research_briefs", "conversations", "allowance_accounts", "sessions", "consent_records", "tombstones"]) await db.query(`DELETE FROM ${table} WHERE account_id=$1`, [accountId]);
      await db.query("DELETE FROM accounts WHERE id=$1", [accountId]);
    });
  }
}
const operation = (x: { runId: string; accountId: string; fence: number }) => ({ ...x, briefRevision: 1, evidenceRevision: 0, operation: "brief" as const, context });
describe("W05 durable model gateway on real PostgreSQL", () => {
  it("records an issued reservation before network and reuses a stored validated result without another call", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => {
      const issued = await pool.query("SELECT state,reserved_max_micro FROM provider_intents WHERE run_id=$1", [x.runId]);
      expect(issued.rows).toEqual([{ state: "issued", reserved_max_micro: String(STRUCTURED_CALL_RESERVE_MICRO) }]);
      return response();
    }) as typeof fetch;
    const first = await performModelOperation(pool, x.config, x.session, operation(x));
    expect(first).toMatchObject({ kind: "result", reused: false, result: { status: "succeeded", output: brief, receipt: { actualMicro: 1 } } });
    expect(await performModelOperation(pool, x.config, x.session, operation(x))).toMatchObject({ kind: "result", reused: true, result: { status: "succeeded" } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
  it("does not resend an unknown external outcome", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => { throw new Error("lost acknowledgement"); }) as typeof fetch;
    expect(await performModelOperation(pool, x.config, x.session, operation(x))).toMatchObject({ kind: "result", result: { status: "outcome_unknown" } });
    expect(await performModelOperation(pool, x.config, x.session, operation(x))).toMatchObject({ kind: "result", reused: true, result: { status: "outcome_unknown" } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const held = await pool.query("SELECT state,confirmed_micro,reserved_max_micro FROM provider_intents WHERE run_id=$1", [x.runId]);
    expect(held.rows).toEqual([{ state: "outcome-unknown", confirmed_micro: null, reserved_max_micro: String(STRUCTURED_CALL_RESERVE_MICRO) }]);
  }));
  it("invalid question provenance is persisted as invalid_output, never as a usable brief", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response({ ...brief, objectiveProvenance: { ...span, quote: "invented requirement" } })) as typeof fetch;
    expect(await performModelOperation(pool, x.config, x.session, operation(x))).toMatchObject({ kind: "result", result: { status: "invalid_output", reason: "invalid_exact_span" } });
    const row = await pool.query("SELECT result FROM model_operation_results WHERE run_id=$1", [x.runId]);
    expect(row.rows[0].result.output).toBeUndefined();
  }));
  it("revalidates evidence basis and never reuses an older revision's result", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response()) as typeof fetch;
    await performModelOperation(pool, x.config, x.session, operation(x));
    await pool.query("UPDATE runs SET evidence_revision=1 WHERE id=$1", [x.runId]);
    await expect(performModelOperation(pool, x.config, x.session, operation(x))).rejects.toThrow("stale_model_context");
    expect(await performModelOperation(pool, x.config, x.session, { ...operation(x), evidenceRevision: 1 })).toMatchObject({ kind: "result", reused: false });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  }));
  it("rejects other-account evidence before spending", async () => runCase(async (x) => runCase(async (other) => {
    const sourceId = await insertSource(pool, { accountId: other.accountId, runId: other.runId, locator: "https://example.org/evidence", title: "Evidence", publisher: "Test", originCluster: "test" });
    await insertVersionAndPassage(pool, { sourceId, accountId: other.accountId, runId: other.runId, locator: "https://example.org/evidence", text: "Private source", accessLevel: "partial-text" });
    const rows = await pool.query("SELECT id,source_version_id,content_hash,exact_text FROM passages WHERE run_id=$1", [other.runId]); const p = rows.rows[0];
    globalThis.fetch = vi.fn() as typeof fetch;
    await expect(performModelOperation(pool, x.config, x.session, { ...operation(x), context: { ...context, passages: [{ id:p.id,sourceVersionId:p.source_version_id,digest:p.content_hash,text:p.exact_text,accessLevel:"partial-text" }] } })).rejects.toThrow("model_evidence_owner_or_version_mismatch");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect((await pool.query("SELECT id FROM provider_intents WHERE run_id=$1", [x.runId])).rows).toHaveLength(0);
  })));
  it.each(["delete", "takeover"])("incurred cost survives %s but a late model result cannot persist", async (kind) => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => {
      if (kind === "delete") await deleteAccount(pool, x.accountId);
      else { await pool.query("UPDATE run_leases SET expires_at=now()-interval '1 second' WHERE run_id=$1", [x.runId]); await claimLease(pool, x.runId, "replacement", 30_000); }
      return response();
    }) as typeof fetch;
    await expect(performModelOperation(pool, x.config, x.session, operation(x))).rejects.toBeInstanceOf(LostWorkerLease);
    expect((await pool.query("SELECT result FROM model_operation_results WHERE run_id=$1", [x.runId])).rows).toHaveLength(0);
    expect((await pool.query("SELECT confirmed_micro FROM provider_intents WHERE run_id=$1", [x.runId])).rows[0].confirmed_micro).toBe("1");
  }));
  it("requires the current downstream-processor consent before dispatch", async () => runCase(async (x) => {
    await pool.query("UPDATE consent_records SET policy_version='2026-09-16' WHERE account_id=$1", [x.accountId]);
    globalThis.fetch = vi.fn() as typeof fetch;
    await expect(performModelOperation(pool, x.config, x.session, operation(x))).rejects.toThrow("stale_or_unauthorized_attempt");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }));
  it("does not issue two calls when identical model requests race", async () => runCase(async (x) => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let arrived!: () => void;
    const started = new Promise<void>((resolve) => { arrived = resolve; });
    globalThis.fetch = vi.fn(async () => { arrived(); await wait; return response(); }) as typeof fetch;
    const first = performModelOperation(pool, x.config, x.session, operation(x));
    await started;
    const second = await performModelOperation(pool, x.config, x.session, operation(x));
    expect(second).toMatchObject({ kind: "pending" });
    release();
    expect(await first).toMatchObject({ kind: "result", result: { status: "succeeded" } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
  it("deletion removes a completed model result", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response()) as typeof fetch;
    await performModelOperation(pool, x.config, x.session, operation(x));
    await deleteAccount(pool, x.accountId);
    expect((await pool.query("SELECT result FROM model_operation_results WHERE run_id=$1", [x.runId])).rows).toHaveLength(0);
  }));
  it("rejects a corrupted cached receipt instead of inventing a validated result", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response()) as typeof fetch;
    await performModelOperation(pool, x.config, x.session, operation(x));
    await pool.query("UPDATE model_operation_results SET result=jsonb_set(result,'{receipt}','{\"actualMicro\":0}'::jsonb) WHERE run_id=$1", [x.runId]);
    expect(await performModelOperation(pool, x.config, x.session, operation(x))).toMatchObject({ kind: "blocked", reason: "invalid_stored_model_result" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
});


describe("W05 durable versioned research task", () => {
  it("allocates stable server IDs and reuses the task after evidence arrival without model spend", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response()) as typeof fetch;
    const args = { ...x, briefRevision: 1 };
    const first = await ensureResearchTask(pool,x.config,x.session,args);
    expect(first.kind).toBe("task");
    if (first.kind !== "task") throw new Error("task missing");
    expect(first.task.planningStatus).toBe("ready");
    expect(first.task.criterionIds.c1).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.task.questionIds.q1).not.toBe(first.task.criterionIds.c1);
    expect(first.task.specification).toEqual(brief);
    await pool.query("UPDATE runs SET evidence_revision=1 WHERE id=$1", [x.runId]);
    const second = await ensureResearchTask(pool,x.config,x.session,args);
    expect(second).toEqual({ kind:"task",task:first.task,reused:true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect((await pool.query("SELECT * FROM coverage_items WHERE run_id=$1",[x.runId])).rows).toHaveLength(0);
  }));
  it("adopts already recorded valid output after a crash, including after evidence revision changes", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response()) as typeof fetch;
    await performModelOperation(pool,x.config,x.session,operation(x));
    await pool.query("UPDATE runs SET evidence_revision=2 WHERE id=$1",[x.runId]);
    expect(await ensureResearchTask(pool,x.config,x.session,{ ...x,briefRevision:1 })).toMatchObject({ kind:"task",reused:true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
  it("does not promote material ambiguity to a ready task", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response({ ...brief,openAmbiguities:[{question:"Which coastline?",whyMaterial:"Restoration outcomes vary by site"}] })) as typeof fetch;
    expect(await ensureResearchTask(pool,x.config,x.session,{ ...x,briefRevision:1 })).toMatchObject({ kind:"task",task:{ planningStatus:"needs_clarification" } });
  }));
  it("does not create a task from invalid output or resend its failed logical attempt", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response({ ...brief,objectiveProvenance:{ ...span,quote:"fabricated" } })) as typeof fetch;
    for (let n=0;n<2;n++) expect(await ensureResearchTask(pool,x.config,x.session,{ ...x,briefRevision:1 })).toEqual({ kind:"blocked",reason:"task_invalid_output" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect((await pool.query("SELECT id FROM research_tasks WHERE run_id=$1",[x.runId])).rows).toHaveLength(0);
  }));
  it("rejects wrong owner and stale brief revision, without another provider call", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response()) as typeof fetch;
    await ensureResearchTask(pool,x.config,x.session,{ ...x,briefRevision:1 });
    await expect(loadResearchTask(pool,x.runId,crypto.randomUUID(),1,TASK_MODEL_VERSIONS)).rejects.toThrow("stale_research_task");
    await expect(loadResearchTask(pool,x.runId,x.accountId,2,TASK_MODEL_VERSIONS)).rejects.toThrow("stale_research_task");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
  it("rejects corrupted criteria and receipt bindings instead of silently regenerating them", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response()) as typeof fetch;
    const result = await ensureResearchTask(pool,x.config,x.session,{ ...x,briefRevision:1 });
    if (result.kind !== "task") throw new Error("task missing");
    await pool.query("UPDATE research_tasks SET specification=jsonb_set(specification,'{objective}','\"changed\"') WHERE run_id=$1",[x.runId]);
    await expect(ensureResearchTask(pool,x.config,x.session,{ ...x,briefRevision:1 })).rejects.toThrow("invalid_research_task_proposal");
    await pool.query("UPDATE research_tasks SET specification=$2 WHERE run_id=$1",[x.runId,JSON.stringify(brief)]);
    await pool.query("UPDATE provider_intents SET receipt='{}' WHERE id=$1",[result.task.modelIntentId]);
    await expect(ensureResearchTask(pool,x.config,x.session,{ ...x,briefRevision:1 })).rejects.toThrow("invalid_research_task_proposal");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
  it("concurrent preparation converges on one task and one issued provider call", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response()) as typeof fetch;
    const args = { ...x,briefRevision:1 };
    const results = await Promise.all([ensureResearchTask(pool,x.config,x.session,args),ensureResearchTask(pool,x.config,x.session,args)]);
    expect(results.some((r) => r.kind === "task")).toBe(true);
    expect(results.every((r) => r.kind === "task" || r.kind === "pending")).toBe(true);
    const final = await ensureResearchTask(pool,x.config,x.session,args);
    expect(final.kind).toBe("task");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect((await pool.query("SELECT id FROM research_tasks WHERE run_id=$1",[x.runId])).rows).toHaveLength(1);
  }));
  it("allocates distinct task identities for identical questions in separate accounts", async () => runCase(async (x) => runCase(async (other) => {
    globalThis.fetch = vi.fn(async () => response()) as typeof fetch;
    const a = await ensureResearchTask(pool,x.config,x.session,{ ...x,briefRevision:1 });
    const b = await ensureResearchTask(pool,other.config,other.session,{ ...other,briefRevision:1 });
    if (a.kind !== "task" || b.kind !== "task") throw new Error("task missing");
    expect(a.task.id).not.toBe(b.task.id);
    expect(a.task.criterionIds.c1).not.toBe(b.task.criterionIds.c1);
    expect(a.task.modelIntentId).not.toBe(b.task.modelIntentId);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    await expect(loadResearchTask(pool,x.runId,other.accountId,1,TASK_MODEL_VERSIONS)).rejects.toThrow("stale_research_task");
  })));
  it("does not silently use a task after its original question changes", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response()) as typeof fetch;
    await ensureResearchTask(pool,x.config,x.session,{ ...x,briefRevision:1 });
    await pool.query("UPDATE research_briefs SET original_question='Different question', payload=jsonb_set(payload,'{originalQuestion}',to_jsonb('Different question'::text)) WHERE id=(SELECT brief_id FROM runs WHERE id=$1)",[x.runId]);
    await expect(ensureResearchTask(pool,x.config,x.session,{ ...x,briefRevision:1 })).rejects.toThrow("stale_research_task_version");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
  it("purges criteria, questions and original question digests during account deletion", async () => runCase(async (x) => {
    globalThis.fetch = vi.fn(async () => response()) as typeof fetch;
    await ensureResearchTask(pool,x.config,x.session,{ ...x,briefRevision:1 });
    await deleteAccount(pool,x.accountId);
    expect((await pool.query("SELECT * FROM research_tasks WHERE account_id=$1",[x.accountId])).rows).toHaveLength(0);
    await expect(loadResearchTask(pool,x.runId,x.accountId,1,TASK_MODEL_VERSIONS)).rejects.toThrow("stale_research_task");
  }));
});

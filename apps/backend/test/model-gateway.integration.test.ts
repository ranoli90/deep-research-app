import { performPublicSearch } from "../src/worker/public-search.js";
import { processRun } from "../src/worker/executor.js";
import { reportCompletionCovered } from "../src/modules/publication-coverage.js";
import { executeCoverageReview } from "../src/worker/research-coverage.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { CreateRunRequestSchema, type CanonicalReport } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { publishReport,getReportForAccount } from "../src/modules/reports.js";
import { passageSupportsClaim, type StoredClaim } from "@deep/research-core";
import { claimLease,getRun,cancelRun } from "../src/modules/runs.js";
import { insertSource, insertVersionAndPassage } from "../src/modules/evidence.js";
import { loadConfig } from "../src/platform/config.js";
import { fencedSession, LostWorkerLease } from "../src/worker/fenced-session.js";
import { createResearchDraft,writeResearchReport } from "../src/worker/research-writer.js";
import { executeAssertionSupport } from "../src/worker/support-execution.js";
import { extractEvidenceAssertions } from "../src/worker/assertion-extraction.js";
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
      await db.query("DELETE FROM claim_evidence WHERE claim_id IN (SELECT id FROM claims WHERE run_id=$1)",[runId]);
      for(const table of ["notification_fanout","completion_outbox","publication_attempts","reports"]) await db.query(`DELETE FROM ${table} WHERE run_id=$1`,[runId]);
      for (const table of ["provider_intents", "claim_revisions", "claims", "run_actions", "run_leases", "run_dispatch_outbox", "run_events", "reservations", "passages", "sources"]) {
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


async function extractionCase(x: Parameters<Parameters<typeof runCase>[0]>[0]) {
  globalThis.fetch = vi.fn(async () => response()) as typeof fetch;
  const task = await ensureResearchTask(pool,x.config,x.session,{ ...x,briefRevision:1 });
  if (task.kind !== "task") throw new Error("task missing");
  const entity = `Reef-${crypto.randomUUID().slice(0,8)}`;
  const text = `${entity} restored 12 hectares in 2024. Monitoring did not measure long-term survival.`;
  const sourceId = await insertSource(pool,{ accountId:x.accountId,runId:x.runId,locator:"https://example.org/study",title:"Restoration observations",publisher:"Test",originCluster:"study" });
  const p = await insertVersionAndPassage(pool,{ sourceId,accountId:x.accountId,runId:x.runId,locator:"https://example.org/study",text,accessLevel:"partial-text" });
  const quote = { passageId:p.passageId,start:0,end:text.indexOf(".")+1,quote:text.slice(0,text.indexOf(".")+1) };
  const output = { candidates:[{key:"new_entity",label:entity,evidence:[quote]}],
    assertions:[{key:"area",candidateKey:"new_entity",criterionKeys:["c1"],text:quote.quote,scope:{...scope,entity,time:"2024"},
      quantities:[{value:"12",unit:"hectares",currency:null,billingPeriod:null,qualifier:null}],evidence:[quote]}],
    limitations:["Long-term survival was not measured."] };
  return { args:{ ...x,briefRevision:1,taskId:task.task.id,passageIds:[p.passageId] },output,p,text,sourceId };
}
describe("W05 evidence-bound arbitrary assertion extraction", () => {
  it("executes general extraction, records selected version/digest/access and reuses the exact result", async () => runCase(async (x) => {
    const prepared = await extractionCase(x);
    globalThis.fetch = vi.fn(async () => response(prepared.output)) as typeof fetch;
    const result = await extractEvidenceAssertions(pool,x.config,x.session,prepared.args);
    expect(result).toMatchObject({ kind:"extraction",reused:false,output:prepared.output });
    expect(await extractEvidenceAssertions(pool,x.config,x.session,prepared.args)).toMatchObject({ kind:"extraction",reused:true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const row = (await pool.query("SELECT input_manifest FROM model_operation_results WHERE run_id=$1 AND operation='extract_assertions'",[x.runId])).rows[0];
    expect(row.input_manifest.passages).toEqual([{id:prepared.p.passageId,sourceVersionId:prepared.p.versionId,digest:expect.stringMatching(/^[a-f0-9]{64}$/),accessLevel:"partial-text"}]);
    expect(JSON.stringify(row.input_manifest)).not.toContain(prepared.text);
    expect((await pool.query("SELECT * FROM support_assessments WHERE run_id=$1",[x.runId])).rows).toHaveLength(0);
  }));
  it("retains all selected passages even when output has no assertions", async () => runCase(async (x) => {
    const prepared = await extractionCase(x);
    const second = await insertVersionAndPassage(pool,{sourceId:prepared.sourceId,accountId:x.accountId,runId:x.runId,locator:"https://example.org/study",text:"No further field observations were available.",accessLevel:"partial-text"});
    prepared.args.passageIds.push(second.passageId);
    globalThis.fetch = vi.fn(async () => response({candidates:[],assertions:[],limitations:["No relevant assertion found"]})) as typeof fetch;
    expect(await extractEvidenceAssertions(pool,x.config,x.session,prepared.args)).toMatchObject({kind:"extraction",output:{assertions:[]}});
    const row = (await pool.query("SELECT input_manifest FROM model_operation_results WHERE run_id=$1 AND operation='extract_assertions'",[x.runId])).rows[0];
    expect(row.input_manifest.passages).toHaveLength(2);
    expect(await extractEvidenceAssertions(pool,x.config,x.session,{...prepared.args,passageIds:[...prepared.args.passageIds].reverse()})).toMatchObject({kind:"extraction",reused:true});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
  it("rejects an invented evidence binding instead of creating assertions", async () => runCase(async (x) => {
    const prepared = await extractionCase(x);
    prepared.output.assertions[0]!.evidence[0]!.passageId=crypto.randomUUID();
    globalThis.fetch = vi.fn(async () => response(prepared.output)) as typeof fetch;
    expect(await extractEvidenceAssertions(pool,x.config,x.session,prepared.args)).toEqual({kind:"blocked",reason:"extraction_invalid_output"});
  }));
  it("rejects wrong-task, missing passage and duplicate selection before dispatch", async () => runCase(async (x) => {
    const prepared = await extractionCase(x);
    globalThis.fetch = vi.fn() as typeof fetch;
    await expect(extractEvidenceAssertions(pool,x.config,x.session,{...prepared.args,taskId:crypto.randomUUID()})).rejects.toThrow("extraction_task_mismatch");
    await expect(extractEvidenceAssertions(pool,x.config,x.session,{...prepared.args,passageIds:[crypto.randomUUID()]})).rejects.toThrow("extraction_evidence_owner_mismatch");
    expect(await extractEvidenceAssertions(pool,x.config,x.session,{...prepared.args,passageIds:[...prepared.args.passageIds,...prepared.args.passageIds]})).toEqual({kind:"blocked",reason:"invalid_extraction_selection"});
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }));
  it("rejects another account's actual passage before any extraction request", async () => runCase(async (x) => runCase(async (other) => {
    const owned = await extractionCase(x);
    const foreign = await extractionCase(other);
    globalThis.fetch = vi.fn() as typeof fetch;
    await expect(extractEvidenceAssertions(pool,x.config,x.session,{...owned.args,passageIds:foreign.args.passageIds})).rejects.toThrow("extraction_evidence_owner_mismatch");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  })));
  it("does not silently prefix-truncate an oversized passage", async () => runCase(async (x) => {
    const prepared = await extractionCase(x);
    await pool.query("UPDATE passages SET exact_text=repeat('x',24001) WHERE id=$1",[prepared.p.passageId]);
    globalThis.fetch = vi.fn() as typeof fetch;
    expect(await extractEvidenceAssertions(pool,x.config,x.session,prepared.args)).toEqual({kind:"blocked",reason:"extraction_context_unavailable"});
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }));
  it("rejects stale source digests and corrupted input manifests", async () => runCase(async (x) => {
    const prepared = await extractionCase(x);
    globalThis.fetch = vi.fn(async () => response(prepared.output)) as typeof fetch;
    await extractEvidenceAssertions(pool,x.config,x.session,prepared.args);
    await pool.query("UPDATE model_operation_results SET input_manifest='{}' WHERE run_id=$1 AND operation='extract_assertions'",[x.runId]);
    expect(await extractEvidenceAssertions(pool,x.config,x.session,prepared.args)).toEqual({kind:"blocked",reason:"invalid_stored_model_result"});
    await pool.query("UPDATE passages SET exact_text='Different source text' WHERE id=$1",[prepared.p.passageId]);
    await expect(extractEvidenceAssertions(pool,x.config,x.session,prepared.args)).rejects.toThrow("model_evidence_digest_mismatch");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
  it("discards late extraction after evidence changes but retains actual cost", async () => runCase(async (x) => {
    const prepared = await extractionCase(x);
    globalThis.fetch = vi.fn(async () => {await pool.query("UPDATE runs SET evidence_revision=evidence_revision+1 WHERE id=$1",[x.runId]);return response(prepared.output);}) as typeof fetch;
    await expect(extractEvidenceAssertions(pool,x.config,x.session,prepared.args)).rejects.toThrow("stale_model_context");
    expect((await pool.query("SELECT result FROM model_operation_results WHERE run_id=$1 AND operation='extract_assertions'",[x.runId])).rows).toHaveLength(0);
    expect((await pool.query("SELECT confirmed_micro FROM provider_intents WHERE run_id=$1 AND route LIKE '%:extract_assertions'",[x.runId])).rows[0].confirmed_micro).toBe("1");
  }));
});


async function supportCase(x: Parameters<Parameters<typeof runCase>[0]>[0],wrongUnit=false,paraphrase=false) {
  const prepared=await extractionCase(x);
  if (paraphrase) prepared.output.assertions[0]!.text=prepared.output.assertions[0]!.text.replace(/^(.+) restored 12 hectares in 2024\.$/,"In 2024, $1 restored an area of 12 hectares.");
  if (wrongUnit) prepared.output.assertions[0]!.text=prepared.output.assertions[0]!.text.replace("hectares","acres");
  globalThis.fetch=vi.fn(async()=>response(prepared.output)) as typeof fetch;
  const extraction=await extractEvidenceAssertions(pool,x.config,x.session,prepared.args);
  if(extraction.kind!=="extraction") throw new Error("missing extraction");
  const claim=prepared.output.assertions[0]!;
  const proposal={assessments:[{claimKey:claim.key,status:"supported",scope:claim.scope,evidence:claim.evidence,
    rationale:"The reported area and year match the scoped assertion; survival remains unmeasured.",missingEvidence:[] as string[]}]};
  return {...prepared,proposal,args:{...prepared.args,extractionIntentId:extraction.intentId}};
}
describe("W05 substantive support execution and persisted revisions",()=>{
  it("performs and stores scoped checks with stable claim revisions on replay",async()=>runCase(async(x)=>{
    const prepared=await supportCase(x);
    globalThis.fetch=vi.fn(async()=>response(prepared.proposal)) as typeof fetch;
    const first=await executeAssertionSupport(pool,x.config,x.session,prepared.args);
    expect(first).toMatchObject({kind:"support",reused:false,checks:[{claimKey:"area",decision:"supported",modelStatus:"supported"}]});
    const second=await executeAssertionSupport(pool,x.config,x.session,prepared.args);
    expect(second).toEqual({...first,reused:true});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const rows=await pool.query("SELECT claim_revision_id,evidence_digest,scope_digest,checker_version,result FROM scoped_support_results WHERE run_id=$1",[x.runId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({evidence_digest:expect.stringMatching(/^[a-f0-9]{64}$/),scope_digest:expect.stringMatching(/^[a-f0-9]{64}$/),checker_version:"scoped-support.v3"});
    expect(rows.rows[0].result.checks.length).toBeGreaterThan(5);
    expect((await pool.query("SELECT support_status FROM claims WHERE run_id=$1",[x.runId])).rows).toEqual([{support_status:"unverified"}]);
    expect((await pool.query("SELECT id FROM reports WHERE run_id=$1",[x.runId])).rows).toHaveLength(0);
  }));
  it("persists a deterministic veto when the model approves changed units",async()=>runCase(async(x)=>{
    const prepared=await supportCase(x,true);
    globalThis.fetch=vi.fn(async()=>response(prepared.proposal)) as typeof fetch;
    const result=await executeAssertionSupport(pool,x.config,x.session,prepared.args);
    expect(result).toMatchObject({kind:"support",checks:[{decision:"insufficient",modelStatus:"supported"}]});
    const row=(await pool.query("SELECT decision,result FROM scoped_support_results WHERE run_id=$1",[x.runId])).rows[0];
    expect(row.decision).toBe("insufficient");
    expect(row.result.checks).toContainEqual({rule:"numeric_context_preserved",passed:false});
  }));
  it("records uncertainty instead of turning missing evidence into full support",async()=>runCase(async(x)=>{
    const prepared=await supportCase(x);
    globalThis.fetch=vi.fn(async()=>response({assessments:[{...prepared.proposal.assessments[0],missingEvidence:["Independent outcome replication unavailable"]}]})) as typeof fetch;
    expect(await executeAssertionSupport(pool,x.config,x.session,prepared.args)).toMatchObject({kind:"support",checks:[{decision:"partially_supported"}]});
  }));
  it("rejects missing bindings without a support record",async()=>runCase(async(x)=>{
    const prepared=await supportCase(x);
    globalThis.fetch=vi.fn(async()=>response({assessments:[]})) as typeof fetch;
    expect(await executeAssertionSupport(pool,x.config,x.session,prepared.args)).toEqual({kind:"blocked",reason:"support_invalid_output"});
    expect((await pool.query("SELECT * FROM scoped_support_results WHERE run_id=$1",[x.runId])).rows).toHaveLength(0);
  }));
  it("denies a foreign extraction result before spending",async()=>runCase(async(x)=>runCase(async(other)=>{
    const prepared=await supportCase(other);
    globalThis.fetch=vi.fn() as typeof fetch;
    await expect(executeAssertionSupport(pool,x.config,x.session,{...prepared.args,...x,briefRevision:1})).rejects.toThrow("support_extraction_owner_or_version_mismatch");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  })));
  it("rejects changed evidence basis instead of checking old assertions as current",async()=>runCase(async(x)=>{
    const prepared=await supportCase(x);
    await pool.query("UPDATE runs SET evidence_revision=1 WHERE id=$1",[x.runId]);
    globalThis.fetch=vi.fn() as typeof fetch;
    await expect(executeAssertionSupport(pool,x.config,x.session,prepared.args)).rejects.toThrow("support_extraction_basis_changed");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }));
  it("does not reuse corrupted claim revisions or support receipts",async()=>runCase(async(x)=>{
    const prepared=await supportCase(x);
    globalThis.fetch=vi.fn(async()=>response(prepared.proposal)) as typeof fetch;
    await executeAssertionSupport(pool,x.config,x.session,prepared.args);
    await pool.query("UPDATE scoped_support_results SET decision='supported',result='{}' WHERE run_id=$1",[x.runId]);
    await expect(executeAssertionSupport(pool,x.config,x.session,prepared.args)).rejects.toThrow("stored_support_result_mismatch");
    await pool.query("UPDATE claim_revisions SET text='Changed claim' WHERE run_id=$1",[x.runId]);
    await expect(executeAssertionSupport(pool,x.config,x.session,prepared.args)).rejects.toThrow("stored_assertion_revision_mismatch");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
  it("purges scoped assertions and support results on deletion",async()=>runCase(async(x)=>{
    const prepared=await supportCase(x);
    globalThis.fetch=vi.fn(async()=>response(prepared.proposal)) as typeof fetch;
    await executeAssertionSupport(pool,x.config,x.session,prepared.args);
    await deleteAccount(pool,x.accountId);
    for(const table of ["extracted_assertions","scoped_support_results","claim_revisions"])
      expect((await pool.query(`SELECT * FROM ${table} WHERE account_id=$1`,[x.accountId])).rows).toHaveLength(0);
  }));
});


async function scopedReportCase(x:Parameters<Parameters<typeof runCase>[0]>[0],partial=false,paraphrase=true) {
  const prepared=await supportCase(x,false,paraphrase);
  if(partial) prepared.proposal.assessments[0]!.missingEvidence.push("Applicability is unresolved");
  globalThis.fetch=vi.fn(async()=>response(prepared.proposal)) as typeof fetch;
  const checked=await executeAssertionSupport(pool,x.config,x.session,prepared.args);
  if(checked.kind!=="support") throw new Error("support missing");
  const claim=checked.checks[0]!;
  const run=(await getRun(pool,x.runId))!;
  const basis={briefRevision:1,evidenceRevision:run.evidence_revision,consentEpoch:run.consent_epoch,cancellationEpoch:0,workerLeaseFence:x.fence};
  const report:CanonicalReport={reportId:crypto.randomUUID(),runId:x.runId,version:1,basis,outcome:"completed_with_limitations",blocks:[{
    id:"answer",kind:"text",text:prepared.output.assertions[0]!.text,claimIds:[claim.claimId],citationIds:[prepared.p.passageId]}],
    claimIds:[claim.claimId],limitations:[],sourceAccessSummary:[],routeMode:"controlled-research"};
  return {prepared,checked,claim,report,publication:{report,accountId:x.accountId,loaded:basis,deleted:false,
    claims:[{id:claim.claimId,text:report.blocks[0]!.text,type:"external-fact",supportStatus:"direct",passageIds:[prepared.p.passageId]}] as StoredClaim[],
    passages:[{id:prepared.p.passageId,sourceId:prepared.sourceId,sourceVersionId:prepared.p.versionId,exactText:prepared.text,locator:"document"}]}};
}
describe("W01/W05 scoped support at the real publication gate",()=>{
  it("publishes a checked paraphrase and preserves canonical assertion identity on reopen",async()=>runCase(async(x)=>{
    const c=await scopedReportCase(x);
    expect(passageSupportsClaim(c.prepared.text,c.report.blocks[0]!.text)).not.toBe("supports");
    expect(await publishReport(pool,c.publication)).toMatchObject({accepted:true,reportId:c.report.reportId});
    const reopened=await getReportForAccount(pool,c.report.reportId,x.accountId);
    expect(reopened.claim_ids).toEqual([c.claim.claimId]);
    expect((await pool.query("SELECT support_status FROM claims WHERE id=$1",[c.claim.claimId])).rows[0].support_status).toBe("direct");
    expect(reopened.blocks[0].claimIds).toEqual([c.claim.claimId]);
    expect((await pool.query("SELECT id FROM claims WHERE run_id=$1",[x.runId])).rows).toHaveLength(1);
    expect((await pool.query("SELECT claim_revision_id FROM scoped_support_results WHERE run_id=$1",[x.runId])).rows[0].claim_revision_id).toBe(c.claim.claimRevisionId);
    expect(await getReportForAccount(pool,c.report.reportId,crypto.randomUUID())).toBeNull();
  }));
  it("does not fall back to literal support when a managed assertion is partial",async()=>runCase(async(x)=>{
    const c=await scopedReportCase(x,true,false);
    expect(passageSupportsClaim(c.prepared.text,c.report.blocks[0]!.text)).toBe("supports");
    expect((await publishReport(pool,c.publication)).accepted).toBe(false);
    // A deterministic metadata derivation cannot launder this rejected managed identity.
    const text="Recorded 1 source(s) in 1 origin cluster(s). Repeated syndication is not counted as independent confirmation.";
    c.publication.claims[0]={...c.publication.claims[0]!,text,type:"calculation",derivation:"source-counts",passageIds:[]};
    c.report.blocks[0]!.text=text;c.report.blocks[0]!.citationIds=[];
    expect((await publishReport(pool,c.publication)).accepted).toBe(false);
  }));
  it("rejects stale support even if the caller updates the report's revision",async()=>runCase(async(x)=>{
    const c=await scopedReportCase(x);
    await pool.query("UPDATE runs SET evidence_revision=1 WHERE id=$1",[x.runId]);
    c.report.basis.evidenceRevision=1;
    expect((await publishReport(pool,c.publication)).accepted).toBe(false);
  }));
  it("rejects altered assertion text and unmapped extra prose",async()=>runCase(async(x)=>{
    const c=await scopedReportCase(x);
    c.report.blocks[0]!.text+=" Survival was guaranteed.";
    expect((await publishReport(pool,c.publication)).accepted).toBe(false);
    c.publication.claims[0]!.text=c.report.blocks[0]!.text;
    expect((await publishReport(pool,c.publication)).accepted).toBe(false);
  }));
  it("rejects a missing stored check despite a caller-supplied approval object",async()=>runCase(async(x)=>{
    const c=await scopedReportCase(x);
    await pool.query("DELETE FROM scoped_support_results WHERE run_id=$1",[x.runId]);
    const forged={...c.publication,scopedApprovals:new Map([[c.claim.claimId,{claimId:c.claim.claimId,text:c.report.blocks[0]!.text,passageIds:[c.prepared.p.passageId]}]])};
    expect((await publishReport(pool,forged)).accepted).toBe(false);
    expect((await pool.query("SELECT id FROM reports WHERE run_id=$1",[x.runId])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM claim_revisions WHERE run_id=$1",[x.runId])).rows).toHaveLength(1);
  }));
  it("refuses corrupted persisted checks instead of trusting an approval flag",async()=>runCase(async(x)=>{
    const c=await scopedReportCase(x);
    await pool.query("UPDATE scoped_support_results SET result='{}' WHERE run_id=$1",[x.runId]);
    await expect(publishReport(pool,c.publication)).rejects.toThrow("stored_support_result_mismatch");
    expect((await pool.query("SELECT id FROM reports WHERE run_id=$1",[x.runId])).rows).toHaveLength(0);
  }));
});


async function writerCase(x:Parameters<Parameters<typeof runCase>[0]>[0]) {
  const prepared=await supportCase(x);
  globalThis.fetch=vi.fn(async()=>response(prepared.proposal)) as typeof fetch;
  const support=await executeAssertionSupport(pool,x.config,x.session,prepared.args);
  if(support.kind!=="support")throw new Error("missing source support");
  const text=prepared.output.assertions[0]!.text.replace(/^(.+) restored 12 hectares in 2024\.$/,"In 2024, $1 restored an area of 12 hectares.");
  const draft={title:"Restoration findings",sections:[{heading:"Evidence",paragraphs:[{text,claimKeys:["area"]}]}],unresolvedQuestionKeys:["q1"],limitations:[] as string[]};
  return {...prepared,draft,sourceSupport:support,args:{...prepared.args,sourceSupportIntentId:support.intentId}};
}
function optimisticWriterTransport(draft:unknown,complete=false) {
  return vi.fn(async (_input:unknown,init?:RequestInit)=>{
    const request=JSON.parse(String(init?.body));
    if(request.response_format.json_schema.name==="research_write_report_v1")return response(draft);
    if(request.response_format.json_schema.name==="research_review_coverage_v1") {
      const context=JSON.parse(request.messages[1].content);
      return response({questions:context.task.questions.map((q:{key:string})=>({questionKey:q.key,status:complete?"supported":"unresolved_at_limit",
        assertionKeys:context.approvedClaimKeys,reason:"Fabricated coverage judgment for boundary control"})),omittedRequirements:[]});
    }
    if(request.response_format.json_schema.name!=="research_assess_support_v1")throw new Error("unexpected operation");
    const context=JSON.parse(request.messages[1].content);
    return response({assessments:context.assertions.map((a:{key:string;scope:unknown;evidence:unknown})=>({claimKey:a.key,status:"supported",scope:a.scope,evidence:a.evidence,
      rationale:"Optimistic test response; independent guards must still reject invalid text.",missingEvidence:[]}))});
  }) as typeof fetch;
}
describe("W05 generic writer, exact final wording and canonical publication",()=>{
  it("writes changed prose, checks it separately, publishes and reopens its premise lineage",async()=>runCase(async(x)=>{
    const c=await writerCase(x);
    globalThis.fetch=optimisticWriterTransport(c.draft);
    const result=await writeResearchReport(pool,x.config,x.session,c.args);
    expect(result).toMatchObject({kind:"publication",accepted:true,unresolvedStatements:[]});
    if(result.kind!=="publication"||!result.reportId)throw new Error("missing report");
    const report=await getReportForAccount(pool,result.reportId,x.accountId);
    expect(report.blocks[1].text).toBe(c.draft.sections[0]!.paragraphs[0]!.text);
    expect(report.blocks[1].text).not.toBe(c.output.assertions[0]!.text);
    expect(report.outcome).toBe("completed_with_limitations");
    expect(report.source_access_summary).toMatchObject([{accessLevel:"partial-text"}]);
    const revision=(await pool.query("SELECT r.scope,c.type,c.support_status FROM claim_revisions r JOIN claims c ON c.id=r.claim_id WHERE c.id=$1",[report.claim_ids[0]])).rows[0];
    expect(revision.scope.premiseClaimRevisionIds).toEqual([c.sourceSupport.checks[0]!.claimRevisionId]);
    expect(revision.scope.dependencyCompleteness).toBe("partial");
    expect(revision).toMatchObject({type:"inference",support_status:"inference"});
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  }));
  it("keeps supported synthesis while blocking a made-up heading, paragraph and limitation",async()=>runCase(async(x)=>{
    const c=await writerCase(x);
    c.draft.sections[0]!.heading="Restoration improved by 999 percent";
    c.draft.sections[0]!.paragraphs.push({text:"Restoration lasted 999 years.",claimKeys:["area"]});
    c.draft.limitations.push("The work cost 999 USD.");
    globalThis.fetch=optimisticWriterTransport(c.draft);
    const result=await writeResearchReport(pool,x.config,x.session,c.args);
    expect(result).toMatchObject({kind:"publication",accepted:true,unresolvedStatements:["heading_0","paragraph_0_1","limitation_0"]});
    if(result.kind!=="publication"||!result.reportId)throw new Error("missing report");
    const report=await getReportForAccount(pool,result.reportId,x.accountId);
    expect(JSON.stringify(report.blocks)).not.toContain("999");
    expect(report.blocks.filter((b:{kind:string})=>b.kind==="caveat")).toHaveLength(3);
    expect(report.blocks[1].text).toBe(c.draft.sections[0]!.paragraphs[0]!.text);
  }));
  it("reuses a durable draft after restart without another writer request",async()=>runCase(async(x)=>{
    const c=await writerCase(x);
    globalThis.fetch=optimisticWriterTransport(c.draft);
    const first=await createResearchDraft(pool,x.config,x.session,c.args);
    const second=await createResearchDraft(pool,x.config,x.session,c.args);
    expect(first.kind).toBe("draft");expect(second).toEqual({...first,reused:true});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect((await pool.query("SELECT * FROM research_drafts WHERE run_id=$1",[x.runId])).rows).toHaveLength(1);
  }));
  it("rejects invented premise keys and publishes no report",async()=>runCase(async(x)=>{
    const c=await writerCase(x);c.draft.sections[0]!.paragraphs[0]!.claimKeys=["invented"];
    globalThis.fetch=optimisticWriterTransport(c.draft);
    expect(await writeResearchReport(pool,x.config,x.session,c.args)).toEqual({kind:"blocked",reason:"writer_invalid_output"});
    expect((await pool.query("SELECT * FROM research_drafts WHERE run_id=$1",[x.runId])).rows).toHaveLength(0);
  }));
  it("blocks an oversized final assertion set without truncation or a second paid attempt",async()=>runCase(async(x)=>{
    const c=await writerCase(x);
    c.draft.sections=Array.from({length:6},()=>({heading:"Evidence",paragraphs:Array.from({length:12},()=>({...c.draft.sections[0]!.paragraphs[0]!}))}));
    globalThis.fetch=optimisticWriterTransport(c.draft);
    for(let n=0;n<2;n++) expect(await createResearchDraft(pool,x.config,x.session,c.args)).toEqual({kind:"blocked",reason:"writer_draft_expansion_invalid"});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect((await pool.query("SELECT * FROM research_drafts WHERE run_id=$1",[x.runId])).rows).toHaveLength(0);
  }));
  it("rejects draft self-reference before dispatch",async()=>runCase(async(x)=>{
    const c=await writerCase(x);globalThis.fetch=optimisticWriterTransport(c.draft);
    const draft=await createResearchDraft(pool,x.config,x.session,c.args);
    if(draft.kind!=="draft")throw new Error("missing draft");
    await pool.query("UPDATE research_drafts SET source_extraction_intent_id=writer_intent_id WHERE writer_intent_id=$1",[draft.writerIntentId]);
    globalThis.fetch=vi.fn() as typeof fetch;
    await expect(executeAssertionSupport(pool,x.config,x.session,{...c.args,extractionIntentId:draft.writerIntentId})).rejects.toThrow("writer_source_must_be_extraction");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }));
  it("purges drafts and composed claim text on account deletion",async()=>runCase(async(x)=>{
    const c=await writerCase(x);globalThis.fetch=optimisticWriterTransport(c.draft);
    await writeResearchReport(pool,x.config,x.session,c.args);
    await deleteAccount(pool,x.accountId);
    for(const table of ["research_drafts","model_operation_results","scoped_support_results","claim_revisions"])
      expect((await pool.query(`SELECT * FROM ${table} WHERE account_id=$1`,[x.accountId])).rows).toHaveLength(0);
    expect((await pool.query("SELECT text FROM claims WHERE account_id=$1",[x.accountId])).rows.every((r)=>r.text==="[deleted]")).toBe(true);
  }));
  it("adds a new checker result without overwriting an older version or paying again",async()=>runCase(async(x)=>{
    const c=await supportCase(x);globalThis.fetch=vi.fn(async()=>response(c.proposal)) as typeof fetch;
    const first=await executeAssertionSupport(pool,x.config,x.session,c.args);
    await pool.query("UPDATE scoped_support_results SET checker_version='scoped-support.v1' WHERE run_id=$1",[x.runId]);
    const second=await executeAssertionSupport(pool,x.config,x.session,c.args);
    expect(second).toEqual({...first,reused:true});
    expect((await pool.query("SELECT checker_version FROM scoped_support_results WHERE run_id=$1 ORDER BY checker_version",[x.runId])).rows).toEqual([{checker_version:"scoped-support.v1"},{checker_version:"scoped-support.v3"}]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
});

async function coverageCase(x:Parameters<Parameters<typeof runCase>[0]>[0],wrongUnit=false) {
  const c=await supportCase(x,wrongUnit);globalThis.fetch=vi.fn(async()=>response(c.proposal)) as typeof fetch;
  const support=await executeAssertionSupport(pool,x.config,x.session,c.args);
  if(support.kind!=="support")throw new Error("missing support");
  const proposal={questions:[{questionKey:"q1",status:"supported",assertionKeys:["area"],reason:"Fabricated coverage judgment for boundary testing"}],omittedRequirements:[]};
  return {...c,coverageProposal:proposal,args:{...c.args,supportIntentId:support.intentId}};
}
describe("W05 durable criterion coverage review",()=>{
  it("executes review once, stores exact claim revisions and revalidates replay",async()=>runCase(async(x)=>{
    const c=await coverageCase(x);globalThis.fetch=vi.fn(async()=>response(c.coverageProposal)) as typeof fetch;
    const first=await executeCoverageReview(pool,x.config,x.session,c.args);
    expect(first.kind).toBe("coverage");if(first.kind!=="coverage")throw new Error("missing review");
    expect(first.coverage.complete).toBe(true);
    const second=await executeCoverageReview(pool,x.config,x.session,c.args);
    expect(second).toMatchObject({kind:"coverage",reused:true,intentId:first.intentId});expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const row=(await pool.query("SELECT * FROM research_coverage WHERE run_id=$1",[x.runId])).rows[0];
    expect(row.claim_revision_ids).toHaveLength(1);expect(row.result).toEqual(first.coverage);
    await pool.query("UPDATE research_coverage SET result='{}' WHERE run_id=$1",[x.runId]);
    await expect(executeCoverageReview(pool,x.config,x.session,c.args)).rejects.toThrow("stored_coverage_mismatch");expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
  it("vetoes supported coverage when named assertions failed substantive checks",async()=>runCase(async(x)=>{
    const c=await coverageCase(x,true);globalThis.fetch=vi.fn(async()=>response(c.coverageProposal)) as typeof fetch;
    const result=await executeCoverageReview(pool,x.config,x.session,c.args);
    expect(result).toMatchObject({kind:"coverage",coverage:{complete:false,unresolvedCriterionKeys:["c1"]}});
    if(result.kind!=="coverage")throw new Error("missing review");expect(result.coverage.questions[0]!.failedChecks).toContain("assertion_not_supported");
  }));
  it("rejects missing question reviews without recording coverage",async()=>runCase(async(x)=>{
    const c=await coverageCase(x);globalThis.fetch=vi.fn(async()=>response({questions:[],omittedRequirements:[]})) as typeof fetch;
    expect(await executeCoverageReview(pool,x.config,x.session,c.args)).toMatchObject({kind:"blocked",reason:"coverage_invalid_output"});
    expect((await pool.query("SELECT * FROM research_coverage WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
  }));
  it("rejects changed evidence before saving coverage while retaining cost",async()=>runCase(async(x)=>{
    const c=await coverageCase(x);globalThis.fetch=vi.fn(async()=>{await pool.query("UPDATE runs SET evidence_revision=evidence_revision+1 WHERE id=$1",[x.runId]);return response(c.coverageProposal);}) as typeof fetch;
    await expect(executeCoverageReview(pool,x.config,x.session,c.args)).rejects.toThrow("stale_model_context");
    expect((await pool.query("SELECT * FROM research_coverage WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
    expect((await pool.query("SELECT confirmed_micro FROM provider_intents WHERE run_id=$1 AND route LIKE '%:review_coverage'",[x.runId])).rows[0].confirmed_micro).toBe("1");
  }));
  it("purges saved coverage on account deletion",async()=>runCase(async(x)=>{
    const c=await coverageCase(x);globalThis.fetch=vi.fn(async()=>response(c.coverageProposal)) as typeof fetch;
    expect((await executeCoverageReview(pool,x.config,x.session,c.args)).kind).toBe("coverage");
    await withTx(pool,(db)=>deleteAccount(db,x.accountId));
    expect((await pool.query("SELECT * FROM research_coverage WHERE account_id=$1",[x.accountId])).rowCount).toBe(0);
  }));
});


describe("W05 report completion requires exact final coverage",()=>{
 it("completes and reopens a report only after final assertion coverage executes",async()=>runCase(async(x)=>{
  const c=await writerCase(x);globalThis.fetch=optimisticWriterTransport(c.draft,true);
  const result=await writeResearchReport(pool,x.config,x.session,c.args);
  expect(result).toMatchObject({kind:"publication",accepted:true});
  if(result.kind!=="publication"||!result.reportId)throw new Error("missing report");
  const report=await getReportForAccount(pool,result.reportId,x.accountId);
  expect(report.outcome).toBe("completed");expect(report.limitations).toEqual([]);
  expect((await pool.query("SELECT result FROM research_coverage WHERE model_intent_id=$1",[result.coverageIntentId])).rows[0].result.complete).toBe(true);
  expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  const canonical:CanonicalReport={reportId:report.id,runId:x.runId,version:report.version,outcome:report.outcome,basis:report.basis,
    blocks:report.blocks,claimIds:report.claim_ids,limitations:report.limitations,sourceAccessSummary:report.source_access_summary,routeMode:"controlled-research"};
  expect(await reportCompletionCovered(pool,x.accountId,canonical)).toBe(true);
  expect(await reportCompletionCovered(pool,x.accountId,{...canonical,blocks:canonical.blocks.slice(0,1)})).toBe(false);
  expect(await reportCompletionCovered(pool,x.accountId,{...canonical,claimIds:[]})).toBe(false);
  await pool.query("UPDATE research_coverage SET result='{}' WHERE run_id=$1",[x.runId]);
  await expect(reportCompletionCovered(pool,x.accountId,canonical)).rejects.toThrow("stored_coverage_mismatch");
  await pool.query("DELETE FROM research_coverage WHERE run_id=$1",[x.runId]);
  expect(await reportCompletionCovered(pool,x.accountId,canonical)).toBe(false);
 }));
 it("does not publish when the required review returns invalid output",async()=>runCase(async(x)=>{
  const c=await writerCase(x);const normal=optimisticWriterTransport(c.draft);
  globalThis.fetch=vi.fn(async(input,init)=>JSON.parse(String(init?.body)).response_format.json_schema.name==="research_review_coverage_v1"?response({questions:[],omittedRequirements:[]}):normal(input,init)) as typeof fetch;
  expect(await writeResearchReport(pool,x.config,x.session,c.args)).toMatchObject({kind:"blocked",reason:"coverage_invalid_output"});
  expect((await pool.query("SELECT id FROM reports WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
 }));
});
it("W05 publication rejects a forged complete outcome without a review while preserving limited publication",async()=>runCase(async(x)=>{
 const c=await scopedReportCase(x);
 expect(await publishReport(pool,{...c.publication,report:{...c.report,outcome:"completed"}})).toEqual({accepted:false,reason:"incomplete_question_coverage"});
 expect((await pool.query("SELECT id FROM reports WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
 expect((await pool.query("SELECT accepted,reason FROM publication_attempts WHERE run_id=$1",[x.runId])).rows).toEqual([{accepted:false,reason:"incomplete_question_coverage"}]);
 expect(await publishReport(pool,c.publication)).toMatchObject({accepted:true});
}));

async function releaseForWorker(x:Parameters<Parameters<typeof runCase>[0]>[0]) {
 x.session.stop();await pool.query("UPDATE run_leases SET expires_at=now()-interval '1 second' WHERE run_id=$1",[x.runId]);
}
function structuredWorkerTransport(wrongUnit=false) {
 return vi.fn(async(_input:unknown,init?:RequestInit)=>{
  const request=JSON.parse(String(init?.body)),context=JSON.parse(request.messages[1].content),operation=request.response_format.json_schema.name;
  if(operation==="research_brief_v1")return response(brief);
  if(operation==="research_extract_assertions_v1") {
   const p=context.passages[0],text=wrongUnit?p.text.replace("hectares","acres"):p.text;
   return response({candidates:[],assertions:[{key:"area",candidateKey:null,criterionKeys:["c1"],text,scope,quantities:[],evidence:[{passageId:p.id,start:0,end:p.text.length,quote:p.text}]}],limitations:[]});
  }
  if(operation==="research_assess_support_v1")return response({assessments:context.assertions.map((a:{key:string;scope:unknown;evidence:unknown})=>({claimKey:a.key,status:"supported",scope:a.scope,evidence:a.evidence,rationale:"Fabricated boundary control",missingEvidence:[]}))});
  if(operation==="research_review_coverage_v1")return response({questions:[{questionKey:"q1",status:"unresolved_at_limit",assertionKeys:context.approvedClaimKeys,reason:"Survival and comparison remain unresolved"}],omittedRequirements:[]});
  if(operation==="research_write_report_v1")return response({title:"Evidence",sections:[{heading:"Evidence",paragraphs:context.assertions.filter((a:{key:string})=>context.approvedClaimKeys.includes(a.key)).map((a:{key:string;text:string})=>({text:a.text,claimKeys:[a.key]}))}],unresolvedQuestionKeys:["q1"],limitations:[]});
  throw new Error(`unexpected operation:${operation}`);
 }) as typeof fetch;
}
describe("W05 structured services through production processRun",()=>{
 it("runs arbitrary evidence through criteria, extraction, substantive checks and cited publication",async()=>runCase(async(x)=>{
  const text=`Reef-${crypto.randomUUID()} restored 12 hectares in 2024.`;
  const sourceId=await insertSource(pool,{accountId:x.accountId,runId:x.runId,locator:"https://example.org/measured",title:"Measured restoration",publisher:"Research",originCluster:"research"});
  const p=await insertVersionAndPassage(pool,{sourceId,accountId:x.accountId,runId:x.runId,locator:"https://example.org/measured",text,accessLevel:"partial-text"});
  await releaseForWorker(x);globalThis.fetch=structuredWorkerTransport();
  await processRun(pool,x.config,x.runId);
  expect((await getRun(pool,x.runId))!.terminal_outcome).toBe("completed_with_limitations");
  const reports=(await pool.query("SELECT * FROM reports WHERE run_id=$1",[x.runId])).rows;
  expect(reports).toHaveLength(1);expect(reports[0].blocks[1].text).toBe(text);expect(reports[0].blocks[1].citationIds).toEqual([p.passageId]);
  expect((await pool.query("SELECT operation FROM model_operation_results WHERE run_id=$1",[x.runId])).rows.map((r)=>r.operation).sort()).toEqual(["brief","extract_assertions","assess_support","review_coverage","write_report","assess_support","review_coverage"].sort());
  expect((await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='evidence_checked'",[x.runId])).rows[0].payload.complete).toBe(false);
  expect(globalThis.fetch).toHaveBeenCalledTimes(7);
 }));
 it("does not turn a failed assertion into a verified event or template report",async()=>runCase(async(x)=>{
  const sourceId=await insertSource(pool,{accountId:x.accountId,runId:x.runId,locator:"https://example.org/measured",title:"Measured restoration",publisher:"Research",originCluster:"research"});
  await insertVersionAndPassage(pool,{sourceId,accountId:x.accountId,runId:x.runId,locator:"https://example.org/measured",text:"Reef-X restored 12 hectares in 2024.",accessLevel:"partial-text"});
  await releaseForWorker(x);globalThis.fetch=structuredWorkerTransport(true);await processRun(pool,x.config,x.runId);
  expect((await getRun(pool,x.runId))!.terminal_outcome).toBe("failed");
  expect((await pool.query("SELECT id FROM reports WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
  expect((await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='research_unresolved'",[x.runId])).rows[0].payload.reason).toBe("no_supported_assertions");
 }));
 it("keeps unavailable discovery explicit without fixture source injection",async()=>runCase(async(x)=>{
  await releaseForWorker(x);globalThis.fetch=structuredWorkerTransport();await processRun(pool,x.config,x.runId);
  expect((await getRun(pool,x.runId))!.terminal_outcome).toBe("failed");
  expect((await pool.query("SELECT id FROM sources WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
  expect((await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='research_unresolved'",[x.runId])).rows[0].payload.reason).toBe("readable_evidence_unavailable");
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
 }));
});

it.each(["resume","cancel"])("W05 structured writing pause supports %s without repeating evidence work",async(action)=>runCase(async(x)=>{
 const sourceId=await insertSource(pool,{accountId:x.accountId,runId:x.runId,locator:"https://example.org/scoped",title:"Scoped result",publisher:"Research",originCluster:"research"});
 await insertVersionAndPassage(pool,{sourceId,accountId:x.accountId,runId:x.runId,locator:"https://example.org/scoped",text:"Reef-Y restored 12 hectares in 2024.",accessLevel:"partial-text"});
 await releaseForWorker(x);globalThis.fetch=structuredWorkerTransport();
 await processRun(pool,x.config,x.runId,{pauseAt:"writing"});
 expect((await getRun(pool,x.runId))!.phase).toBe("writing");expect(globalThis.fetch).toHaveBeenCalledTimes(4);
 if(action==="cancel")await cancelRun(pool,x.runId);
 await processRun(pool,x.config,x.runId);
 expect((await getRun(pool,x.runId))!.terminal_outcome).toBe(action==="cancel"?"cancelled":"completed_with_limitations");
 expect(globalThis.fetch).toHaveBeenCalledTimes(action==="cancel"?4:7);
 expect((await pool.query("SELECT id FROM reports WHERE run_id=$1",[x.runId])).rowCount).toBe(action==="cancel"?0:1);
}));

async function searchCase(x:Parameters<Parameters<typeof runCase>[0]>[0]) {
 globalThis.fetch=vi.fn(async()=>response(brief)) as typeof fetch;
 const task=await ensureResearchTask(pool,x.config,x.session,{...x,briefRevision:1});
 if(task.kind!=="task")throw new Error("missing task");
 return {args:{...x,briefRevision:1,taskId:task.task.id,proposal:{rationale:"Investigate public restoration evidence",action:{type:"search",query:"coral kelp restoration",questionKeys:["q1"],publicQueryBasis:span}}},config:{...x.config,structuredDiscoveryEnabled:true}};
}
function searchReply(known=true) {return new Response(JSON.stringify({id:"nonbillable-search",model:"openai/gpt-4o-mini",provider:"OpenAI",...(known?{usage:{cost:"0.000003"}}:{}),choices:[{finish_reason:"stop",message:{annotations:[{type:"url_citation",url_citation:{url:"https://example.org/study",title:"Study",content:"Restoration findings"}}]}}]}));}
describe("W02/W05 durable pinned public discovery",()=>{
 it("pins engine/provider and reuses saved results even after unrelated evidence arrives",async()=>runCase(async(x)=>{
  const c=await searchCase(x);globalThis.fetch=vi.fn(async()=>searchReply()) as typeof fetch;
  const first=await performPublicSearch(pool,c.config,x.session,c.args);expect(first).toMatchObject({kind:"search",reused:false,hits:[{locator:"https://example.org/study"}]});
  const sent=JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
  expect(sent.plugins).toEqual([{id:"web",engine:"exa",mode:"auto",max_results:3}]);expect(sent.provider).toMatchObject({only:["openai"],allow_fallbacks:false,data_collection:"deny"});
  await pool.query("UPDATE runs SET evidence_revision=evidence_revision+1 WHERE id=$1",[x.runId]);
  expect(await performPublicSearch(pool,c.config,x.session,c.args)).toMatchObject({...first,reused:true});expect(fetch).toHaveBeenCalledTimes(1);
 }));
 it("holds unknown outcomes without repeating a request after evidence changes",async()=>runCase(async(x)=>{
  const c=await searchCase(x);globalThis.fetch=vi.fn(async()=>searchReply(false)) as typeof fetch;
  const first=await performPublicSearch(pool,c.config,x.session,c.args);expect(first.kind).toBe("pending");
  await pool.query("UPDATE runs SET evidence_revision=evidence_revision+1 WHERE id=$1",[x.runId]);
  expect(await performPublicSearch(pool,c.config,x.session,c.args)).toEqual(first);expect(fetch).toHaveBeenCalledTimes(1);
  expect((await pool.query("SELECT confirmed_micro,state,reserved_max_micro FROM provider_intents WHERE run_id=$1 AND route LIKE '%public-discovery.v1'",[x.runId])).rows[0]).toMatchObject({confirmed_micro:null,state:"outcome-unknown",reserved_max_micro:"28658"});
 }));
 it("rejects transformed private words and foreign task ownership before dispatch",async()=>runCase(async(x)=>{
  const c=await searchCase(x);globalThis.fetch=vi.fn(async()=>searchReply()) as typeof fetch;
  await expect(performPublicSearch(pool,c.config,x.session,{...c.args,proposal:{...c.args.proposal,action:{...c.args.proposal.action,query:"private CANARY"}}})).rejects.toThrow("unapproved_public_query_terms");
  await expect(performPublicSearch(pool,c.config,x.session,{...c.args,taskId:crypto.randomUUID()})).rejects.toThrow("search_task_mismatch");expect(fetch).not.toHaveBeenCalled();
 }));
 it("revalidates saved receipt and purges discovery output on deletion",async()=>runCase(async(x)=>{
  const c=await searchCase(x);globalThis.fetch=vi.fn(async()=>searchReply()) as typeof fetch;
  expect((await performPublicSearch(pool,c.config,x.session,c.args)).kind).toBe("search");
  await pool.query("UPDATE search_operations SET result=jsonb_set(result,'{receipt,actualMicro}','999') WHERE run_id=$1",[x.runId]);
  await expect(performPublicSearch(pool,c.config,x.session,c.args)).rejects.toThrow("invalid_saved_search");expect(fetch).toHaveBeenCalledTimes(1);
  await withTx(pool,(db)=>deleteAccount(db,x.accountId));expect((await pool.query("SELECT 1 FROM search_operations WHERE account_id=$1",[x.accountId])).rowCount).toBe(0);
 }));
 it("concurrent same-query attempts issue once without holding database locks during HTTP",async()=>runCase(async(x)=>{
  const c=await searchCase(x);let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>((r)=>entered=r),waiting=new Promise<void>((r)=>release=r);
  globalThis.fetch=vi.fn(async()=>{entered();await waiting;return searchReply();}) as typeof fetch;
  const first=performPublicSearch(pool,c.config,x.session,c.args);await started;
  try {expect((await performPublicSearch(pool,c.config,x.session,c.args)).kind).toBe("pending");} finally {release();}
  expect((await first).kind).toBe("search");expect(fetch).toHaveBeenCalledTimes(1);
 }));
 it("late deletion retains actual cost but discards search content",async()=>runCase(async(x)=>{
  const c=await searchCase(x);globalThis.fetch=vi.fn(async()=>{await withTx(pool,(db)=>deleteAccount(db,x.accountId));return searchReply();}) as typeof fetch;
  await expect(performPublicSearch(pool,c.config,x.session,c.args)).rejects.toBeInstanceOf(LostWorkerLease);
  expect((await pool.query("SELECT 1 FROM search_operations WHERE account_id=$1",[x.accountId])).rowCount).toBe(0);
  expect((await pool.query("SELECT confirmed_micro FROM provider_intents WHERE run_id=$1 AND route LIKE '%public-discovery.v1'",[x.runId])).rows[0].confirmed_micro).toBe("3");
 }));
});
it("W03/W05 old processor consent cannot issue pinned discovery",async()=>runCase(async(x)=>{
 const c=await searchCase(x);globalThis.fetch=vi.fn(async()=>searchReply()) as typeof fetch;
 await pool.query("UPDATE consent_records SET policy_version='2026-09-17' WHERE account_id=$1",[x.accountId]);
 await expect(performPublicSearch(pool,c.config,x.session,c.args)).rejects.toThrow("stale_or_unauthorized_attempt");
 expect(fetch).not.toHaveBeenCalled();expect((await pool.query("SELECT 1 FROM provider_intents WHERE run_id=$1 AND route LIKE '%public-discovery.v1'",[x.runId])).rowCount).toBe(0);
}));
it("W03/W05 mixed document tasks require explicit public-query approval",async()=>runCase(async(x)=>{
 const c=await searchCase(x);globalThis.fetch=vi.fn(async()=>searchReply()) as typeof fetch;
 await pool.query("UPDATE research_briefs SET payload=jsonb_set(payload,'{attachmentIds}',$2::jsonb) WHERE id=(SELECT brief_id FROM runs WHERE id=$1)",[x.runId,JSON.stringify([crypto.randomUUID()])]);
 await expect(performPublicSearch(pool,c.config,x.session,c.args)).rejects.toThrow("document_search_requires_public_query_approval");expect(fetch).not.toHaveBeenCalled();
}));

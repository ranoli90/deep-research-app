import { executeCounterevidence } from "../src/worker/counterevidence.js";
import { counterevidenceContext,counterevidenceLimitations } from "../src/modules/counterevidence.js";
import { counterevidenceSearch } from "@deep/research-core";
import { mkdir,writeFile } from "node:fs/promises";
import { executeCalculationPlanning } from "../src/worker/calculation-planning.js";
import { prepareCalculationClaim } from "../src/modules/calculation-publication.js";
import { executeEvidenceCalculation } from "../src/worker/evidence-calculation.js";
import { modelInputManifest } from "../src/modules/model-operations.js";
import { reserveLiveAttempt } from "../src/modules/live-spend.js";
import { executeScopeComparison } from "../src/worker/scope-comparison.js";
import { loadSupportContext,loadWriterSourceContext } from "../src/modules/scoped-support.js";
import { admitResearchCorrection } from "../src/modules/research-corrections.js";
import { inheritRunEvidence } from "../src/modules/run-evidence.js";
import { createHash } from "node:crypto";
import * as sourceReader from "../src/adapters/retrieval/read-source.js";
import { executeSourceRead } from "../src/worker/source-reading.js";
import { adoptSearchSources } from "../src/modules/search-sources.js";
import { performPublicSearch } from "../src/worker/public-search.js";
import { processRun } from "../src/worker/executor.js";
import { reportCompletionCovered } from "../src/modules/publication-coverage.js";
import { executeCoverageReview } from "../src/worker/research-coverage.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { CorrectionRequestSchema,CreateRunRequestSchema, type CanonicalReport,type ResearchModelOutput } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { publishReport,getReportForAccount } from "../src/modules/reports.js";
import { SCOPED_SUPPORT_VERSION,passageSupportsClaim, type StoredClaim } from "@deep/research-core";
import { claimLease,getRun,cancelRun,emitEvent } from "../src/modules/runs.js";
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
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
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
async function runCase(test: (x: { runId: string; accountId: string; fence: number; session: ReturnType<typeof fencedSession>; config: ReturnType<typeof loadConfig> }) => Promise<void>,initialQuestion=question) {
  const accountId = await withTx(pool, async (db) => { const s = await createDevSession(db); await grantConsent(db, s.accountId); return s.accountId; });
  const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question:initialQuestion, routeMode: "controlled-research" }));
  const owner = crypto.randomUUID(); const fence = (await claimLease(pool, runId, owner, 30_000))!;
  const session = fencedSession(pool, { runId, accountId, owner, fence, briefRevision: 1, leaseMs: 30_000 });
  const config = loadConfig({ DATABASE_URL: "postgres://localhost/test", LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true",
    OPENROUTER_API_KEY: "nonbillable-test-key", LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_SPEND_CAP_MICRO: "1000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() });
  try { await test({ runId, accountId, fence, session, config }); }
  finally {
    session.stop();
    await withTx(pool, async (db) => {
      for(const {id:runId} of (await db.query("SELECT id FROM runs WHERE account_id=$1 ORDER BY created_at DESC",[accountId])).rows) {
      await db.query("DELETE FROM claim_evidence WHERE claim_id IN (SELECT id FROM claims WHERE run_id=$1)",[runId]);
      for(const table of ["notification_fanout","completion_outbox","publication_attempts","reports"]) await db.query(`DELETE FROM ${table} WHERE run_id=$1`,[runId]);
      for (const table of ["extraction_receipts", "evidence_artifacts", "provider_intents", "claim_revisions", "claims", "run_actions", "run_leases", "run_dispatch_outbox", "run_events", "reservations", "passages", "sources"]) {
        if (table === "sources") await db.query("DELETE FROM source_versions WHERE source_id IN (SELECT id FROM sources WHERE run_id=$1)", [runId]);
        await db.query(`DELETE FROM ${table} WHERE run_id=$1`, [runId]);
      }
      await db.query("DELETE FROM runs WHERE id=$1", [runId]);
      }
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
  const output:ResearchModelOutput<"extract_assertions"> = { candidates:[{key:"new_entity",label:entity,evidence:[quote]}],
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
 expect(await publishReport(pool,{...c.publication,report:{...c.report,changeSummary:{evidenceUpdated:true,conclusionChanged:true,newlyFeasible:["invented"],newlyInfeasible:[],notes:"Forged comparison"}}})).toMatchObject({accepted:true});
 expect((await pool.query("SELECT change_summary FROM reports WHERE run_id=$1",[x.runId])).rows[0].change_summary).toBeNull();
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
function searchReply(known=true,url="https://example.org/study") {return new Response(JSON.stringify({id:"nonbillable-search",model:"openai/gpt-4o-mini",provider:"OpenAI",...(known?{usage:{cost:"0.000003"}}:{}),choices:[{finish_reason:"stop",message:{annotations:[{type:"url_citation",url_citation:{url,title:"Study",content:"Restoration findings"}}]}}]}));}
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

// Reader/model transport doubles below prove orchestration and stored provenance, not live extraction quality.
async function readCase(x:Parameters<Parameters<typeof runCase>[0]>[0]) {
 const c=await searchCase(x);globalThis.fetch=vi.fn(async()=>searchReply()) as typeof fetch;
 const search=await performPublicSearch(pool,c.config,x.session,c.args);if(search.kind!=="search")throw new Error("missing search");
 const adopt=()=>x.session.write((db)=>adoptSearchSources(db,{...c.args,intentId:search.intentId}));
 const ids=await adopt();expect(await adopt()).toEqual(ids);
 return {config:{...c.config,liveRetrievalEnabled:true},args:{...c.args,proposal:{rationale:"Read public evidence",action:{type:"fetch",sourceHandle:ids[0]!,questionKeys:["q1"]}}}};
}
function readControl(locator:string,text="Reef-Z restored 12 hectares in 2024."):Awaited<ReturnType<typeof sourceReader.readSource>> {
 const bytes=Buffer.from(text),digest=createHash("sha256").update(bytes).digest("hex");
 return {receipt:{requestedUrl:locator,finalUrl:locator,redirectChain:[],status:200,mime:"text/plain",retrievedAt:new Date().toISOString(),outcome:"successful_body"},bytes,
  extraction:{version:"utf8-notes-v1",digest,status:"partial",warnings:["Test transport double"],blocks:[{kind:"text",locator:"block:0",text,rows:[]}]}};
}
describe("W04/W05 durable discovered source reading",()=>{
 it("persists read provenance once and reuses the exact version",async()=>runCase(async(x)=>{
  const c=await readCase(x),read=vi.spyOn(sourceReader,"readSource").mockImplementation(async(url)=>readControl(url));
  const first=await executeSourceRead(c.config,x.session,c.args);expect(first).toMatchObject({kind:"read",readable:true,reused:false});
  expect(await executeSourceRead(c.config,x.session,c.args)).toEqual({...first,reused:true});expect(read).toHaveBeenCalledTimes(1);
  expect((await pool.query("SELECT extraction_method FROM passages WHERE run_id=$1 ORDER BY extraction_method",[x.runId])).rows).toEqual([{extraction_method:"search-snippet"},{extraction_method:"utf8-notes-v1"}]);
  await withTx(pool,(db)=>deleteAccount(db,x.accountId));expect((await pool.query("SELECT 1 FROM source_read_operations WHERE account_id=$1",[x.accountId])).rowCount).toBe(0);
 }));
 it("rejects unknown source handles and invalid question bindings before network",async()=>runCase(async(x)=>{
  const c=await readCase(x),read=vi.spyOn(sourceReader,"readSource");
  await expect(executeSourceRead(c.config,x.session,{...c.args,proposal:{...c.args.proposal,action:{...c.args.proposal.action,sourceHandle:crypto.randomUUID()}}})).rejects.toThrow("read_source_owner_mismatch");
  await expect(executeSourceRead(c.config,x.session,{...c.args,proposal:{...c.args.proposal,action:{...c.args.proposal.action,questionKeys:["foreign"]}}})).rejects.toThrow("read_task_mismatch");expect(read).not.toHaveBeenCalled();
 }));
 it("does not repeat an in-flight read or hold database locks during it",async()=>runCase(async(x)=>{
  const c=await readCase(x);let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>((r)=>entered=r),waiting=new Promise<void>((r)=>release=r);
  const read=vi.spyOn(sourceReader,"readSource").mockImplementation(async(url)=>{entered();await waiting;return readControl(url);});
  const first=executeSourceRead(c.config,x.session,c.args);await started;
  try {expect(await executeSourceRead(c.config,x.session,c.args)).toMatchObject({kind:"pending"});} finally {release();}
  expect(await first).toMatchObject({kind:"read"});expect(read).toHaveBeenCalledTimes(1);
 }));
 it.each(["delete","change"])("discards late content after %s",async(kind)=>runCase(async(x)=>{
  const c=await readCase(x);vi.spyOn(sourceReader,"readSource").mockImplementation(async(url)=>{
   if(kind==="delete")await withTx(pool,(db)=>deleteAccount(db,x.accountId));
   else await pool.query("UPDATE sources SET canonical_locator='https://example.org/changed' WHERE id=$1",[c.args.proposal.action.sourceHandle]);
   return readControl(url);
  });
  await expect(executeSourceRead(c.config,x.session,c.args)).rejects.toThrow(kind==="delete"?"stale_worker":"read_source_changed");
  expect((await pool.query("SELECT 1 FROM extraction_receipts WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
 }));
 it.each([true,false])("production worker reads discovered evidence; readable=%s",async(readable)=>runCase(async(x)=>{
  const model=structuredWorkerTransport();let searches=0;
  globalThis.fetch=vi.fn(async(input,init)=>{if(JSON.parse(String(init?.body)).plugins?.length){searches++;return searchReply();}return model(input,init);}) as typeof fetch;
  const text=`Reef-${crypto.randomUUID()} restored 12 hectares in 2024.`;
  vi.spyOn(sourceReader,"readSource").mockImplementation(async(url)=>readable?readControl(url,text):{receipt:{...readControl(url).receipt,outcome:"fetch_unavailable",status:null}});
  await releaseForWorker(x);
  const config={...x.config,structuredDiscoveryEnabled:true,liveRetrievalEnabled:true};
  if(readable){await processRun(pool,config,x.runId,{pauseAt:"writing"});expect(model).toHaveBeenCalledTimes(4);}
  await processRun(pool,config,x.runId);
  if(readable){expect(model).toHaveBeenCalledTimes(7);expect(sourceReader.readSource).toHaveBeenCalledTimes(1);}
  expect(searches).toBe(1);
  expect((await getRun(pool,x.runId))!.terminal_outcome).toBe(readable?"completed_with_limitations":"failed");
  const reports=(await pool.query("SELECT * FROM reports WHERE run_id=$1",[x.runId])).rows;expect(reports).toHaveLength(readable?1:0);
  if(readable){expect(reports[0].blocks[1].text).toBe(text);const p=(await pool.query("SELECT id FROM passages WHERE run_id=$1 AND extraction_method='utf8-notes-v1'",[x.runId])).rows[0];expect(reports[0].blocks[1].citationIds).toEqual([p.id]);}
  else expect((await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='research_unresolved'",[x.runId])).rows[0].payload.reason).toBe("readable_evidence_unavailable");
 }));
});

it("W05 unresolved criteria trigger a distinct public query and rechecked synthesis",async()=>runCase(async(x)=>{
 const model=structuredWorkerTransport(),queries:string[]=[];
 const focusedBrief={...brief,criteria:[{...brief.criteria[0]!,provenance:{start:question.indexOf("kelp"),end:question.length-1,quote:"kelp restoration"}}]};
 globalThis.fetch=vi.fn(async(input,init)=>{
  const body=JSON.parse(String(init?.body));
  if(body.plugins?.length){queries.push(body.messages[1].content);return searchReply(true,`https://example.org/study-${queries.length}`);}
  const c=JSON.parse(body.messages[1].content),op=body.response_format.json_schema.name;
  if(op==="research_brief_v1")return response(focusedBrief);
  if(op==="research_extract_assertions_v1")return response({candidates:[],assertions:c.passages.map((p:{id:string;text:string},i:number)=>({key:`area${i}`,candidateKey:null,criterionKeys:["c1"],text:p.text,scope,quantities:[],evidence:[{passageId:p.id,start:0,end:p.text.length,quote:p.text}]})),limitations:[]});
  if(op==="research_review_coverage_v1")return response({questions:[{questionKey:"q1",status:c.passages.length>1?"supported":"unresolved_at_limit",assertionKeys:c.approvedClaimKeys,reason:"Nonbillable review control"}],omittedRequirements:[]});
  if(op==="research_write_report_v1")expect(c.scopeComparison).toMatchObject({version:"scope-comparison-context.v1",groups:[{relations:Array(6).fill("unknown"),pairs:[[0,1]]}],entailment:"not_assessed"});
  return model(input,init);
 }) as typeof fetch;
 const names=[`Coral-${crypto.randomUUID()}`,`Kelp-${crypto.randomUUID()}`];
 vi.spyOn(sourceReader,"readSource").mockImplementation(async(url)=>readControl(url,`${url.endsWith("1")?names[0]:names[1]} restored 12 hectares in 2024.`));
 await releaseForWorker(x);const config={...x.config,structuredDiscoveryEnabled:true,liveRetrievalEnabled:true};
 await processRun(pool,config,x.runId,{pauseAt:"writing"});await processRun(pool,config,x.runId);
 const comparisonRows=await pool.query("SELECT result FROM scope_comparisons WHERE run_id=$1",[x.runId]);expect(comparisonRows.rows).toHaveLength(1);
 expect((await pool.query("SELECT input_manifest FROM model_operation_results WHERE run_id=$1 AND operation='write_report'",[x.runId])).rows[0].input_manifest).toMatchObject({version:"model-input.v3",scopeComparisonDigest:expect.stringMatching(/^[a-f0-9]{64}$/)});
 expect(queries).toEqual([question,"kelp restoration"]);expect(sourceReader.readSource).toHaveBeenCalledTimes(2);
 expect((await getRun(pool,x.runId))!.terminal_outcome).toBe("completed");
 const report=(await pool.query("SELECT blocks FROM reports WHERE run_id=$1",[x.runId])).rows[0];
 for(const name of names)expect(JSON.stringify(report.blocks)).toContain(name);
 expect((await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='evidence_checked' ORDER BY created_at",[x.runId])).rows.map((r)=>r.payload.complete)).toEqual([false,true,true]);
}));
it("W02/W05 concurrent distinct searches obey the durable per-run query ceiling",async()=>runCase(async(x)=>{
 const c=await searchCase(x);globalThis.fetch=vi.fn(async()=>searchReply()) as typeof fetch;
 const results=await Promise.all(["coral","kelp","restoration","Compare"].map((query)=>performPublicSearch(pool,c.config,x.session,{...c.args,proposal:{...c.args.proposal,action:{...c.args.proposal.action,query}}})));
 expect(results.filter((r)=>r.kind==="search")).toHaveLength(3);expect(results.filter((r)=>r.kind==="blocked")).toEqual([{kind:"blocked",reason:"discovery_query_limit"}]);expect(fetch).toHaveBeenCalledTimes(3);
 const query=["coral","kelp","restoration","Compare"][results.findIndex((r)=>r.kind==="search")]!;
 expect(await performPublicSearch(pool,c.config,x.session,{...c.args,proposal:{...c.args.proposal,action:{...c.args.proposal.action,query}}})).toMatchObject({kind:"search",reused:true});
 expect(fetch).toHaveBeenCalledTimes(3);
}));

const correctionInput=(question:string,evidencePolicy:"reuse_snapshot"|"refresh"="reuse_snapshot")=>CorrectionRequestSchema.parse({expectedBriefRevision:1,correctionText:"Replace the research question",patch:{kind:"replace_question",question,evidencePolicy}});
function revisedWorkerTransport() {
 const normal=structuredWorkerTransport();return vi.fn(async(input,init)=>{
  const body=JSON.parse(String(init?.body)),context=JSON.parse(body.messages[1].content);
  if(body.response_format.json_schema.name==="research_brief_v1") {
   const provenance={start:0,end:context.question.length,quote:context.question};
   return response({...brief,objective:context.question,objectiveProvenance:provenance,criteria:[{...brief.criteria[0]!,provenance}],questions:[{...brief.questions[0]!,text:context.question}]});
  }
  return normal(input,init);
 }) as typeof fetch;
}
// Fabricated search transport; production gateway persists and checks its durable receipt.
function correctionDiscovery(model:typeof fetch,locator:string):typeof fetch {
 return vi.fn(async(input,init)=>{const body=JSON.parse(String(init?.body));return body.plugins?.length?searchReply(true,locator):model(input,init);}) as typeof fetch;
}
async function expectCorrectionSearch(runId:string){
 expect((await pool.query("SELECT confirmed_micro FROM provider_intents WHERE run_id=$1 AND route LIKE '%public-discovery.v1'",[runId])).rows).toEqual([{confirmed_micro:"3"}]);
}
async function parentEvidence(x:Parameters<Parameters<typeof runCase>[0]>[0]) {
 const sourceId=await insertSource(pool,{accountId:x.accountId,runId:x.runId,locator:"https://example.org/correction",title:"Measured evidence",publisher:"Study",originCluster:"study"});
 return insertVersionAndPassage(pool,{sourceId,accountId:x.accountId,runId:x.runId,locator:"https://example.org/correction",text:`Kelp-${crypto.randomUUID()} restored 12 hectares in 2024.`,accessLevel:"partial-text"});
}
describe("W06 immutable correction evidence membership",()=>{
 it("reuses exact passage/version identities but recomputes child claims through production worker",async()=>runCase(async(x)=>{
  const p=await parentEvidence(x);await releaseForWorker(x);globalThis.fetch=revisedWorkerTransport();await processRun(pool,x.config,x.runId);
  const old=(await pool.query("SELECT claim_ids FROM reports WHERE run_id=$1",[x.runId])).rows[0];
  const replacement="What area did the kelp restoration study report?";
  const child=await admitResearchCorrection(pool,x.accountId,x.runId,correctionInput(replacement));
  expect((await pool.query("SELECT original_question FROM research_briefs WHERE id=(SELECT brief_id FROM runs WHERE id=$1)",[child.runId])).rows[0].original_question).toBe(replacement);
  globalThis.fetch=correctionDiscovery(revisedWorkerTransport(),"https://example.org/correction");const reread=vi.spyOn(sourceReader,"readSource");await processRun(pool,{...x.config,structuredDiscoveryEnabled:true,liveRetrievalEnabled:true},child.runId);expect(reread).not.toHaveBeenCalled();await expectCorrectionSearch(child.runId);
  const report=(await pool.query("SELECT * FROM reports WHERE run_id=$1",[child.runId])).rows[0];expect(report).toBeDefined();
  expect(report.blocks[1].citationIds).toEqual([p.passageId]);expect(report.claim_ids.some((id:string)=>old.claim_ids.includes(id))).toBe(false);
  expect(report.change_summary).toMatchObject({evidenceUpdated:false,conclusionChanged:false,newlyFeasible:[],comparison:{version:"report-changes.v1",addedClaimRevisionIds:[],removedClaimRevisionIds:[],unchangedAssertions:1,reusedCitedSourceVersionIds:[p.versionId],newlyCitedSourceVersionIds:[]}});
  expect(report.change_summary.comparison.addedCriterionIds).toHaveLength(0);
  expect((await pool.query("SELECT source_version_id FROM run_evidence_membership WHERE run_id=$1",[child.runId])).rows).toEqual([{source_version_id:p.versionId}]);
  expect((await pool.query("SELECT 1 FROM sources WHERE run_id=$1",[child.runId])).rowCount).toBe(0);expect(fetch).toHaveBeenCalledTimes(8);
  expect((await pool.query("SELECT dependency_completeness,reused_passages,reopen_discovery FROM research_change_sets WHERE run_id=$1",[child.runId])).rows[0]).toEqual({dependency_completeness:"unknown",reused_passages:1,reopen_discovery:true});
 }));
 it("concurrent identical corrections admit one child, allowance and outbox",async()=>runCase(async(x)=>{
  await parentEvidence(x);const input=correctionInput("What did the study measure?");
  const [a,b]=await Promise.all([admitResearchCorrection(pool,x.accountId,x.runId,input),admitResearchCorrection(pool,x.accountId,x.runId,input)]);
  expect(a.runId).toBe(b.runId);expect([a.reused,b.reused].sort()).toEqual([false,true]);
  for(const table of ["reservations","run_dispatch_outbox","research_change_sets"])expect((await pool.query(`SELECT 1 FROM ${table} WHERE run_id=$1`,[a.runId])).rowCount).toBe(1);
 }));
 it("refresh does not inherit old evidence and foreign ownership cannot grant membership",async()=>runCase(async(x)=>{
  await parentEvidence(x);const child=await admitResearchCorrection(pool,x.accountId,x.runId,correctionInput("Refresh the study evidence","refresh"));
  expect((await pool.query("SELECT 1 FROM authorized_run_passages WHERE run_id=$1",[child.runId])).rowCount).toBe(0);
  await expect(inheritRunEvidence(pool,{runId:child.runId,parentRunId:x.runId,accountId:crypto.randomUUID()})).rejects.toThrow("evidence_inheritance_owner_or_state_mismatch");
  await withTx(pool,(db)=>deleteAccount(db,x.accountId));
  expect((await pool.query("SELECT 1 FROM research_change_sets WHERE account_id=$1",[x.accountId])).rowCount).toBe(0);
 }));
 it("changed source digests revoke membership visibility and account deletion purges it",async()=>runCase(async(x)=>{
  const p=await parentEvidence(x),child=await admitResearchCorrection(pool,x.accountId,x.runId,correctionInput("Inspect this study again"));
  expect((await pool.query("SELECT 1 FROM authorized_run_passages WHERE run_id=$1",[child.runId])).rowCount).toBe(1);
  await pool.query("UPDATE source_versions SET content_hash=$2 WHERE id=$1",[p.versionId,"0".repeat(64)]);
  expect((await pool.query("SELECT 1 FROM authorized_run_passages WHERE run_id=$1",[child.runId])).rowCount).toBe(0);
  await withTx(pool,(db)=>deleteAccount(db,x.accountId));expect((await pool.query("SELECT 1 FROM run_evidence_membership WHERE account_id=$1",[x.accountId])).rowCount).toBe(0);
 }));
});
it("W06 a corrupt cross-account membership cannot expose foreign passages",async()=>runCase(async(x)=>runCase(async(y)=>{
 const p=await parentEvidence(y),child=await admitResearchCorrection(pool,x.accountId,x.runId,correctionInput("Inspect authorized evidence only","refresh"));
 await pool.query(`INSERT INTO run_evidence_membership(run_id,account_id,passage_id,source_version_id,origin_run_id,passage_digest,version_digest)
  SELECT $1,$2,p.id,p.source_version_id,p.run_id,p.content_hash,v.content_hash FROM passages p JOIN source_versions v ON v.id=p.source_version_id WHERE p.id=$3`,[child.runId,x.accountId,p.passageId]);
 expect((await pool.query("SELECT 1 FROM authorized_run_passages WHERE run_id=$1",[child.runId])).rowCount).toBe(0);
})));
it("W06 fresh cited versions change evidence without claiming changed assertion wording",async()=>runCase(async(x)=>{
 const original=await parentEvidence(x);await releaseForWorker(x);globalThis.fetch=revisedWorkerTransport();await processRun(pool,x.config,x.runId);
 const text=(await pool.query("SELECT exact_text FROM passages WHERE id=$1",[original.passageId])).rows[0].exact_text;
 const child=await admitResearchCorrection(pool,x.accountId,x.runId,correctionInput("What area did the study restore?","refresh"));
 globalThis.fetch=correctionDiscovery(revisedWorkerTransport(),"https://example.org/refreshed");
 const read=vi.spyOn(sourceReader,"readSource").mockImplementation(async locator=>readControl(locator,text));
 await processRun(pool,{...x.config,structuredDiscoveryEnabled:true,liveRetrievalEnabled:true},child.runId);
 expect(read).toHaveBeenCalledOnce();await expectCorrectionSearch(child.runId);
 const fresh=(await pool.query(`SELECT source_version_id AS "versionId" FROM source_read_operations WHERE run_id=$1 AND state='finished'`,[child.runId])).rows[0];expect(fresh).toBeDefined();
 const report=(await pool.query("SELECT change_summary FROM reports WHERE run_id=$1",[child.runId])).rows[0];
 expect(report.change_summary).toMatchObject({evidenceUpdated:true,conclusionChanged:false,comparison:{addedClaimRevisionIds:[],removedClaimRevisionIds:[],unchangedAssertions:1,reusedCitedSourceVersionIds:[],newlyCitedSourceVersionIds:[fresh.versionId]}});
}));
it("W06 missing parent publication cannot produce an unchanged comparison",async()=>runCase(async(x)=>{
 await parentEvidence(x);const child=await admitResearchCorrection(pool,x.accountId,x.runId,correctionInput("Inspect the measured area"));
 globalThis.fetch=correctionDiscovery(revisedWorkerTransport(),"https://example.org/correction");const reread=vi.spyOn(sourceReader,"readSource");await processRun(pool,{...x.config,structuredDiscoveryEnabled:true,liveRetrievalEnabled:true},child.runId);expect(reread).not.toHaveBeenCalled();await expectCorrectionSearch(child.runId);
 expect((await pool.query("SELECT change_summary FROM reports WHERE run_id=$1",[child.runId])).rows[0].change_summary).toBeNull();
}));

describe("W05 production executor has no diagnostic fallback",()=>{
 it("disabled structured processing records unresolved failure without issuing provider work",async()=>runCase(async x=>{
  await releaseForWorker(x);const provider=vi.fn();globalThis.fetch=provider;
  await processRun(pool,{...x.config,structuredModelEnabled:false},x.runId);
  expect(provider).not.toHaveBeenCalled();
  expect((await getRun(pool,x.runId))?.terminal_outcome).toBe("failed");
  const events=await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='research_unresolved'",[x.runId]);
  expect(events.rows).toEqual([{payload:{reason:"structured_route_disabled"}}]);
  expect((await pool.query("SELECT id FROM reports WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
 }));
 it("production entrypoint does not execute a queued fixture even when handed development config",async()=>runCase(async x=>{
  await releaseForWorker(x);await pool.query("UPDATE runs SET route_mode='fixture', lifecycle='queued' WHERE id=$1",[x.runId]);
  const provider=vi.fn();globalThis.fetch=provider;await processRun(pool,x.config,x.runId);
  expect(provider).not.toHaveBeenCalled();expect((await getRun(pool,x.runId))?.lifecycle).toBe("queued");
  expect((await pool.query("SELECT id FROM sources WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
 }));
});

async function comparisonCase(x:Parameters<Parameters<typeof runCase>[0]>[0]) {
 const c=await extractionCase(x),first=c.output.assertions[0]!;
 c.output.assertions.push({...first,key:"area_rephrased",text:`In 2024, ${first.scope.entity} restored an area of 12 hectares.`});
 globalThis.fetch=vi.fn(async()=>response(c.output)) as typeof fetch;
 const extraction=await extractEvidenceAssertions(pool,x.config,x.session,c.args);if(extraction.kind!=="extraction")throw new Error("missing extraction");
 globalThis.fetch=vi.fn(async()=>response({assessments:c.output.assertions.map(a=>({claimKey:a.key,status:"supported",scope:a.scope,evidence:a.evidence,rationale:"Nonbillable comparison control",missingEvidence:[]}))})) as typeof fetch;
 const args={...c.args,extractionIntentId:extraction.intentId};
 const support=await executeAssertionSupport(pool,x.config,x.session,args);if(support.kind!=="support")throw new Error("missing support");
 expect(support.checks.map(c=>c.decision)).toEqual(["supported","supported"]);
 return {...c,support,args:{...args,supportIntentId:support.intentId,action:{type:"compare_scopes",claimKeys:c.output.assertions.map(a=>a.key)}}};
}
describe("W05 executed scope comparisons",()=>{
 it("persists exact revisions and reuses the result without a provider call; writer receives it",async()=>runCase(async x=>{
  const c=await comparisonCase(x);const provider=vi.fn();globalThis.fetch=provider;
  const result=await executeScopeComparison(x.session,c.args);expect(result).toMatchObject({kind:"comparison",reused:false,result:{pairs:[{status:"scope_incomplete",entailment:"not_assessed"}]}});
  if(result.kind!=="comparison")throw new Error("missing comparison");
  expect(await executeScopeComparison(x.session,{...c.args,action:{type:"compare_scopes",claimKeys:[...c.args.action.claimKeys].reverse()}})).toEqual({...result,reused:true});
  const row=(await pool.query("SELECT * FROM scope_comparisons WHERE id=$1",[result.id])).rows[0];
  expect(row.claim_revision_ids).toEqual(c.support.checks.map(c=>c.claimRevisionId));expect(row.input_digest).toMatch(/^[a-f0-9]{64}$/);
  const writer=await loadWriterSourceContext(pool,{...c.args,sourceSupportIntentId:c.support.intentId},TASK_MODEL_VERSIONS);
  expect(writer.context.scopeComparison).toMatchObject({version:"scope-comparison-context.v1",claimKeys:["area","area_rephrased"],groups:[{relations:["equal","unknown","unknown","unknown","equal","unknown"],pairs:[[0,1]]}],entailment:"not_assessed",quantityCompatibility:"not_assessed"});expect(provider).not.toHaveBeenCalled();
 }));
 it("rejects foreign owners, wrong revisions, unknown targets and extra authority",async()=>runCase(async x=>{
  const c=await comparisonCase(x);
  await expect(executeScopeComparison(x.session,{...c.args,accountId:crypto.randomUUID()})).rejects.toThrow("support_extraction_owner_or_version_mismatch");
  await expect(executeScopeComparison(x.session,{...c.args,briefRevision:2})).rejects.toThrow("support_extraction_owner_or_version_mismatch");
  await expect(executeScopeComparison(x.session,{...c.args,action:{type:"compare_scopes",claimKeys:["area","foreign"]}})).rejects.toThrow("comparison_target_unavailable");
  expect(await executeScopeComparison(x.session,{...c.args,action:{...c.args.action,budgetMicro:1}})).toEqual({kind:"blocked",reason:"invalid_scope_comparison_action"});
  expect((await pool.query("SELECT id FROM scope_comparisons WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
 }));
 it("corrupt comparison output cannot be reused or passed to the writer",async()=>runCase(async x=>{
  const c=await comparisonCase(x);await executeScopeComparison(x.session,c.args);
  await pool.query("UPDATE scope_comparisons SET result=jsonb_set(result,'{pairs,0,status}','\"scope_matches\"') WHERE run_id=$1",[x.runId]);
  await expect(executeScopeComparison(x.session,c.args)).rejects.toThrow("stored_scope_comparison_mismatch");
  await expect(loadWriterSourceContext(pool,{...c.args,sourceSupportIntentId:c.support.intentId},TASK_MODEL_VERSIONS)).rejects.toThrow("stored_scope_comparison_mismatch");
 }));
 it("changed claim revision invalidates a comparison and deletion removes derived records",async()=>runCase(async x=>{
  const c=await comparisonCase(x);await executeScopeComparison(x.session,c.args);
  await pool.query("UPDATE claim_revisions SET text='tampered' WHERE id=$1",[c.support.checks[0]!.claimRevisionId]);
  await expect(executeScopeComparison(x.session,c.args)).rejects.toThrow("stored_assertion_revision_mismatch");
  await withTx(pool,db=>deleteAccount(db,x.accountId));
  expect((await pool.query("SELECT id FROM scope_comparisons WHERE account_id=$1",[x.accountId])).rowCount).toBe(0);
  await expect(executeScopeComparison(x.session,c.args)).rejects.toThrow("stale_worker");
 }));
});
it("W05 concurrent scope comparison execution produces one durable result",async()=>runCase(async x=>{
 const c=await comparisonCase(x);
 const results=await Promise.all([executeScopeComparison(x.session,c.args),executeScopeComparison(x.session,c.args)]);
 expect(results.every(r=>r.kind==="comparison")).toBe(true);
 if(results[0]?.kind!=="comparison"||results[1]?.kind!=="comparison")throw new Error("missing comparison");
 expect(results[0].id).toBe(results[1].id);expect(results.map(r=>r.kind==="comparison"&&r.reused).sort()).toEqual([false,true]);
 expect((await pool.query("SELECT id FROM scope_comparisons WHERE run_id=$1",[x.runId])).rowCount).toBe(1);
}));
it("W02/W05 unknown prior writer attempt blocks a context upgrade without releasing its hold",async()=>runCase(async x=>{
 const c=await comparisonCase(x);
 const attempt=await reserveLiveAttempt(pool,x.config,{runId:x.runId,fence:x.fence,briefRevision:1,kind:"write_report",logicalKey:"old-writer-context",route:"openrouter:nonbillable-control",requestDigest:"old-context",reserveMicro:1});
 expect(attempt.issue).toBe(true);const provider=vi.fn();globalThis.fetch=provider;
 expect(await executeScopeComparison(x.session,c.args)).toEqual({kind:"blocked",reason:"comparison_upgrade_requires_reconciled_writer"});
 const intent=(await pool.query("SELECT state,confirmed_micro,reserved_max_micro FROM provider_intents WHERE id=$1",[attempt.intentId])).rows[0];
 expect(intent).toMatchObject({state:"issued",confirmed_micro:null,reserved_max_micro:"1"});expect(provider).not.toHaveBeenCalled();
 expect((await pool.query("SELECT id FROM scope_comparisons WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
}));
it("W05 oversized structured context is an explicit blocked outcome before provider admission",async()=>runCase(async x=>{
 const provider=vi.fn();globalThis.fetch=provider;
 const text="Evidence text. ".repeat(1500),hash=createHash("sha256").update(text).digest("hex");
 const large={...context,passages:Array.from({length:12},()=>({id:crypto.randomUUID(),sourceVersionId:crypto.randomUUID(),digest:hash,text,accessLevel:"partial-text"}))};
 expect(await performModelOperation(pool,x.config,x.session,{...x,briefRevision:1,evidenceRevision:1,operation:"brief",context:large})).toEqual({kind:"blocked",reason:"model_context_too_large"});
 expect(provider).not.toHaveBeenCalled();expect((await pool.query("SELECT id FROM provider_intents WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
}));
it("W05 legacy comparison preserves its original writer representation even with an unknown attempt",async()=>runCase(async x=>{
 const c=await comparisonCase(x);const created=await executeScopeComparison(x.session,c.args);if(created.kind!=="comparison")throw new Error("missing comparison");
 const basis=await loadSupportContext(pool,c.args,TASK_MODEL_VERSIONS);
 // Frozen pre-migration026 identity construction: seed the exact prior format, not a new-format alias.
 const legacyInput={action:c.args.action,taskId:c.args.taskId,briefRevision:1,evidenceRevision:basis.evidenceRevision,evidence:modelInputManifest(basis.context),
  claims:c.support.checks.map(c=>({key:c.claimKey,claimRevisionId:c.claimRevisionId,decision:c.decision})),supportCheckerVersion:SCOPED_SUPPORT_VERSION};
 const oldDigest=createHash("sha256").update(JSON.stringify(legacyInput)).digest("hex");
 await pool.query("UPDATE scope_comparisons SET input_digest=$2,writer_context_version='scope-comparison.v1' WHERE id=$1",[created.id,oldDigest]);
 const provider=vi.fn(async()=>{throw new Error("nonbillable unknown writer outcome");});globalThis.fetch=provider;
 const writerArgs={...c.args,sourceSupportIntentId:c.support.intentId};
 expect(await createResearchDraft(pool,x.config,x.session,writerArgs)).toEqual({kind:"blocked",reason:"writer_outcome_unknown"});
 expect(await executeScopeComparison(x.session,c.args)).toMatchObject({id:created.id,reused:true,writerContextVersion:"scope-comparison.v1"});
 const writer=await loadWriterSourceContext(pool,{...c.args,sourceSupportIntentId:c.support.intentId},TASK_MODEL_VERSIONS);
 expect(writer.context.scopeComparison).toEqual(created.result);expect(modelInputManifest(writer.context).version).toBe("model-input.v2");
 expect(await createResearchDraft(pool,x.config,x.session,writerArgs)).toEqual({kind:"blocked",reason:"writer_outcome_unknown"});
 expect(provider).toHaveBeenCalledTimes(1);
 expect((await pool.query("SELECT i.id FROM provider_intents i JOIN run_actions a ON a.id=i.action_id WHERE a.run_id=$1 AND a.kind='write_report'",[x.runId])).rowCount).toBe(1);
 expect((await pool.query("SELECT id FROM scope_comparisons WHERE run_id=$1",[x.runId])).rowCount).toBe(1);
}));
it("W05 projection metadata and model-bound pair tampering fail closed",async()=>runCase(async x=>{
 const c=await comparisonCase(x);const created=await executeScopeComparison(x.session,c.args);if(created.kind!=="comparison")throw new Error("missing comparison");
 const writer=await loadWriterSourceContext(pool,{...c.args,sourceSupportIntentId:c.support.intentId},TASK_MODEL_VERSIONS);
 if(writer.context.scopeComparison?.version!=="scope-comparison-context.v1")throw new Error("missing compact context");
 writer.context.scopeComparison.groups[0]!.relations[0]="different";
 const provider=vi.fn();globalThis.fetch=provider;
 await expect(performModelOperation(pool,x.config,x.session,{...x,briefRevision:1,evidenceRevision:writer.evidenceRevision,operation:"write_report",context:writer.context})).rejects.toThrow("model_scope_comparison_mismatch");
 expect(provider).not.toHaveBeenCalled();
 await pool.query("UPDATE scope_comparisons SET writer_context_version='scope-comparison.v1' WHERE id=$1",[created.id]);
 await expect(executeScopeComparison(x.session,c.args)).rejects.toThrow("stored_scope_context_version_mismatch");
 await expect(loadWriterSourceContext(pool,{...c.args,sourceSupportIntentId:c.support.intentId},TASK_MODEL_VERSIONS)).rejects.toThrow("stored_scope_context_version_mismatch");
}));

async function calculationCase(x:Parameters<Parameters<typeof runCase>[0]>[0],wrongBinding=false) {
 const c=await extractionCase(x),entity=`Kelp-${crypto.randomUUID().slice(0,8)}`,text=`${entity} restored 8 hectares in 2024.`;
 const sourceId=await insertSource(pool,{accountId:x.accountId,runId:x.runId,locator:"https://example.org/second-study",title:"Other restoration",publisher:"Control",originCluster:"other-study"});
 const p=await insertVersionAndPassage(pool,{sourceId,accountId:x.accountId,runId:x.runId,locator:"https://example.org/second-study",text,accessLevel:"partial-text"});
 c.args.passageIds.push(p.passageId);
 c.output.assertions.push({key:"second_area",candidateKey:null,criterionKeys:["c1"],text,scope:{...scope,entity,time:"2024"},
  quantities:[{value:wrongBinding?"2024":"8",unit:"hectares",currency:null,billingPeriod:null,qualifier:null}],evidence:[{passageId:p.passageId,start:0,end:text.length,quote:text}]});
 globalThis.fetch=vi.fn(async()=>response(c.output)) as typeof fetch;
 const extracted=await extractEvidenceAssertions(pool,x.config,x.session,c.args);if(extracted.kind!=="extraction")throw new Error("missing extraction");
 globalThis.fetch=vi.fn(async()=>response({assessments:c.output.assertions.map(a=>({claimKey:a.key,status:"supported",scope:a.scope,evidence:a.evidence,rationale:"Nonbillable numeric input control",missingEvidence:[]}))})) as typeof fetch;
 const args={...c.args,extractionIntentId:extracted.intentId};
 const support=await executeAssertionSupport(pool,x.config,x.session,args);if(support.kind!=="support")throw new Error("missing support");
 expect(support.checks.map(c=>c.decision)).toEqual(["supported","supported"]);
 return {...c,support,args:{...args,supportIntentId:support.intentId,action:{type:"calculate",formula:"difference",inputs:[{claimKey:"area",quantityIndex:0},{claimKey:"second_area",quantityIndex:0}]}}};
}
describe("W05 evidence-bound calculation execution",()=>{
 it("computes from exact supported revisions, binds numeric spans and replays without provider work",async()=>runCase(async x=>{
  const c=await calculationCase(x),provider=vi.fn();globalThis.fetch=provider;
  const result=await executeEvidenceCalculation(x.session,c.args);
  expect(result).toMatchObject({kind:"calculation",reused:false,result:{status:"computed",output:{numerator:"4",denominator:"1",unit:"hectares"}}});
  if(result.kind!=="calculation")throw new Error("missing calculation");
  for(const input of result.result.inputs)for(const quote of input.evidence) {
   const text=(await pool.query("SELECT exact_text FROM passages WHERE id=$1",[quote.passageId])).rows[0].exact_text;
   expect(text.slice(quote.start,quote.end)).toBe(quote.quote);
  }
  expect(await executeEvidenceCalculation(x.session,c.args)).toEqual({...result,reused:true});
  expect((await pool.query("SELECT claim_revision_ids FROM evidence_calculations WHERE id=$1",[result.id])).rows[0].claim_revision_ids).toEqual(c.support.checks.map(c=>c.claimRevisionId));
  expect(provider).not.toHaveBeenCalled();
 }));
 it("a model-supported year cannot masquerade as an area input",async()=>runCase(async x=>{
  const c=await calculationCase(x,true);
  expect(await executeEvidenceCalculation(x.session,c.args)).toMatchObject({kind:"calculation",result:{status:"unknown",reason:"quantity_binding_or_qualification_unresolved",output:null}});
 }));
 it("rejects foreign/versioned targets, caller values and corrupt results",async()=>runCase(async x=>{
  const c=await calculationCase(x);
  await expect(executeEvidenceCalculation(x.session,{...c.args,accountId:crypto.randomUUID()})).rejects.toThrow("support_extraction_owner_or_version_mismatch");
  await expect(executeEvidenceCalculation(x.session,{...c.args,briefRevision:2})).rejects.toThrow("support_extraction_owner_or_version_mismatch");
  expect(await executeEvidenceCalculation(x.session,{...c.args,action:{...c.args.action,values:[12,8]}})).toEqual({kind:"blocked",reason:"invalid_calculation_action"});
  const result=await executeEvidenceCalculation(x.session,c.args);if(result.kind!=="calculation")throw new Error("missing calculation");
  await pool.query("UPDATE evidence_calculations SET result=jsonb_set(result,'{output,numerator}','\"999\"') WHERE id=$1",[result.id]);
  await expect(executeEvidenceCalculation(x.session,c.args)).rejects.toThrow("stored_calculation_mismatch");
 }));
 it("changed input revision invalidates the proof and account deletion removes it",async()=>runCase(async x=>{
  const c=await calculationCase(x);await executeEvidenceCalculation(x.session,c.args);
  await pool.query("UPDATE claim_revisions SET text='tampered quantity' WHERE id=$1",[c.support.checks[0]!.claimRevisionId]);
  await expect(executeEvidenceCalculation(x.session,c.args)).rejects.toThrow("stored_assertion_revision_mismatch");
  await withTx(pool,db=>deleteAccount(db,x.accountId));expect((await pool.query("SELECT id FROM evidence_calculations WHERE account_id=$1",[x.accountId])).rowCount).toBe(0);
  await expect(executeEvidenceCalculation(x.session,c.args)).rejects.toThrow("stale_worker");
 }));
 it("concurrent attempts share one durable calculation",async()=>runCase(async x=>{
  const c=await calculationCase(x);const results=await Promise.all([executeEvidenceCalculation(x.session,c.args),executeEvidenceCalculation(x.session,c.args)]);
  if(results[0]?.kind!=="calculation"||results[1]?.kind!=="calculation")throw new Error("missing calculation");
  expect(results[0].id).toBe(results[1].id);expect(results.map(r=>r.kind==="calculation"&&r.reused).sort()).toEqual([false,true]);
  expect((await pool.query("SELECT id FROM evidence_calculations WHERE run_id=$1",[x.runId])).rowCount).toBe(1);
 }));
});

async function calculationReportCase(x:Parameters<Parameters<typeof runCase>[0]>[0]) {
 const c=await calculationCase(x),calculation=await executeEvidenceCalculation(x.session,c.args);
 if(calculation.kind!=="calculation")throw new Error("missing calculation");
 const run=(await getRun(pool,x.runId))!;
 const basis={briefRevision:1,evidenceRevision:run.evidence_revision,consentEpoch:run.consent_epoch,cancellationEpoch:0,workerLeaseFence:x.fence};
 const args={accountId:x.accountId,runId:x.runId,briefRevision:1,evidenceRevision:run.evidence_revision,calculationId:calculation.id};
 const prepared=await x.session.write(db=>prepareCalculationClaim(db,args));
 if(prepared.kind!=="claim")throw new Error("missing calculation claim");
 const claim=prepared.claim;
 const report:CanonicalReport={reportId:crypto.randomUUID(),runId:x.runId,version:1,basis,outcome:"completed_with_limitations",
  blocks:[{id:"arithmetic",kind:"text",text:claim.text,claimIds:[claim.id],citationIds:claim.passageIds}],claimIds:[claim.id],
  limitations:["Arithmetic alone does not establish complete question coverage."],sourceAccessSummary:[],routeMode:"controlled-research"};
 return {c,args,prepared,report,publication:{report,accountId:x.accountId,loaded:basis,claims:[claim],passages:[],deleted:false}};
}
describe("W05 arithmetic proof at real publication",()=>{
 it("recomputes, publishes and reopens exact arithmetic with input citations and canonical lineage",async()=>runCase(async x=>{
  const c=await calculationReportCase(x),fetch=vi.fn();globalThis.fetch=fetch;
  expect(c.prepared.claim.text).toContain("(12 hectares) − (8 hectares) = 4 hectares");
  expect(c.prepared.claim.text).toContain("not establish matching scope");
  expect(await x.session.write(db=>prepareCalculationClaim(db,c.args))).toEqual(c.prepared);
  expect(await publishReport(pool,c.publication)).toMatchObject({accepted:true});
  const reopened=await getReportForAccount(pool,c.report.reportId,x.accountId);
  expect(reopened.claim_ids).toEqual([c.prepared.claim.id]);expect(reopened.blocks).toEqual(c.report.blocks);
  const inputs=await pool.query("SELECT exact_text FROM authorized_run_passages WHERE id=ANY($1::uuid[]) AND account_id=$2 AND run_id=$3",[reopened.blocks[0].citationIds,x.accountId,x.runId]);
  expect(inputs.rows).toHaveLength(2);expect(inputs.rows.every(p=>!p.exact_text.includes("4 hectares"))).toBe(true);
  expect((await pool.query("SELECT support_status FROM claims WHERE id=$1",[c.prepared.claim.id])).rows[0].support_status).toBe("inference");
  expect((await pool.query("SELECT checker_version,explanation FROM claim_evidence WHERE claim_id=$1",[c.prepared.claim.id])).rows).toEqual(expect.arrayContaining([expect.objectContaining({checker_version:"calculation-report.v1",explanation:expect.stringContaining("not direct source wording")})]));
  expect((await pool.query("SELECT scope FROM claim_revisions WHERE id=$1",[c.prepared.revisionId])).rows[0].scope.inputClaimRevisionIds).toEqual(c.c.support.checks.map(c=>c.claimRevisionId));
  expect(fetch).not.toHaveBeenCalled();
  await withTx(pool,db=>deleteAccount(db,x.accountId));
  expect((await pool.query("SELECT * FROM calculation_claims WHERE account_id=$1",[x.accountId])).rowCount).toBe(0);
 }));
 it("rejects changed wording, omitted operands/citations, type laundering and forged completion",async()=>runCase(async x=>{
  const c=await calculationReportCase(x);
  for(const patch of [{text:"The total verified restoration is 4 hectares."},{passageIds:c.prepared.claim.passageIds.slice(0,1)},{type:"external-fact"}]) {
   const claim={...c.prepared.claim,...patch};
   const report={...c.report,blocks:[{...c.report.blocks[0]!,text:claim.text,citationIds:claim.passageIds}]};
   expect((await publishReport(pool,{...c.publication,report,claims:[claim]})).accepted).toBe(false);
  }
  expect((await publishReport(pool,{...c.publication,report:{...c.report,blocks:[{...c.report.blocks[0]!,citationIds:[]}]}})).accepted).toBe(false);
  expect(await publishReport(pool,{...c.publication,report:{...c.report,outcome:"completed",limitations:[]}})).toEqual({accepted:false,reason:"incomplete_question_coverage"});
  expect((await publishReport(pool,c.publication)).accepted).toBe(true);
 }));
 it("wrong owner or basis cannot prepare a derived claim; changed stored operands invalidate publication",async()=>runCase(async x=>{
  const c=await calculationReportCase(x);
  await expect(x.session.write(db=>prepareCalculationClaim(db,{...c.args,accountId:crypto.randomUUID()}))).rejects.toThrow("calculation_publication_basis_mismatch");
  await expect(x.session.write(db=>prepareCalculationClaim(db,{...c.args,evidenceRevision:c.args.evidenceRevision+1}))).rejects.toThrow("calculation_publication_basis_mismatch");
  await pool.query("UPDATE evidence_calculations SET result=jsonb_set(result,'{output,numerator}','\"7\"') WHERE id=$1",[c.args.calculationId]);
  await expect(publishReport(pool,c.publication)).rejects.toThrow("stored_calculation_mismatch");
  expect((await pool.query("SELECT id FROM reports WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
 }));
 it("stored derivation text tampering is rejected rather than recanonicalized silently",async()=>runCase(async x=>{
  const c=await calculationReportCase(x);
  await pool.query("UPDATE claim_revisions SET text='a forged calculation' WHERE id=$1",[c.prepared.revisionId]);
  await expect(publishReport(pool,c.publication)).rejects.toThrow("calculation_claim_mismatch");
 }));
});

const calculationPlan=(action:unknown)=>({calculations:[{key:"difference",questionKeys:["q1"],action,rationale:"Compare the two reported areas arithmetically; not a shared-population total."}],unresolvedQuestionKeys:["q1"],reason:"Arithmetic does not establish survival or matching scope."});
describe("W05 structured calculation planning",()=>{
 it("uses separately versioned gateway output, executes real arithmetic and reuses both records",async()=>runCase(async x=>{
  const c=await calculationCase(x);globalThis.fetch=vi.fn(async()=>response(calculationPlan(c.args.action))) as typeof fetch;
  const first=await executeCalculationPlanning(pool,x.config,x.session,c.args);
  expect(first).toMatchObject({kind:"calculations",reused:false,executions:[{key:"difference",result:{status:"computed",output:{numerator:"4",denominator:"1"}}}]});
  if(first.kind!=="calculations")throw new Error("missing calculation plan");
  expect(await executeCalculationPlanning(pool,x.config,x.session,c.args)).toEqual({...first,reused:true});expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  expect((await pool.query("SELECT schema_version,prompt_version FROM model_operation_results WHERE intent_id=$1",[first.intentId])).rows[0]).toEqual({schema_version:"calculation-planning.v1",prompt_version:"calculation-planning-prompt.v1"});
  expect((await pool.query("SELECT id FROM evidence_calculations WHERE run_id=$1",[x.runId])).rows).toEqual([{id:first.executions[0]!.calculationId}]);
 }));
 it("unknown quantities remain executed unknown results, not model-supplied numbers",async()=>runCase(async x=>{
  const c=await calculationCase(x,true);globalThis.fetch=vi.fn(async()=>response(calculationPlan(c.args.action))) as typeof fetch;
  expect(await executeCalculationPlanning(pool,x.config,x.session,c.args)).toMatchObject({kind:"calculations",executions:[{result:{status:"unknown",output:null}}]});
 }));
 it("invalid references and injected values never create calculations",async()=>runCase(async x=>{
  const c=await calculationCase(x);globalThis.fetch=vi.fn(async()=>response(calculationPlan({...c.args.action,values:[12,8]}))) as typeof fetch;
  expect(await executeCalculationPlanning(pool,x.config,x.session,c.args)).toMatchObject({kind:"blocked",reason:"calculation_plan_invalid_output"});
  expect((await pool.query("SELECT id FROM evidence_calculations WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
  expect((await pool.query("SELECT confirmed_micro FROM provider_intents WHERE run_id=$1 AND route LIKE '%:plan_calculations'",[x.runId])).rows[0].confirmed_micro).not.toBeNull();
 }));
 it("unknown plan outcomes retain their reservation and are never resent",async()=>runCase(async x=>{
  const c=await calculationCase(x);globalThis.fetch=vi.fn(async()=>{throw new Error("connection lost");}) as typeof fetch;
  for(let i=0;i<2;i++)expect(await executeCalculationPlanning(pool,x.config,x.session,c.args)).toMatchObject({kind:"blocked",reason:"calculation_plan_outcome_unknown"});
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  const row=(await pool.query("SELECT state,confirmed_micro,reserved_max_micro FROM provider_intents WHERE run_id=$1 AND route LIKE '%:plan_calculations'",[x.runId])).rows[0];
  expect(row.state).toBe("outcome-unknown");expect(row.confirmed_micro).toBeNull();expect(Number(row.reserved_max_micro)).toBe(STRUCTURED_CALL_RESERVE_MICRO);
 }));
 it("does not introduce planning over an existing writer's unknown outcome",async()=>runCase(async x=>{
  const c=await calculationCase(x);globalThis.fetch=vi.fn(async()=>{throw new Error("unknown writer");}) as typeof fetch;
  await createResearchDraft(pool,x.config,x.session,{...c.args,sourceSupportIntentId:c.support.intentId});
  expect(await executeCalculationPlanning(pool,x.config,x.session,c.args)).toEqual({kind:"not_applicable",reason:"legacy_writer_context_preserved"});
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  expect((await pool.query("SELECT id FROM run_actions WHERE run_id=$1 AND kind='plan_calculations'",[x.runId])).rowCount).toBe(0);
 }));
});

it("W05 production worker executes selected quantities rather than a calculation progress event alone",async()=>runCase(async x=>{
 for(const [name,value] of [[`Reef-${crypto.randomUUID()}`,12],[`Kelp-${crypto.randomUUID()}`,8]] as const) {
  const sourceId=await insertSource(pool,{accountId:x.accountId,runId:x.runId,locator:`https://example.org/${name}`,title:String(name),publisher:"Control",originCluster:String(name)});
  await insertVersionAndPassage(pool,{sourceId,accountId:x.accountId,runId:x.runId,locator:`https://example.org/${name}`,text:`${name} restored ${value} hectares.`,accessLevel:"partial-text"});
 }
 const base=structuredWorkerTransport();globalThis.fetch=vi.fn(async(input:unknown,init?:RequestInit)=>{
  const request=JSON.parse(String(init?.body)),context=JSON.parse(request.messages[1].content),operation=request.response_format.json_schema.name;
  if(operation==="research_extract_assertions_v1")return response({candidates:[],assertions:context.passages.map((p:{id:string;text:string},i:number)=>({key:`area${i}`,candidateKey:null,criterionKeys:["c1"],text:p.text,scope,
   quantities:[{value:p.text.match(/restored (\d+)/)![1],unit:"hectares",currency:null,billingPeriod:null,qualifier:null}],evidence:[{passageId:p.id,start:0,end:p.text.length,quote:p.text}]})),limitations:[]});
  if(operation==="research_plan_calculations_v1")return response(calculationPlan({type:"calculate",formula:"sum",inputs:context.assertions.map((a:{key:string})=>({claimKey:a.key,quantityIndex:0}))}));
  return base(input as Parameters<typeof fetch>[0],init);
 }) as typeof fetch;
 await releaseForWorker(x);await processRun(pool,x.config,x.runId,{pauseAt:"writing"});
 expect((await getRun(pool,x.runId))!.phase).toBe("writing");
 expect((await pool.query("SELECT result FROM evidence_calculations WHERE run_id=$1",[x.runId])).rows[0].result).toMatchObject({status:"computed",output:{numerator:"20",denominator:"1"}});
 const event=(await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='calculations_executed'",[x.runId])).rows[0].payload;
 expect(event.results).toHaveLength(1);expect((await pool.query("SELECT id FROM evidence_calculations WHERE id=$1",[event.results[0].calculationId])).rowCount).toBe(1);
 const calls=vi.mocked(globalThis.fetch).mock.calls.length;
 await processRun(pool,x.config,x.runId,{pauseAt:"writing"});expect(globalThis.fetch).toHaveBeenCalledTimes(calls);
 expect((await pool.query("SELECT id FROM evidence_calculations WHERE run_id=$1",[x.runId])).rowCount).toBe(1);
 // Writer adoption is a separate integration; no derived answer or complete report is claimed here.
 expect((await pool.query("SELECT id FROM reports WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
}));


it("W02/W05 cached planning cannot ignore tampered schema/prompt/route metadata",async()=>runCase(async x=>{
 const c=await calculationCase(x);globalThis.fetch=vi.fn(async()=>response(calculationPlan(c.args.action))) as typeof fetch;
 const first=await executeCalculationPlanning(pool,x.config,x.session,c.args);if(first.kind!=="calculations")throw new Error("missing plan");
 await pool.query("UPDATE model_operation_results SET prompt_version='invented-prompt' WHERE intent_id=$1",[first.intentId]);
 expect(await executeCalculationPlanning(pool,x.config,x.session,c.args)).toEqual({kind:"blocked",reason:"invalid_stored_model_result"});
 expect(globalThis.fetch).toHaveBeenCalledTimes(1);
}));

const sumQuestion="What is the sum of the reported restored areas in these sources? Report arithmetic only.";
function arithmeticWriterTransport(options:{omitCalculation?:boolean;wrongQuantity?:boolean;unsupportedProse?:boolean}={}) {
 return vi.fn(async(_input:unknown,init?:RequestInit)=>{
  const req=JSON.parse(String(init?.body)),ctx=JSON.parse(req.messages[1].content),op=req.response_format.json_schema.name;
  if(op==="research_brief_v1") {
   const provenance={start:0,end:ctx.question.length,quote:ctx.question};
   return response({...brief,objective:ctx.question,objectiveProvenance:provenance,criteria:[{...brief.criteria[0]!,description:"Requested arithmetic on reported areas",field:"reported_area_arithmetic",provenance}],questions:[{...brief.questions[0]!,text:ctx.question}]});
  }
  if(op==="research_extract_assertions_v1")return response({candidates:[],assertions:ctx.passages.map((p:{id:string;text:string},i:number)=>({key:`area${i}`,candidateKey:null,criterionKeys:["c1"],text:p.text,scope:{...scope,entity:p.text.split(" ")[0]},
   quantities:[{value:options.wrongQuantity?"2024":p.text.match(/restored (\d+)/)![1],unit:"hectares",currency:null,billingPeriod:null,qualifier:null}],
   evidence:[{passageId:p.id,start:0,end:p.text.length,quote:p.text}]})),limitations:[]});
  if(op==="research_assess_support_v1")return response({assessments:ctx.assertions.map((a:{key:string;scope:unknown;evidence:unknown})=>({claimKey:a.key,status:"supported",scope:a.scope,evidence:a.evidence,rationale:"Nonbillable reference transport",missingEvidence:[]}))});
  if(op==="research_plan_calculations_v1")return response({calculations:[{key:"arithmetic",questionKeys:["q1"],action:{type:"calculate",formula:ctx.question.includes("ratio")?"ratio":"sum",
   inputs:[...ctx.assertions].sort((a,b)=>Number(b.quantities[0].value)-Number(a.quantities[0].value)).map(a=>({claimKey:a.key,quantityIndex:0}))},rationale:"Only the requested arithmetic on reported figures"}],unresolvedQuestionKeys:[],reason:"Applicability requires final review"});
  if(op==="research_review_coverage_v1")return response({questions:[{questionKey:"q1",status:"unresolved_at_limit",assertionKeys:ctx.approvedClaimKeys,reason:"Source figures alone do not perform requested arithmetic"}],omittedRequirements:[]});
  if(op==="research_write_calculated_report_v1")return response({title:"Reported areas",sections:[{heading:"Evidence",paragraphs:ctx.assertions.map((a:{text:string;key:string})=>({text:options.unsupportedProse?a.text+" The guaranteed total is 999 hectares.":a.text,claimKeys:[a.key]}))}],calculationKeys:options.omitCalculation?[]:["arithmetic"],unresolvedQuestionKeys:[],limitations:[]});
  if(op==="research_review_calculated_coverage_v1")return response({questions:[{questionKey:"q1",status:"supported",assertionKeys:ctx.approvedClaimKeys,calculationKeys:ctx.calculations.entries.filter((e:{selected:boolean})=>e.selected).map((e:{key:string})=>e.key),reason:"Exact requested arithmetic on cited figures, with the displayed assumptions"}],omittedRequirements:[]});
  throw new Error(`Unexpected arithmetic operation ${op}`);
 }) as typeof fetch;
}
async function arithmeticSources(x:Parameters<Parameters<typeof runCase>[0]>[0]) {
 const versions=[];
 for(const value of [12,8]) {
  const name=`Study-${crypto.randomUUID()}`,locator=`https://example.org/${name}`;
  const sourceId=await insertSource(pool,{accountId:x.accountId,runId:x.runId,locator,title:name,publisher:"Control",originCluster:name});
  versions.push(await insertVersionAndPassage(pool,{sourceId,accountId:x.accountId,runId:x.runId,locator,text:`${name} restored ${value} hectares in 2024.`,accessLevel:"partial-text"}));
 }
 return versions;
}
it("W05/W06 production arithmetic report reopens, rejects dropped output and recomputes a typed corrected ratio from the same source versions",async()=>runCase(async x=>{
 const versions=await arithmeticSources(x);globalThis.fetch=arithmeticWriterTransport();await releaseForWorker(x);
 await processRun(pool,x.config,x.runId);
 const parent=(await pool.query("SELECT * FROM reports WHERE run_id=$1",[x.runId])).rows[0];
 expect(parent?.outcome).toBe("completed");expect(parent.blocks.find((b:{id:string})=>b.id==="calculation_0").text).toContain("= 20 hectares");
 const report:CanonicalReport={reportId:parent.id,runId:x.runId,version:parent.version,basis:parent.basis,outcome:parent.outcome,blocks:parent.blocks,claimIds:parent.claim_ids,limitations:parent.limitations,sourceAccessSummary:parent.source_access_summary,routeMode:parent.route_mode};
 expect(await reportCompletionCovered(pool,x.accountId,report)).toBe(true);
 expect(await reportCompletionCovered(pool,x.accountId,{...report,blocks:report.blocks.filter(b=>b.id!=="calculation_0")})).toBe(false);
 const child=await admitResearchCorrection(pool,x.accountId,x.runId,correctionInput("What is the ratio of the larger reported restored area to the smaller one? Report arithmetic only."));
 const locator=(await pool.query("SELECT canonical_locator FROM sources WHERE run_id=$1 ORDER BY id LIMIT 1",[x.runId])).rows[0].canonical_locator;
 globalThis.fetch=correctionDiscovery(arithmeticWriterTransport(),locator);const reread=vi.spyOn(sourceReader,"readSource");
 await processRun(pool,{...x.config,structuredDiscoveryEnabled:true,liveRetrievalEnabled:true},child.runId);
 expect(reread).not.toHaveBeenCalled();await expectCorrectionSearch(child.runId);
 const revised=(await pool.query("SELECT * FROM reports WHERE run_id=$1",[child.runId])).rows[0];
 expect(revised?.outcome).toBe("completed");expect(revised.blocks.find((b:{id:string})=>b.id==="calculation_0").text).toContain("= 3/2 ratio");
 const cited=revised.blocks.flatMap((b:{citationIds:string[]})=>b.citationIds);
 expect([...new Set(cited)].sort()).toEqual(versions.map(v=>v.passageId).sort());
 expect(revised.claim_ids.some((id:string)=>parent.claim_ids.includes(id))).toBe(false);
 expect(revised.change_summary.comparison.reusedCitedSourceVersionIds.sort()).toEqual(versions.map(v=>v.versionId).sort());
 expect((await pool.query("SELECT id FROM sources WHERE run_id=$1",[child.runId])).rowCount).toBe(0);
 await mkdir("/tmp/deep-v6-evidence",{recursive:true});
 await writeFile("/tmp/deep-v6-evidence/calculated-report-journey.json",JSON.stringify({
  evidenceClass:"local_postgres_production_worker_with_fabricated_model_transport",requirements:["W05","W06"],
  limitations:["Source rows are synthetic; this arithmetic control does not run HTML/PDF extraction.","Model responses and cost receipts are fabricated; no live semantic quality, paid cost or human adjudication claim."],
  reference:{inputs:[12,8],initialQuestion:sumQuestion,expectedSum:"20 hectares",correctedQuestion:"ratio of larger to smaller",expectedRatio:"3/2"},
  parentReport:parent,correctedReport:revised,
  passages:(await pool.query("SELECT id,run_id,source_version_id,exact_text,content_hash FROM passages WHERE account_id=$1",[x.accountId])).rows,
  revisions:(await pool.query("SELECT id,claim_id,run_id,text,scope FROM claim_revisions WHERE account_id=$1",[x.accountId])).rows,
  support:(await pool.query("SELECT model_intent_id,claim_revision_id,checker_version,evidence_digest,scope_digest,decision,result FROM scoped_support_results WHERE account_id=$1",[x.accountId])).rows,
  calculations:(await pool.query("SELECT * FROM evidence_calculations WHERE account_id=$1",[x.accountId])).rows,
  coverage:(await pool.query("SELECT * FROM calculated_report_coverage WHERE account_id=$1",[x.accountId])).rows,
  memberships:(await pool.query("SELECT * FROM run_evidence_membership WHERE account_id=$1",[x.accountId])).rows,
 },null,2)+"\n");
 await withTx(pool,db=>deleteAccount(db,x.accountId));
 for(const table of ["calculation_plans","calculated_report_coverage","calculation_claims","evidence_calculations"])expect((await pool.query(`SELECT * FROM ${table} WHERE account_id=$1`,[x.accountId])).rowCount).toBe(0);
// Two full production runs plus independent publication rechecks measured 28.2s locally;
// allow scheduling headroom without changing any correctness assertions.
},sumQuestion),60_000);
it.each(["omitCalculation","wrongQuantity","unsupportedProse"] as const)("W05 calculated writer remains limited for %s despite a positive review",async option=>runCase(async x=>{
 await arithmeticSources(x);globalThis.fetch=arithmeticWriterTransport({[option]:true});await releaseForWorker(x);await processRun(pool,x.config,x.runId);
 const report=(await pool.query("SELECT * FROM reports WHERE run_id=$1",[x.runId])).rows[0];
 expect(report?.outcome).toBe("completed_with_limitations");
 expect(report.blocks.some((b:{text:string})=>b.text.includes("guaranteed total"))).toBe(false);
 if(option==="unsupportedProse")expect(report.blocks.find((b:{id:string})=>b.id==="calculation_0").text).toContain("= 20 hectares");
},sumQuestion));

async function counterevidenceCase(x:Parameters<Parameters<typeof runCase>[0]>[0]) {
 const c=await supportCase(x);globalThis.fetch=vi.fn(async()=>response(c.proposal)) as typeof fetch;
 const checked=await executeAssertionSupport(pool,x.config,x.session,c.args);if(checked.kind!=="support")throw new Error("missing initial support");
 const config={...x.config,structuredChallengeEnabled:true,structuredDiscoveryEnabled:true,liveRetrievalEnabled:true};
 return {...c,config,args:{...c.args,supportIntentId:checked.intentId},checked};
}
function counterevidenceTransport() {
 return vi.fn(async(_input:unknown,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));if(body.plugins?.length)return searchReply(true,"https://example.org/counterevidence");
  const ctx=JSON.parse(body.messages[1].content);
  return response({assessments:ctx.assertions.map((a:{key:string;scope:unknown;evidence:unknown})=>({claimKey:a.key,status:"supported",scope:a.scope,evidence:a.evidence,rationale:"Optimistic nonbillable control",missingEvidence:[]}))});
 }) as typeof fetch;
}
describe("W05 counterevidence execution",()=>{
 it.each(["contradictory","supportive","qualified"])("executes search, read and exact original-target support: %s",async(kind)=>runCase(async x=>{
  const c=await counterevidenceCase(x),original=c.output.assertions[0]!.text;
  globalThis.fetch=counterevidenceTransport();const read=vi.spyOn(sourceReader,"readSource").mockImplementation(async url=>readControl(url,kind==="contradictory"?original.replace("restored","did not restore"):kind==="qualified"?original.replace("restored","may have restored"):original));
  const first=await executeCounterevidence(pool,c.config,x.session,c.args);
  expect(first).toMatchObject({kind:"challenge",outcome:kind==="supportive"?"no_counterevidence_found_in_inspected_evidence":"counterevidence_found",evidenceChanged:true});
  const row=(await pool.query("SELECT * FROM counterevidence_checks WHERE run_id=$1",[x.runId])).rows[0];
  expect(row.targets[0].claimRevisionId).toBe(c.checked.checks[0]!.claimRevisionId);expect(row.result[0].claimKey).toBe("area");expect(row.evidence_digest).toMatch(/^[a-f0-9]{64}$/);
  expect(await executeCounterevidence(pool,c.config,x.session,c.args)).toMatchObject({...first,evidenceChanged:false});expect(read).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(2);
  const limitations=await counterevidenceLimitations(pool,c.args);expect(limitations.length).toBe(kind==="supportive"?0:1);if(kind!=="supportive")expect(limitations[0]).toContain(original);
  await withTx(pool,db=>deleteAccount(db,x.accountId));expect((await pool.query("SELECT 1 FROM counterevidence_checks WHERE account_id=$1",[x.accountId])).rowCount).toBe(0);
 }));
 it("preserves unknown search reservation and does not resend on replay",async()=>runCase(async x=>{
  const c=await counterevidenceCase(x);globalThis.fetch=vi.fn(async()=>searchReply(false)) as typeof fetch;
  expect(await executeCounterevidence(pool,c.config,x.session,c.args)).toMatchObject({kind:"challenge",outcome:"outcome_unknown"});
  expect(await executeCounterevidence(pool,c.config,x.session,c.args)).toMatchObject({kind:"challenge",outcome:"outcome_unknown"});expect(fetch).toHaveBeenCalledTimes(1);
  expect((await pool.query("SELECT i.state,i.reserved_max_micro FROM provider_intents i JOIN run_actions a ON a.id=i.action_id WHERE i.run_id=$1 AND a.kind='search'",[x.runId])).rows).toMatchObject([{state:"outcome-unknown"}]);
  expect((await counterevidenceLimitations(pool,c.args))[0]).toContain("search_outcome_unknown");
 }));
 it("rejects changed target revision and foreign owner before a new request",async()=>runCase(async x=>{
  const c=await counterevidenceCase(x);globalThis.fetch=counterevidenceTransport();vi.spyOn(sourceReader,"readSource").mockImplementation(async url=>readControl(url,c.output.assertions[0]!.text));
  await executeCounterevidence(pool,c.config,x.session,c.args);const calls=vi.mocked(fetch).mock.calls.length;
  await expect(counterevidenceContext(pool,{...c.args,accountId:crypto.randomUUID()})).rejects.toThrow("challenge_missing");
  await pool.query("UPDATE claim_revisions SET text_digest=repeat('0',64) WHERE id=$1",[c.checked.checks[0]!.claimRevisionId]);
  await expect(executeCounterevidence(pool,c.config,x.session,c.args)).rejects.toThrow("challenge_original_target_changed");expect(fetch).toHaveBeenCalledTimes(calls);
 }));
 it("rejects transformed private terms while allowing only the closed public suffix",async()=>runCase(async x=>{
  const c=await searchCase(x),proposal=counterevidenceSearch(question,["q1"])!;globalThis.fetch=vi.fn() as typeof fetch;
  await expect(performPublicSearch(pool,{...c.config,structuredChallengeEnabled:true},x.session,{...c.args,proposal:{...proposal,action:{...proposal.action,query:proposal.action.query+" SECRET_CANARY"}}})).rejects.toThrow("invalid_counterevidence_query_transform");expect(fetch).not.toHaveBeenCalled();
 }));
});
it.each([{contradiction:true,linked:true},{contradiction:false,linked:true},{contradiction:true,linked:false},{contradiction:false,linked:false}])("W05 counterevidence production preserves original target when re-extraction omits it; contradiction=$contradiction linked=$linked",async({contradiction,linked})=>runCase(async x=>{
 const entity=`Study-${crypto.randomUUID()}`,original=`${entity} supports offline editing.`,secondary="A separate observation describes online editing.";
 const sourceId=await insertSource(pool,{accountId:x.accountId,runId:x.runId,locator:"https://example.org/initial",title:"Initial evidence",publisher:"Study",originCluster:"initial"});
 await insertVersionAndPassage(pool,{sourceId,accountId:x.accountId,runId:x.runId,locator:"https://example.org/initial",text:original,accessLevel:"partial-text"});
 const normal=structuredWorkerTransport();let extractionCalls=0;
 globalThis.fetch=vi.fn(async(input,init)=>{
  const body=JSON.parse(String(init?.body));if(body.plugins?.length)return searchReply(true,"https://example.org/challenge");
  const ctx=JSON.parse(body.messages[1].content),op=body.response_format.json_schema.name;
  if(op==="research_extract_assertions_v1") {
   extractionCalls++;const p=extractionCalls===1?ctx.passages.find((p:{text:string})=>p.text===original):ctx.passages.find((p:{text:string})=>p.text.includes(secondary));
   const text=extractionCalls===1?original:secondary,start=p.text.indexOf(text);
   return response({candidates:[],assertions:[{key:extractionCalls===1?"original":"replacement",candidateKey:null,criterionKeys:["c1"],text,scope:{...scope,entity:extractionCalls===1?entity:null},quantities:[],evidence:[{passageId:p.id,start,end:start+text.length,quote:text}]}],limitations:[]});
  }
  if(op==="research_review_coverage_v1")return response({questions:[{questionKey:"q1",status:"supported",assertionKeys:ctx.approvedClaimKeys,reason:"Optimistic boundary control"}],omittedRequirements:[]});
  if(op==="research_write_report_v1")return response({title:"Findings",sections:[{heading:"Evidence",paragraphs:ctx.assertions.filter((a:{key:string})=>ctx.approvedClaimKeys.includes(a.key)).map((a:{key:string;text:string})=>({text:a.text,claimKeys:[a.key]}))}],unresolvedQuestionKeys:[],limitations:[]});
  return normal(input,init);
 }) as typeof fetch;
 vi.spyOn(sourceReader,"readSource").mockImplementation(async url=>readControl(url,`${contradiction?original.replace("supports","does not support"):original} ${secondary}`));
 await releaseForWorker(x);const enabled={...x.config,structuredChallengeEnabled:true,structuredDiscoveryEnabled:true,liveRetrievalEnabled:true};
 await processRun(pool,enabled,x.runId,{pauseAt:"writing"});
 // Crash boundary: reads and provider receipts survived, but challenge completion was not checkpointed.
 await pool.query("UPDATE counterevidence_checks SET state='planned',read_operations='[]',result=NULL,model_intent_id=NULL,outcome=NULL,evidence_revision=NULL,evidence_digest=NULL,context_manifest=NULL,checker_version=NULL WHERE run_id=$1",[x.runId]);
 // Earlier crash boundary: the search result committed before its challenge pointer was saved.
 if(!linked)await pool.query("UPDATE counterevidence_checks SET search_intent_id=NULL WHERE run_id=$1",[x.runId]);
 await processRun(pool,enabled,x.runId);
 expect(sourceReader.readSource).toHaveBeenCalledTimes(1);
 expect(vi.mocked(fetch).mock.calls.filter(([,init])=>JSON.parse(String(init?.body)).plugins?.length)).toHaveLength(1);
 const report=(await pool.query("SELECT * FROM reports WHERE run_id=$1",[x.runId])).rows[0];expect(report).toBeDefined();
 expect((await getRun(pool,x.runId))!.terminal_outcome).toBe(contradiction?"completed_with_limitations":"completed");
 expect(extractionCalls).toBe(2);expect(JSON.stringify(report.blocks)).toContain(secondary);
 const challenge=(await pool.query("SELECT targets,result,outcome FROM counterevidence_checks WHERE run_id=$1",[x.runId])).rows[0];expect(challenge.targets[0].assertion.text).toBe(original);
 expect(challenge.outcome).toBe(contradiction?"counterevidence_found":"no_counterevidence_found_in_inspected_evidence");
 if(contradiction) {
  expect(report.limitations.join(" ")).toContain(original);
  const canonical:CanonicalReport={reportId:report.id,runId:x.runId,version:report.version,basis:report.basis,outcome:report.outcome,blocks:report.blocks,claimIds:report.claim_ids,limitations:report.limitations,sourceAccessSummary:report.source_access_summary,routeMode:report.route_mode};
  expect(await reportCompletionCovered(pool,x.accountId,canonical)).toBe(true);
  expect(await reportCompletionCovered(pool,x.accountId,{...canonical,limitations:[]})).toBe(false);
  expect(await reportCompletionCovered(pool,x.accountId,{...canonical,limitations:["Some requested questions remain unresolved."]})).toBe(false);
  await pool.query("UPDATE counterevidence_checks SET result='[]' WHERE run_id=$1",[x.runId]);
  await expect(reportCompletionCovered(pool,x.accountId,canonical)).rejects.toThrow("stored_challenge_result_mismatch");
 }
 else {
  const canonical:CanonicalReport={reportId:report.id,runId:x.runId,version:report.version,basis:report.basis,outcome:report.outcome,blocks:report.blocks,claimIds:report.claim_ids,limitations:report.limitations,sourceAccessSummary:report.source_access_summary,routeMode:report.route_mode};
  expect(await reportCompletionCovered(pool,x.accountId,canonical)).toBe(true);
  await pool.query("DELETE FROM counterevidence_checks WHERE run_id=$1",[x.runId]);
  expect(await reportCompletionCovered(pool,x.accountId,canonical)).toBe(false);
  expect((await counterevidenceLimitations(pool,{...x,briefRevision:1}))[0]).toContain("required counterevidence check cannot be restored");
 }
}));
it("W05 counterevidence limited publication fails closed when required proof is lost, even with a warning",async()=>runCase(async x=>{
 const c=await scopedReportCase(x);
 await pool.query("UPDATE runs SET counterevidence_required_revision=1 WHERE id=$1",[x.runId]);
 expect(await publishReport(pool,c.publication)).toEqual({accepted:false,reason:"incomplete_question_coverage"});
 expect(await publishReport(pool,{...c.publication,report:{...c.report,limitations:["Some requested questions remain unresolved."]}})).toEqual({accepted:false,reason:"incomplete_question_coverage"});
 expect((await pool.query("SELECT 1 FROM reports WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
 const limitations=await counterevidenceLimitations(pool,{...x,briefRevision:1});
 expect(limitations).toHaveLength(1);
 expect(await publishReport(pool,{...c.publication,report:{...c.report,limitations}})).toEqual({accepted:false,reason:"incomplete_question_coverage"});
 expect((await pool.query("SELECT 1 FROM reports WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
}));
it.each(["cancel","delete"])("W05 counterevidence rejects late source content after %s",async(action)=>runCase(async x=>{
 const c=await counterevidenceCase(x);globalThis.fetch=counterevidenceTransport();
 vi.spyOn(sourceReader,"readSource").mockImplementation(async url=>{
  if(action==="delete")await withTx(pool,db=>deleteAccount(db,x.accountId));else await cancelRun(pool,x.runId);
  return readControl(url,c.output.assertions[0]!.text);
 });
 await expect(executeCounterevidence(pool,c.config,x.session,c.args)).rejects.toThrow(LostWorkerLease);
 expect((await pool.query("SELECT 1 FROM counterevidence_checks WHERE run_id=$1 AND state='checked'",[x.runId])).rowCount).toBe(0);
 expect((await pool.query("SELECT 1 FROM extraction_receipts WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
 if(action==="delete")expect((await pool.query("SELECT 1 FROM counterevidence_checks WHERE run_id=$1",[x.runId])).rowCount).toBe(0);
}));
it("W05 counterevidence cannot replace its real result with an optimistic stored flag",async()=>runCase(async x=>{
 const c=await counterevidenceCase(x);globalThis.fetch=counterevidenceTransport();vi.spyOn(sourceReader,"readSource").mockImplementation(async url=>readControl(url,c.output.assertions[0]!.text.replace("restored","did not restore")));
 await executeCounterevidence(pool,c.config,x.session,c.args);
 await pool.query("UPDATE counterevidence_checks SET outcome='no_counterevidence_found_in_inspected_evidence',result='[]' WHERE run_id=$1",[x.runId]);
 await expect(counterevidenceLimitations(pool,c.args)).rejects.toThrow("stored_challenge_result_mismatch");
}));
it("W05 counterevidence retains an unknown support outcome without another model send",async()=>runCase(async x=>{
 const c=await counterevidenceCase(x);let models=0;
 globalThis.fetch=vi.fn(async(_input,init)=>{
  const body=JSON.parse(String(init?.body));if(body.plugins?.length)return searchReply(true,"https://example.org/counterevidence");models++;
  return new Response(JSON.stringify({id:"unknown-support",model:"openai/gpt-4o-mini",provider:"OpenAI",choices:[{finish_reason:"stop",message:{content:"{}"}}]}));
 }) as typeof fetch;
 vi.spyOn(sourceReader,"readSource").mockImplementation(async url=>readControl(url,c.output.assertions[0]!.text));
 expect(await executeCounterevidence(pool,c.config,x.session,c.args)).toMatchObject({kind:"challenge",outcome:"outcome_unknown"});
 expect(await executeCounterevidence(pool,c.config,x.session,c.args)).toMatchObject({kind:"challenge",outcome:"outcome_unknown"});expect(models).toBe(1);
 expect((await pool.query("SELECT state FROM provider_intents WHERE run_id=$1 AND state='outcome-unknown'",[x.runId])).rows).toHaveLength(1);
}));
it("W05 counterevidence race cannot double-send its search and shares the three-query ceiling",async()=>runCase(async x=>{
 const c=await counterevidenceCase(x);let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(r=>entered=r),waiting=new Promise<void>(r=>release=r);
 const normal=counterevidenceTransport();let searches=0;
 globalThis.fetch=vi.fn(async(input,init)=>{
  if(JSON.parse(String(init?.body)).plugins?.length){searches++;entered();await waiting;}return normal(input,init);
 }) as typeof fetch;
 vi.spyOn(sourceReader,"readSource").mockImplementation(async url=>readControl(url,c.output.assertions[0]!.text));
 const first=executeCounterevidence(pool,c.config,x.session,c.args);await started;
 try {expect(await executeCounterevidence(pool,c.config,x.session,c.args)).toMatchObject({kind:"challenge",outcome:"outcome_unknown"});}finally{release();}
 expect(await first).toMatchObject({kind:"challenge",outcome:"no_counterevidence_found_in_inspected_evidence"});expect(searches).toBe(1);
 globalThis.fetch=vi.fn(async()=>searchReply()) as typeof fetch;
 const searchArgs={...c.args,proposal:{rationale:"Boundary control",action:{type:"search" as const,query:"coral",questionKeys:["q1"],publicQueryBasis:span}}};
 expect(await performPublicSearch(pool,c.config,x.session,searchArgs)).toMatchObject({kind:"search"});
 expect(await performPublicSearch(pool,c.config,x.session,{...searchArgs,proposal:{...searchArgs.proposal,action:{...searchArgs.proposal.action,query:"kelp"}}})).toMatchObject({kind:"search"});
 expect(await performPublicSearch(pool,c.config,x.session,{...searchArgs,proposal:{...searchArgs.proposal,action:{...searchArgs.proposal.action,query:"restoration"}}})).toEqual({kind:"blocked",reason:"discovery_query_limit"});
}));
it("W05 counterevidence disabled legacy run needs no proof, but an event alone cannot satisfy an admitted check",async()=>runCase(async x=>{
 expect(await counterevidenceLimitations(pool,{...x,briefRevision:1})).toEqual([]);
 const c=await counterevidenceCase(x);
 expect(await executeCounterevidence(pool,{...c.config,structuredChallengeEnabled:false},x.session,c.args)).toEqual({kind:"not_applicable",reason:"counterevidence_disabled"});
 expect(await counterevidenceLimitations(pool,c.args)).toEqual([]);
 await x.session.write(db=>emitEvent(db,{runId:x.runId,accountId:x.accountId,type:"counterevidence_checked",phase:"researching",summary:"Test-only optimistic event without execution",payload:{outcome:"no_counterevidence_found_in_inspected_evidence"}}));
 expect((await counterevidenceLimitations(pool,c.args))[0]).toContain("required counterevidence check cannot be restored");
 await pool.query("UPDATE runs SET counterevidence_required_revision=1 WHERE id=$1",[x.runId]);
 expect((await counterevidenceLimitations(pool,c.args))[0]).toContain("required counterevidence check cannot be restored");
 await expect(executeCounterevidence(pool,c.config,x.session,c.args)).rejects.toThrow("required_challenge_proof_missing");
}));

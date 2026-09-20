import { executeDocumentReconciliation } from "../src/worker/document-reconciliation.js";
import { extractEvidenceAssertions } from "../src/worker/assertion-extraction.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { CreateRunRequestSchema } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { claimLease } from "../src/modules/runs.js";
import { fencedSession, type FencedSession } from "../src/worker/fenced-session.js";
import { loadConfig } from "../src/platform/config.js";
import { ensureResearchTask } from "../src/worker/research-task.js";
import { performPublicSearch } from "../src/worker/public-search.js";
import { adoptSearchSources } from "../src/modules/search-sources.js";
import { persistFreshnessPolicy, persistReconciliation, persistSearchCoverage, loadRunStoredSources, queryAuthorizationDigest, recordQueryAuthorization, approveQueryAuthorization, pendingQueryAuthorization, hasPublicQueryApproval, loadApprovedPrivateTerms } from "../src/modules/retrieval-intelligence.js";
import { prepareEvidenceSelection } from "../src/modules/evidence-selections.js";
import { counterevidenceSearch, authorizePublicQuery, freshnessPolicyForQuestion, reconcileDocumentClaim, recordSearchCoverage, sourcesHaveUnmetFreshness } from "@deep/research-core";
import { insertSource,insertVersionAndPassage } from "../src/modules/evidence.js";

const originalFetch = globalThis.fetch;
let pool: pg.Pool;
beforeAll(async () => {
  pool = createPool(process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test");
  await migrate(pool);
});
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
afterAll(async () => { await pool.end(); });

const question = "Compare coral and kelp restoration.";
const span = { start: 0, end: question.length, quote: question };
const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
const brief = {
  objective: question, objectiveProvenance: span, intendedOutput: "comparison",
  criteria: [{ key: "c1", description: "Compare restoration", field: "restoration", operator: "compare", value: null, unit: null,
    importance: "hard", scope, provenance: span, group: "g1", groupOperator: "all", unresolvedAlternatives: [] }],
  questions: [{ key: "q1", text: question, criterionKeys: ["c1"], importance: "critical", evidenceStandard: "documented outcomes" }],
  assumptions: [], openAmbiguities: [], explicitExclusions: [],
};
const response = (output: unknown = brief) => new Response(JSON.stringify({
  id: "provider-test-id", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000001" },
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }],
}), { status: 200 });
function searchReply(url = "https://example.org/study", content = "Restoration findings") {
  return new Response(JSON.stringify({
    id: "nonbillable-search", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000003" },
    choices: [{ finish_reason: "stop", message: { annotations: [{ type: "url_citation", url_citation: { url, title: "Study", content } }] } }],
  }));
}

async function runCase(test: (x: { runId: string; accountId: string; fence: number; session: FencedSession; config: ReturnType<typeof loadConfig> }) => Promise<void>) {
  const accountId = await withTx(pool, async (db) => { const s = await createDevSession(db); await grantConsent(db, s.accountId); return s.accountId; });
  const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question, routeMode: "controlled-research" }));
  const owner = crypto.randomUUID(); const fence = (await claimLease(pool, runId, owner, 30_000))!;
  const session = fencedSession(pool, { runId, accountId, owner, fence, briefRevision: 1, leaseMs: 30_000 });
  const config = loadConfig({ DATABASE_URL: "postgres://localhost/test", LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true",
    OPENROUTER_API_KEY: "nonbillable-test-key", LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_SPEND_CAP_MICRO: "1000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() });
  try { await test({ runId, accountId, fence, session, config }); }
  finally {
    session.stop();
    await deleteAccount(pool, accountId);
  }
}

async function searchArgs(x: { runId: string; accountId: string; fence: number; session: FencedSession; config: ReturnType<typeof loadConfig> }) {
  globalThis.fetch = vi.fn(async () => response(brief)) as typeof fetch;
  const task = await ensureResearchTask(pool, x.config, x.session, { ...x, briefRevision: 1 });
  if (task.kind !== "task") throw new Error("missing task");
  return {
    args: { ...x, briefRevision: 1, taskId: task.task.id, proposal: { rationale: "Investigate public restoration evidence", action: { type: "search", query: "coral kelp restoration", questionKeys: ["q1"], publicQueryBasis: span } } },
    config: { ...x.config, structuredDiscoveryEnabled: true },
  };
}

describe("Phase A scoped public/document reconciliation",()=>{
 it("ENG-025/026 uses public-only semantic evidence and records every claim including unassessed ones",async()=>runCase(async x=>{
  const c=await searchArgs(x);
  const text="Coral restored 12 hectares in 2024.";
  const privateSource=await insertSource(pool,{accountId:x.accountId,runId:x.runId,locator:`attachment://${crypto.randomUUID()}`,title:"Synthetic private statement",publisher:"Test",originCluster:"private"});
  const doc=await insertVersionAndPassage(pool,{sourceId:privateSource,accountId:x.accountId,runId:x.runId,locator:"private:1",text,accessLevel:"partial-text"});
  const publicSource=await insertSource(pool,{accountId:x.accountId,runId:x.runId,locator:"https://example.org/study",title:"Public study",publisher:"Test",originCluster:"public"});
  const pub=await insertVersionAndPassage(pool,{sourceId:publicSource,accountId:x.accountId,runId:x.runId,locator:"public:1",text,accessLevel:"partial-text"});
  const assertions=Array.from({length:9},(_,i)=>({key:`claim_${i}`,candidateKey:null,criterionKeys:["c1"],text,scope,quantities:[],evidence:[{passageId:doc.passageId,start:0,end:text.length,quote:text}]}));
  globalThis.fetch=vi.fn(async()=>response({candidates:[],assertions,limitations:[]})) as typeof fetch;
  const extracted=await extractEvidenceAssertions(pool,x.config,x.session,{...c.args,passageIds:[doc.passageId,pub.passageId]});
  if(extracted.kind!=="extraction")throw new Error("extraction failed");
  globalThis.fetch=vi.fn(async(_url,init)=>{
    const context=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    expect(context.passages.map((p:{id:string})=>p.id)).toEqual([pub.passageId]);
    const a=context.assertions[0];
    return response({assessments:[{claimKey:a.key,status:"supported",scope:a.scope,evidence:[{passageId:pub.passageId,start:0,end:text.length,quote:text}],rationale:"The public study confirms this scoped observation.",missingEvidence:[]}]});
  }) as typeof fetch;
  const args={...c.args,extractionIntentId:extracted.intentId};
  expect(await executeDocumentReconciliation(pool,x.config,x.session,args)).toEqual({kind:"reconciled",count:9});
  expect(globalThis.fetch).toHaveBeenCalledTimes(8);
  expect(await executeDocumentReconciliation(pool,x.config,x.session,args)).toEqual({kind:"reconciled",count:9});
  expect(globalThis.fetch).toHaveBeenCalledTimes(8);
  const rows=(await pool.query("SELECT claim_key,outcome,source_scope FROM document_web_reconciliations WHERE run_id=$1 ORDER BY claim_key",[x.runId])).rows;
  expect(rows).toHaveLength(9);
  expect(rows.slice(0,8).every(r=>r.outcome==="confirmed")).toBe(true);
  expect(rows[8]).toMatchObject({outcome:"unverifiable",source_scope:{modelIntentIds:[],omittedPassageIds:[pub.passageId]}});
 }));
});

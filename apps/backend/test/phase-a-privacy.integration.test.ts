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
import { runRemainingBudgetMicro } from "../src/modules/live-spend.js";
import { getRun } from "../src/modules/runs.js";
import { prepareEvidenceSelection } from "../src/modules/evidence-selections.js";
import { counterevidenceSearch, authorizePublicQuery, freshnessPolicyForQuestion, reconcileDocumentClaim, recordSearchCoverage, sourcesHaveUnmetFreshness } from "@deep/research-core";
import { insertSource } from "../src/modules/evidence.js";

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

describe("Phase A exact outbound privacy authority", () => {
  it("ENG-010 requires suffix-specific approval and replays the exact approved challenge without sending twice", async () => runCase(async x => {
    const attachmentId=crypto.randomUUID();
    await pool.query(`INSERT INTO attachments(id,account_id,filename,mime,size_bytes,storage_ptr,sha256,extracted_text,processing_state)
      VALUES($1,$2,'synthetic.txt','text/plain',12,'db:synthetic',repeat('a',64),'Synthetic private canary CANARY:NEVER_SEND','ready')`,[attachmentId,x.accountId]);
    await pool.query(`UPDATE research_briefs SET payload=jsonb_set(payload,'{attachmentIds}',$2::jsonb) WHERE id=(SELECT brief_id FROM runs WHERE id=$1)`,[x.runId,JSON.stringify([attachmentId])]);
    const c=await searchArgs(x);
    const proposal=counterevidenceSearch(question,["q1"])!;
    globalThis.fetch=vi.fn(async()=>searchReply()) as typeof fetch;
    const config={...c.config,structuredChallengeEnabled:true};
    const args={...c.args,proposal};
    await expect(performPublicSearch(pool,config,x.session,args)).rejects.toThrow("document_search_requires_public_query_approval");
    const pending=await pendingQueryAuthorization(pool,{...x,briefRevision:1});
    expect(pending?.proposedQuery).toBe(proposal.action.query);
    expect(pending?.queryDigest).toBe(queryAuthorizationDigest(proposal.action.query));
    expect(pending?.queryDigest).not.toBe(queryAuthorizationDigest(question));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(await approveQueryAuthorization(pool,{...x,briefRevision:1,authorizationId:pending!.id,queryDigest:pending!.queryDigest,terms:pending!.terms})).toEqual({ok:true});
    const first=await performPublicSearch(pool,config,x.session,args);
    expect(first.kind).toBe("search");
    expect(await performPublicSearch(pool,config,x.session,args)).toMatchObject({kind:"search",reused:true});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const sent=JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]![1]?.body));
    expect(sent.messages[1].content).toContain(proposal.action.query);
    expect(JSON.stringify(sent)).not.toContain("NEVER_SEND");
    await expect(performPublicSearch(pool,config,x.session,c.args)).rejects.toThrow("document_search_requires_public_query_approval");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }));
  it("ENG-010 exact approval identity preserves punctuation, repetition and ordering",()=>{
    const queries=["not not approved", "not approved", "approved not", "approved?", "approved!"];
    expect(new Set(queries.map(queryAuthorizationDigest)).size).toBe(queries.length);
  });
  it("ENG-012 remaining budget uses confirmed spend and unknown holds, not a lagging spent_micro snapshot", async () => runCase(async x => {
    const budget = Number((await getRun(pool, x.runId))!.budget_micro);
    await pool.query("UPDATE runs SET spent_micro=0 WHERE id=$1", [x.runId]);
    const confirmedId=crypto.randomUUID();
    const heldId=crypto.randomUUID();
    await pool.query(`INSERT INTO provider_intents(id,run_id,correlation_id,route,request_digest,reserved_max_micro,state,confirmed_micro)
      VALUES($1,$2,$3,'openrouter:test',$4,40000,'confirmed',40000)`, [confirmedId, x.runId, confirmedId, "a".repeat(64)]);
    await pool.query(`INSERT INTO provider_intents(id,run_id,correlation_id,route,request_digest,reserved_max_micro,state,confirmed_micro)
      VALUES($1,$2,$3,'openrouter:test',$4,25000,'outcome-unknown',NULL)`, [heldId, x.runId, heldId, "b".repeat(64)]);
    expect(await runRemainingBudgetMicro(pool, x)).toBe(budget - 65000);
    expect(Number((await getRun(pool, x.runId))!.spent_micro)).toBe(0);
  }));
});

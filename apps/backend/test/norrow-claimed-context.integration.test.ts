import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { createHash } from "node:crypto";
import { canonicalGuestPendingPayload, CONSENT_POLICY_VERSION } from "@deep/contracts";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";
import { claimLease, getBrief, getRun } from "../src/modules/runs.js";
import { insertSource, insertVersionAndPassage } from "../src/modules/evidence.js";
import { prepareClaimedResearchContext } from "../src/modules/run-evidence.js";
import { processStructuredResearch } from "../src/worker/structured-research.js";
import { fencedSession, type FencedSession } from "../src/worker/fenced-session.js";
import { ensureResearchTask } from "../src/worker/research-task.js";
import { performPublicSearch } from "../src/worker/public-search.js";

const url = process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
const config = loadConfig({ DATABASE_URL: url, NODE_ENV: "test", APP_AUTH_MODE: "development",
  NORROW_GUEST_BOOTSTRAP_ENABLED: "true", NORROW_GUEST_PROOF_PEPPER: "nonsecret-isolated-test-pepper-1234567890",
  DEV_ALLOW_FIXTURE_ROUTE: "true" });
let pool: pg.Pool;
let boss: PgBoss;
let app: FastifyInstance;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  pool = createPool(url);
  await migrate(pool);
  boss = await createQueue(url);
  app = await buildApp({ pool,boss,config });
});
beforeEach(async () => {
  await pool.query("TRUNCATE accounts CASCADE");
  await pool.query("TRUNCATE guest_bootstrap_limits");
  await pool.query(`UPDATE guest_sponsor_policies SET enabled=true,killed=false,expires_at=now()+interval '1 day',
    exposure_cap_micro=100000,per_guest_cap_micro=100000,bootstrap_limit_per_risk=10
    WHERE id='norrow-guest-first.v1'`);
  await pool.query("UPDATE guest_sponsor_ledgers SET settled_micro=0,reserved_micro=0,held_micro=0 WHERE policy_id='norrow-guest-first.v1'");
});
afterAll(async () => {
  await app.close();
  await boss.stop({ graceful:false,timeout:2000 });
  await pool.end();
});
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

async function claimedFollowUp(locator = "https://example.org/laptop-review",kind: "follow_up" | "new_research" = "follow_up") {
  const bootstrap = await app.inject({ method:"POST",url:"/v1/guest/bootstrap",payload:{} });
  expect(bootstrap.statusCode).toBe(201);
  const guest = bootstrap.json() as { proof:string;guestContextId:string;conversationId:string };
  const guestHeaders = { "x-norrow-guest-proof":guest.proof };
  expect((await app.inject({ method:"POST",url:"/v1/consent",headers:guestHeaders,payload:{grant:true} })).statusCode).toBe(200);
  const first = await app.inject({ method:"POST",url:"/v1/runs",
    headers:{ ...guestHeaders,"idempotency-key":crypto.randomUUID() },
    payload:{ question:"Which laptop is best for local AI under $2,000?",routeMode:"fixture",
      conversationId:guest.conversationId,consentPolicyVersion:CONSENT_POLICY_VERSION } });
  expect(first.statusCode).toBe(200);
  const parentRunId = first.json().runId as string;
  const ownerId = (await pool.query<{account_id:string}>("SELECT account_id FROM runs WHERE id=$1",[parentRunId])).rows[0]!.account_id;
  const sourceId = await insertSource(pool,{ accountId:ownerId,runId:parentRunId,locator,
    title:"Acme Model Z review",publisher:"Independent Lab",originCluster:"independent-lab" });
  const evidence = await insertVersionAndPassage(pool,{ accountId:ownerId,runId:parentRunId,sourceId,locator,
    text:"Acme Model Z lasts four hours in the battery test.",accessLevel:"partial-text" });
  const priorAnswer = "Acme Model Z was recommended for local AI, but its battery lasts only four hours.";
  await pool.query(`INSERT INTO reports(run_id,account_id,version,outcome,basis,blocks,claim_ids,limitations,source_access_summary,route_mode)
    VALUES($1,$2,1,'completed','{}',$3,'{}','[]',$4,'fixture')`,
    [parentRunId,ownerId,JSON.stringify([{id:crypto.randomUUID(),kind:"text",text:priorAnswer,
      claimIds:[],citationIds:[evidence.passageId]}]),
      JSON.stringify([{sourceId,title:"Acme Model Z review",accessLevel:"partial-text",originCluster:"independent-lab"}])]);
  const payload = kind === "follow_up"
    ? { kind:"follow_up" as const,text:"What about battery life?",parentRunId }
    : { kind:"new_research" as const,text:"What about battery life?" };
  const submissionId = crypto.randomUUID();
  const payloadDigest = createHash("sha256").update(canonicalGuestPendingPayload(payload)).digest("hex");
  const registered = await app.inject({ method:"POST",url:"/v1/guest/pending-actions",headers:guestHeaders,
    payload:{submissionId,guestContextId:guest.guestContextId,conversationId:guest.conversationId,
      conversationVersion:1,payload,payloadDigest,consentPolicyVersion:CONSENT_POLICY_VERSION} });
  expect(registered.statusCode).toBe(202);
  const authAttemptId = crypto.randomUUID();
  expect((await app.inject({ method:"POST",url:"/v1/guest/pending-actions/attempts/begin",headers:guestHeaders,
    payload:{submissionId,authAttemptId,provider:"email_code"} })).statusCode).toBe(200);
  const member = (await app.inject({ method:"POST",url:"/v1/dev/session",payload:{} })).json() as
    { token:string;accountId:string };
  const memberHeaders = { authorization:`Bearer ${member.token}` };
  const claimRequestId = crypto.randomUUID();
  const claim = await app.inject({ method:"POST",url:"/v1/guest/claim",headers:{...memberHeaders,...guestHeaders},
    payload:{claimRequestId,submissionId,guestContextId:guest.guestContextId,
      conversationId:guest.conversationId,conversationVersion:1,authAttemptId} });
  expect(claim.statusCode).toBe(200);
  expect((await app.inject({ method:"POST",url:"/v1/consent",headers:memberHeaders,
    payload:{grant:true} })).statusCode).toBe(200);
  await pool.query("UPDATE allowance_accounts SET limit_micro=300000 WHERE account_id=$1",[member.accountId]);
  const resumed = await app.inject({ method:"POST",url:"/v1/guest/actions/resume",headers:memberHeaders,
    payload:{submissionId,claimRequestId,controlVersion:2,payloadDigest} });
  expect(resumed.statusCode).toBe(200);
  return {parentRunId,ownerId,memberId:member.accountId,runId:resumed.json().runId as string,
    sourceId,priorAnswer,passageId:evidence.passageId};
}

describe("NARROW-GUEST claimed context in production research", () => {
  it("binds the exact parent and prior product answer without copying guest evidence or changing the submitted question",async()=>{
    const c = await claimedFollowUp();
    const run = (await getRun(pool,c.runId))!;
    expect(run.parent_run_id).toBeNull();
    await withTx(pool,(db)=>prepareClaimedResearchContext(db,{runId:c.runId,accountId:c.memberId,briefRevision:run.brief_revision}));
    await withTx(pool,(db)=>prepareClaimedResearchContext(db,{runId:c.runId,accountId:c.memberId,briefRevision:run.brief_revision}));
    const brief = await getBrief(pool,run.brief_id);
    expect(brief.originalQuestion).toBe("What about battery life?");
    expect(brief.desiredOutcome).toContain("Acme Model Z was recommended");
    expect(brief.desiredOutcome).toContain("partial-text");
    expect(brief.desiredOutcome).toContain("not evidence");
    expect((await pool.query("SELECT count(*)::int AS n FROM run_evidence_membership WHERE run_id=$1",[c.runId])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM authorized_run_passages WHERE run_id=$1 AND account_id=$2",[c.runId,c.memberId])).rows[0].n).toBe(0);
  });

  it("keeps an explicit new-research send independent of the claimed parent answer",async()=>{
    const c = await claimedFollowUp("https://example.org/laptop-review","new_research");
    const run = (await getRun(pool,c.runId))!;
    expect(await withTx(pool,(db)=>prepareClaimedResearchContext(db,{runId:c.runId,
      accountId:c.memberId,briefRevision:run.brief_revision}))).toBeNull();
    const brief = await getBrief(pool,run.brief_id);
    expect(brief.originalQuestion).toBe("What about battery life?");
    expect(brief.desiredOutcome).not.toContain(c.priorAnswer);
  });

  it("runs claimed-context preparation on the actual structured worker before any model request",async()=>{
    const c = await claimedFollowUp();
    const run = (await getRun(pool,c.runId))!;
    await pool.query("UPDATE runs SET evidence_recovery_policy='test-blocked-policy' WHERE id=$1",[c.runId]);
    const session: FencedSession = { signal:new AbortController().signal,stop(){},
      write(fn){ return withTx(pool,fn); } };
    await processStructuredResearch(pool,config,session,{runId:c.runId,accountId:c.memberId,
      briefRevision:run.brief_revision,fence:run.worker_lease_fence});
    const brief = await getBrief(pool,run.brief_id);
    expect(brief.desiredOutcome).toContain(c.priorAnswer);
    expect((await pool.query("SELECT count(*)::int AS n FROM model_operation_results WHERE run_id=$1",[c.runId])).rows[0].n).toBe(0);
  });

  it("issues a product-specific public search only from the exact cited parent passage, then denies a forged term and deleted source",async()=>{
    const c = await claimedFollowUp();
    const run = (await getRun(pool,c.runId))!;
    const owner = crypto.randomUUID();
    const fence = (await claimLease(pool,c.runId,owner,30_000))!;
    const session = fencedSession(pool,{runId:c.runId,accountId:c.memberId,owner,fence,
      briefRevision:run.brief_revision,leaseMs:30_000});
    const enabled = loadConfig({DATABASE_URL:url,NODE_ENV:"test",APP_AUTH_MODE:"development",
      NORROW_GUEST_BOOTSTRAP_ENABLED:"true",NORROW_GUEST_PROOF_PEPPER:"nonsecret-isolated-test-pepper-1234567890",
      DEV_ALLOW_FIXTURE_ROUTE:"true",LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",
      STRUCTURED_DISCOVERY_ENABLED:"true",OPENROUTER_API_KEY:"nonbillable-test-key",
      LIVE_KEY_SPEND_CAP_MICRO:"1000000000",LIVE_SPEND_CAP_MICRO:"1000000",LIVE_BUDGET_SCOPE:crypto.randomUUID()});
    const question = "What about battery life?";
    const span = {start:0,end:question.length,quote:question};
    const scope = {entity:null,plan:null,version:null,geography:null,time:null,population:null};
    const planned = {objective:question,objectiveProvenance:span,intendedOutput:"Battery comparison",
      criteria:[{key:"c1",description:"Compare battery life",field:"battery",operator:"compare",value:null,
        unit:null,importance:"hard",scope,provenance:span,group:"g1",groupOperator:"all",unresolvedAlternatives:[]}],
      questions:[{key:"q1",text:"How long does the recommended laptop last?",criterionKeys:["c1"],
        importance:"critical",evidenceStandard:"measured battery tests"}],assumptions:[],openAmbiguities:[],explicitExclusions:[]};
    const modelResponse = new Response(JSON.stringify({id:crypto.randomUUID(),model:"openai/gpt-4o-mini",provider:"OpenAI",
      usage:{cost:"0.000001"},choices:[{finish_reason:"stop",message:{content:JSON.stringify(planned)}}]}));
    try {
      const context = await session.write((db)=>prepareClaimedResearchContext(db,{runId:c.runId,
        accountId:c.memberId,briefRevision:run.brief_revision}));
      expect(context?.approvedPublicContextTerms).toEqual(expect.arrayContaining(["Acme","Model","Z"]));
      globalThis.fetch = vi.fn(async()=>modelResponse.clone()) as typeof fetch;
      const task = await ensureResearchTask(pool,enabled,session,{runId:c.runId,accountId:c.memberId,
        briefRevision:run.brief_revision,fence});
      expect(task.kind).toBe("task");
      if (task.kind !== "task") return;
      const send = vi.fn(async (_url: Parameters<typeof fetch>[0],init?:RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(JSON.stringify(body).toLowerCase()).toContain("acme model z");
        return new Response(JSON.stringify({id:crypto.randomUUID(),model:"openai/gpt-4o-mini",provider:"OpenAI",
          usage:{cost:"0.000003"},choices:[{finish_reason:"stop",message:{annotations:[{type:"url_citation",
            url_citation:{url:"https://example.org/battery-test",title:"Battery test",content:"Acme Model Z battery findings"}}]}}]}));
      });
      globalThis.fetch = send as typeof fetch;
      const base = {runId:c.runId,accountId:c.memberId,briefRevision:run.brief_revision,fence,taskId:task.task.id};
      const proposal = {rationale:"Research the cited product's battery life",action:{type:"search" as const,
        query:"What about battery life? Acme Model Z",questionKeys:["q1"],publicQueryBasis:span}};
      expect(await performPublicSearch(pool,enabled,session,{...base,proposal})).toMatchObject({kind:"search"});
      expect(send).toHaveBeenCalledTimes(1);
      await expect(performPublicSearch(pool,enabled,session,{...base,proposal:{...proposal,
        action:{...proposal.action,query:"What about battery life? Acme Model Z PRIVATECODE"}}}))
        .rejects.toThrow("invalid_public_query");
      expect(send).toHaveBeenCalledTimes(1);
      await pool.query("INSERT INTO tombstones(account_id,object_kind,object_id,reason) VALUES($1,'source',$2,'source_deletion')",
        [c.ownerId,c.sourceId]);
      await expect(performPublicSearch(pool,enabled,session,{...base,proposal:{...proposal,
        action:{...proposal.action,query:"What about battery life? Acme Model Z four hours"}}}))
        .rejects.toThrow("claimed_context_parent_source_unavailable");
      expect(send).toHaveBeenCalledTimes(1);
    } finally { session.stop(); }
  });

  it("denies a changed binding, parent source deletion, or private-source answer before copying context",async()=>{
    const c = await claimedFollowUp();
    const run = (await getRun(pool,c.runId))!;
    const args = {runId:c.runId,accountId:c.memberId,briefRevision:run.brief_revision};
    await pool.query("UPDATE runs SET claimed_parent_run_id=id WHERE id=$1",[c.runId]);
    await expect(withTx(pool,(db)=>prepareClaimedResearchContext(db,args))).rejects.toThrow("claimed_context_control_unavailable");
    await pool.query("UPDATE runs SET claimed_parent_run_id=$2 WHERE id=$1",[c.runId,c.parentRunId]);
    await pool.query("UPDATE runs SET claimed_control_version=claimed_control_version+1 WHERE id=$1",[c.runId]);
    await expect(withTx(pool,(db)=>prepareClaimedResearchContext(db,args))).rejects.toThrow("claimed_context_control_unavailable");
    await pool.query("UPDATE runs SET claimed_control_version=claimed_control_version-1 WHERE id=$1",[c.runId]);
    await pool.query("UPDATE consent_records SET revoked_at=now() WHERE account_id=$1",[c.ownerId]);
    await expect(withTx(pool,(db)=>prepareClaimedResearchContext(db,args))).rejects.toThrow("claimed_context_control_unavailable");
    await pool.query("UPDATE consent_records SET revoked_at=NULL WHERE account_id=$1",[c.ownerId]);
    await pool.query("UPDATE reports SET redacted_at=now() WHERE run_id=$1",[c.parentRunId]);
    await expect(withTx(pool,(db)=>prepareClaimedResearchContext(db,args))).rejects.toThrow("claimed_context_parent_report_unavailable");
    await pool.query("UPDATE reports SET redacted_at=NULL WHERE run_id=$1",[c.parentRunId]);
    await pool.query("INSERT INTO tombstones(account_id,object_kind,object_id,reason) VALUES($1,'source',$2,'source_deletion')",
      [c.ownerId,c.sourceId]);
    await expect(withTx(pool,(db)=>prepareClaimedResearchContext(db,args))).rejects.toThrow("claimed_context_parent_source_unavailable");
    await pool.query("DELETE FROM tombstones WHERE account_id=$1 AND object_kind='source' AND object_id=$2",[c.ownerId,c.sourceId]);
    await pool.query("UPDATE sources SET source_type='supplied-document' WHERE id=$1",[c.sourceId]);
    await expect(withTx(pool,(db)=>prepareClaimedResearchContext(db,args))).rejects.toThrow("claimed_context_parent_source_not_public");
    await pool.query("UPDATE sources SET source_type='web' WHERE id=$1",[c.sourceId]);
    await pool.query("UPDATE source_versions SET final_locator='attachment://private' WHERE source_id=$1",[c.sourceId]);
    await expect(withTx(pool,(db)=>prepareClaimedResearchContext(db,args))).rejects.toThrow("claimed_context_parent_source_not_public");
    await pool.query("UPDATE source_versions SET final_locator='https://example.org/laptop-review' WHERE source_id=$1",[c.sourceId]);
    await pool.query("UPDATE sources SET canonical_locator='attachment://private' WHERE id=$1",[c.sourceId]);
    await expect(withTx(pool,(db)=>prepareClaimedResearchContext(db,args))).rejects.toThrow("claimed_context_parent_source_not_public");
    expect((await getBrief(pool,run.brief_id)).desiredOutcome).not.toContain(c.priorAnswer);
  });
});

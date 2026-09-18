import {beforeAll,afterAll,afterEach,it,expect,vi} from "vitest";
import type pg from "pg";
import {CreateRunRequestSchema} from "@deep/contracts";
import {createPool,migrate,withTx} from "../src/platform/db.js";
import {createDevSession,grantConsent} from "../src/modules/access.js";
import {admitRun} from "../src/modules/run-admission.js";
import {getRun,claimLease,cancelRun} from "../src/modules/runs.js";
import {reserveLiveAttempt} from "../src/modules/live-spend.js";
import {runModelVersions} from "../src/modules/run-model-policy.js";
import {performModelOperation} from "../src/worker/model-gateway.js";
import {fencedSession} from "../src/worker/fenced-session.js";
import {loadConfig} from "../src/platform/config.js";
import {AZURE_ZDR_EXACT_QUOTE_POLICY,AZURE_ZDR_MODEL_POLICY,STRUCTURED_MODEL_POLICY,modelPolicy} from "../src/ports/model-policy.js";
import {recordPortfolioResolution} from "../src/modules/model-portfolio.js";
import {PRODUCTION_PORTFOLIO_V1,replayPolicyIdentity} from "../src/model-governor/index.js";
let pool:pg.Pool;const originalFetch=globalThis.fetch;
beforeAll(async()=>{if(!process.env.TEST_DATABASE_URL)throw Error("Explicit isolated test DB required");pool=createPool(process.env.TEST_DATABASE_URL);await migrate(pool);});
afterEach(()=>{globalThis.fetch=originalFetch;});afterAll(async()=>pool.end());
async function account(){return withTx(pool,async db=>{const a=await createDevSession(db);await grantConsent(db,a.accountId);return a;});}
it("pins new admission, preserves idempotent policy and parent inheritance, and denies mutation",async()=>{
 const a=await account(),key=crypto.randomUUID(),input=CreateRunRequestSchema.parse({question:"Policy identity control",routeMode:"controlled-research"});
 const parent=await admitRun(pool,a.accountId,key,input,{modelPolicyId:AZURE_ZDR_MODEL_POLICY.id});
 expect((await getRun(pool,parent.runId))?.model_policy_id).toBe(AZURE_ZDR_MODEL_POLICY.id);
 expect(await admitRun(pool,a.accountId,key,input,{modelPolicyId:STRUCTURED_MODEL_POLICY.id})).toMatchObject({runId:parent.runId,reused:true});
 await expect(pool.query("UPDATE runs SET model_policy_id=$2 WHERE id=$1",[parent.runId,STRUCTURED_MODEL_POLICY.id])).rejects.toThrow("model_policy_immutable");
 const child=await admitRun(pool,a.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({...input,parentRunId:parent.runId}),{modelPolicyId:STRUCTURED_MODEL_POLICY.id});
 expect((await getRun(pool,child.runId))?.model_policy_id).toBe(AZURE_ZDR_MODEL_POLICY.id);
 await migrate(pool);expect((await getRun(pool,parent.runId))?.model_policy_id).toBe(AZURE_ZDR_MODEL_POLICY.id);
 expect(await runModelVersions(pool,child.runId)).toMatchObject({policyId:AZURE_ZDR_MODEL_POLICY.id});
 await cancelRun(pool,child.runId);await cancelRun(pool,parent.runId);
});
it.each([STRUCTURED_MODEL_POLICY,AZURE_ZDR_MODEL_POLICY])("replays unknown $provider requests under their immutable policy after a config change",async policy=>{
 const a=await account(),question="Explain database transactions.";
 const r=await admitRun(pool,a.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question,routeMode:"controlled-research"}),{modelPolicyId:policy.id});
 const owner=crypto.randomUUID(),fence=(await claimLease(pool,r.runId,owner,30000))!;
 const session=fencedSession(pool,{runId:r.runId,accountId:a.accountId,owner,fence,briefRevision:1,leaseMs:30000});
 const config=loadConfig({DATABASE_URL:process.env.TEST_DATABASE_URL!,LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",OPENROUTER_API_KEY:`nonbillable-${crypto.randomUUID()}`,LIVE_SPEND_CAP_MICRO:"1000000",LIVE_KEY_SPEND_CAP_MICRO:"1000000",LIVE_BUDGET_SCOPE:crypto.randomUUID(),STRUCTURED_MODEL_POLICY_ID:policy.id===STRUCTURED_MODEL_POLICY.id?AZURE_ZDR_MODEL_POLICY.id:STRUCTURED_MODEL_POLICY.id});
 const send=vi.fn(async(_input:Parameters<typeof fetch>[0],init?:RequestInit)=>{const body=JSON.parse(String(init?.body));expect(body.provider.only).toEqual([policy.provider]);throw Error("Synthetic network ambiguity");});globalThis.fetch=send;
 const args={runId:r.runId,accountId:a.accountId,fence,briefRevision:1,evidenceRevision:0,operation:"brief" as const,context:{question,task:null,passages:[],sources:[],assertions:[],approvedClaimKeys:[],draft:null}};
 try{
  expect(await performModelOperation(pool,config,session,args)).toMatchObject({kind:"result",reused:false,result:{status:"outcome_unknown"}});
  expect(await performModelOperation(pool,config,session,args)).toMatchObject({kind:"result",reused:true,result:{status:"outcome_unknown"}});expect(send).toHaveBeenCalledTimes(1);
  expect((await pool.query("SELECT state,confirmed_micro FROM provider_intents WHERE run_id=$1",[r.runId])).rows).toEqual([{state:"outcome-unknown",confirmed_micro:null}]);
 }finally{session.stop();await cancelRun(pool,r.runId);}
});
it.each(["openrouter-azure-mini-zdr-text-v1","openrouter-azure-mini-zdr-exact-quote-v2","openrouter-azure-mini-zdr-discovery-v3"] as const)("preserves strict legacy spans and audits exact quote coordinate resolution: %s",async policyId=>{
 const a=await account(),question="Explain coral bleaching.";
 const r=await admitRun(pool,a.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question,routeMode:"controlled-research"}),{modelPolicyId:policyId});
 const owner=crypto.randomUUID(),fence=(await claimLease(pool,r.runId,owner,30000))!;
 const session=fencedSession(pool,{runId:r.runId,accountId:a.accountId,owner,fence,briefRevision:1,leaseMs:30000});
 const config=loadConfig({DATABASE_URL:process.env.TEST_DATABASE_URL!,LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",OPENROUTER_API_KEY:`nonbillable-${crypto.randomUUID()}`,LIVE_SPEND_CAP_MICRO:"1000000",LIVE_KEY_SPEND_CAP_MICRO:"1000000",LIVE_BUDGET_SCOPE:crypto.randomUUID()});
 const span={start:1,end:2,quote:question},scope={entity:null,plan:null,version:null,geography:null,time:null,population:null};
 const output={objective:question,objectiveProvenance:span,intendedOutput:"Explanation",criteria:[{key:"explain",description:question,field:"mechanism",operator:"explain",value:null,unit:null,importance:"hard",scope,provenance:span,group:"all",groupOperator:"all",unresolvedAlternatives:[]}],questions:[{key:"q",text:question,criterionKeys:["explain"],importance:"critical",evidenceStandard:"Primary evidence"}],assumptions:[],openAmbiguities:[],explicitExclusions:[]};
 const send=vi.fn(async()=>new Response(JSON.stringify({id:`nonbillable-${crypto.randomUUID()}`,model:"openai/gpt-4o-mini",provider:"Azure",usage:{cost:0.001},choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]})));globalThis.fetch=send;
 const args={runId:r.runId,accountId:a.accountId,fence,briefRevision:1,evidenceRevision:0,operation:"brief" as const,context:{question,task:null,passages:[],sources:[],assertions:[],approvedClaimKeys:[],draft:null}};
 try{
  const resolved=policyId!=="openrouter-azure-mini-zdr-text-v1",first=await performModelOperation(pool,config,session,args);
  expect(first).toMatchObject({kind:"result",reused:false,result:{status:resolved?"succeeded":"invalid_output"}});
  if(first.kind==="result"&&first.result.status==="succeeded")expect(first.result.output.objectiveProvenance).toEqual({quote:question,start:0,end:question.length});
  expect(await performModelOperation(pool,config,session,args)).toMatchObject({kind:"result",reused:true,result:{status:resolved?"succeeded":"invalid_output"}});
  expect(send).toHaveBeenCalledTimes(1);
  const events=(await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='model_span_resolution'",[r.runId])).rows;
  expect(events).toHaveLength(resolved?1:0);
  if(resolved)expect(events[0].payload.resolutions).toHaveLength(2);
 }finally{session.stop();await cancelRun(pool,r.runId);}
});
it("v2 brief repair links orphaned criteria and keeps v1 strict",async()=>{
 const a=await account(),question="best laptop for running AI under 2k";
 const r=await admitRun(pool,a.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question,routeMode:"controlled-research"}),{modelPolicyId:AZURE_ZDR_EXACT_QUOTE_POLICY.id});
 const owner=crypto.randomUUID(),fence=(await claimLease(pool,r.runId,owner,30000))!;
 const session=fencedSession(pool,{runId:r.runId,accountId:a.accountId,owner,fence,briefRevision:1,leaseMs:30000});
 const config=loadConfig({DATABASE_URL:process.env.TEST_DATABASE_URL!,LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",OPENROUTER_API_KEY:`nonbillable-${crypto.randomUUID()}`,LIVE_SPEND_CAP_MICRO:"1000000",LIVE_KEY_SPEND_CAP_MICRO:"1000000",LIVE_BUDGET_SCOPE:crypto.randomUUID()});
 const span={start:99,end:100,quote:question},scope={entity:null,plan:null,version:null,geography:null,time:null,population:null};
 const output={objective:question,objectiveProvenance:span,intendedOutput:"recommendation",
  criteria:[{key:"budget",description:"Stay under the stated budget",field:"budget",operator:"at_most",value:"2k",unit:null,importance:"hard",scope,provenance:{start:99,end:100,quote:"under 2k"},group:"g",groupOperator:"all",unresolvedAlternatives:[]},
   {key:"local_ai",description:"Run AI on the laptop",field:"workload",operator:"exists",value:null,unit:null,importance:"hard",scope,provenance:{start:99,end:100,quote:"running AI"},group:"g",groupOperator:"all",unresolvedAlternatives:[]}],
  questions:[{key:"q_budget",text:"What laptops stay under budget?",criterionKeys:["budget"],importance:"critical",evidenceStandard:"current prices"}],
  assumptions:[],openAmbiguities:[],explicitExclusions:[]};
 globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify({id:`nonbillable-${crypto.randomUUID()}`,model:"openai/gpt-4o-mini",provider:"Azure",usage:{cost:0.001},choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]})));
 try{
  const first=await performModelOperation(pool,config,session,{runId:r.runId,accountId:a.accountId,fence,briefRevision:1,evidenceRevision:0,operation:"brief",context:{question,task:null,passages:[],sources:[],assertions:[],approvedClaimKeys:[],draft:null}});
  expect(first).toMatchObject({kind:"result",result:{status:"succeeded"}});
  if(first.kind==="result"&&first.result.status==="succeeded"){
   expect(first.result.output.questions.some(q=>q.criterionKeys.includes("local_ai"))).toBe(true);
   expect(first.result.output.objectiveProvenance).toEqual({quote:question,start:0,end:question.length});
  }
  const events=(await pool.query("SELECT type,payload FROM run_events WHERE run_id=$1 AND type='brief_criterion_link'",[r.runId])).rows;
  expect(events).toHaveLength(1);
  expect(events[0].payload.linked).toEqual([{criterionKey:"local_ai",questionKey:"linked_local_ai",attachedToExisting:false}]);
 }finally{session.stop();await cancelRun(pool,r.runId);}
});
it("applies cheap-first policy on unpinned new runs and fail-closes leftover structured spend",async()=>{
 const a=await account();
 const r=await admitRun(pool,a.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question:"Policy cheap first",routeMode:"controlled-research"}));
 expect((await getRun(pool,r.runId))?.model_policy_id).toBe(STRUCTURED_MODEL_POLICY.id);
 expect((await pool.query("SELECT admission,resolved_policy_id FROM model_portfolio_resolutions WHERE run_id=$1",[r.runId])).rows[0]).toEqual({
  admission:"cheap_first_admitted",resolved_policy_id:STRUCTURED_MODEL_POLICY.id,
 });
 const owner=crypto.randomUUID(),fence=(await claimLease(pool,r.runId,owner,30000))!;
 const config=loadConfig({DATABASE_URL:process.env.TEST_DATABASE_URL!,LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",OPENROUTER_API_KEY:`nonbillable-${crypto.randomUUID()}`,LIVE_SPEND_CAP_MICRO:"1000000",LIVE_KEY_SPEND_CAP_MICRO:"1000000",LIVE_BUDGET_SCOPE:crypto.randomUUID()});
 await expect(reserveLiveAttempt(pool,config,{runId:r.runId,fence,briefRevision:1,kind:"brief",route:"openrouter:test",requestDigest:"leftover-structured",reserveMicro:80_000,logicalKey:"leftover-structured"})).rejects.toThrow("verification_writing_reserve");
 const writing=await reserveLiveAttempt(pool,config,{runId:r.runId,fence,briefRevision:1,kind:"write_report",route:"openrouter:test",requestDigest:"leftover-writing",reserveMicro:80_000,logicalKey:"leftover-writing"});
 expect(writing.issue).toBe(true);
 await cancelRun(pool,r.runId);
});
it("records immutable portfolio resolutions and still replays historical policy identity",async()=>{
 const a=await account();
 const r=await admitRun(pool,a.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question:"Policy replay after portfolio",routeMode:"controlled-research"}),{modelPolicyId:STRUCTURED_MODEL_POLICY.id});
 const id=crypto.randomUUID();
 await withTx(pool,db=>recordPortfolioResolution(db,{
  id,runId:r.runId,accountId:a.accountId,portfolioId:PRODUCTION_PORTFOLIO_V1.id,operation:"brief",
  resolvedPolicyId:STRUCTURED_MODEL_POLICY.id,admission:"cheap_first_admitted",escalationDepth:0,
  escalationTrigger:null,cacheSessionId:`run:${r.runId}:policy:${STRUCTURED_MODEL_POLICY.id}`,reason:"cheap_first_admitted",
 }));
 await expect(pool.query("UPDATE model_portfolio_resolutions SET reason='mutated' WHERE id=$1",[id])).rejects.toThrow("model_portfolio_resolution_immutable");
 expect(replayPolicyIdentity(STRUCTURED_MODEL_POLICY.id)).toEqual({
  id:STRUCTURED_MODEL_POLICY.id,model:"openai/gpt-4o-mini",provider:"openai",providerName:"OpenAI",
 });
 expect(modelPolicy(AZURE_ZDR_MODEL_POLICY.id).id).toBe(AZURE_ZDR_MODEL_POLICY.id);
 expect((await getRun(pool,r.runId))?.model_policy_id).toBe(STRUCTURED_MODEL_POLICY.id);
 await cancelRun(pool,r.runId);
});

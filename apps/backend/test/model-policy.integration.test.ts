import {beforeAll,afterAll,afterEach,it,expect,vi} from "vitest";
import type pg from "pg";
import {CreateRunRequestSchema} from "@deep/contracts";
import {createPool,migrate,withTx} from "../src/platform/db.js";
import {createDevSession,grantConsent} from "../src/modules/access.js";
import {admitRun} from "../src/modules/run-admission.js";
import {getRun,claimLease,cancelRun} from "../src/modules/runs.js";
import {runModelVersions} from "../src/modules/run-model-policy.js";
import {performModelOperation} from "../src/worker/model-gateway.js";
import {fencedSession} from "../src/worker/fenced-session.js";
import {loadConfig} from "../src/platform/config.js";
import {AZURE_ZDR_MODEL_POLICY,STRUCTURED_MODEL_POLICY} from "../src/ports/model-policy.js";
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

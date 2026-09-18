import {afterAll,afterEach,beforeAll,expect,it,vi} from "vitest";
import {mkdir,writeFile,mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import type pg from "pg";
import type PgBoss from "pg-boss";
import {createPool,migrate,withTx} from "../src/platform/db.js";
import {createQueue} from "../src/adapters/queue.js";
import {createDevSession,grantConsent} from "../src/modules/access.js";
import {admitRun} from "../src/modules/run-admission.js";
import {CreateRunRequestSchema} from "@deep/contracts";
import {loadConfig} from "../src/platform/config.js";
import {productionDriver} from "../src/evaluation/production-driver.js";
import {runMatched,stepsFor} from "../src/evaluation/runner.js";
import type {RegisteredPlan,Authorization} from "../src/evaluation/authorization.js";
import {matchedDocumentModel} from "./helpers/matched-model.js";
import * as transport from "../src/platform/ssrf.js";
const traces:unknown[]=[];
let pool:pg.Pool,boss:PgBoss,testDatabaseUrl:string;const originalFetch=globalThis.fetch;
beforeAll(async()=>{
 const url=process.env.TEST_DATABASE_URL;if(!url)throw Error("Explicit isolated TEST_DATABASE_URL required");
 // The runner deliberately counts every unattributed liability. Other suites retain
 // synthetic unknown holds, so use a fresh database rather than deleting or excluding them.
 const name=`deep_eval_control_${crypto.randomUUID().replaceAll("-", "")}`;
 const admin=createPool(url);
 try { await admin.query(`CREATE DATABASE "${name}"`); } finally { await admin.end(); }
 const isolated=new URL(url);isolated.pathname=`/${name}`;testDatabaseUrl=isolated.toString();
 process.stdout.write(`evaluation control database (retained): ${name}\n`);
 pool=createPool(testDatabaseUrl);await migrate(pool);boss=await createQueue(testDatabaseUrl);
});
afterEach(()=>{globalThis.fetch=originalFetch;vi.restoreAllMocks();});afterAll(async()=>{const dir=process.env.EVAL_RUNNER_ARTIFACT_DIR??await mkdtemp(join(tmpdir(),"eval-runner-"));await mkdir(dir,{recursive:true});await writeFile(join(dir,"controls.json"),JSON.stringify({evidenceClass:"production_api_worker_actual_html_extraction_fabricated_transports",actualProviderSpendMicro:0,semanticScores:null,traces},null,2)+"\n");await boss.stop({graceful:false,timeout:2000});await pool.end();});
async function setup(){
 const account=await withTx(pool,async db=>{const a=await createDevSession(db);await grantConsent(db,a.accountId);return a;});
 const grant:Authorization={version:"matched-evaluation-authorization.v1",approvalId:crypto.randomUUID(),approvalReference:"synthetic-control-not-paid-approval",issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),protocolSha256:"0".repeat(64),freezeSha256:"0".repeat(64),taskIds:["MC-D01"],budgetMicro:1000000,accountId:account.accountId,budgetScope:`evaluation:${crypto.randomUUID()}`,sourceMode:"live_discovery",exclusiveDatabaseAcknowledged:true};
 const config=loadConfig({NODE_ENV:"test",DATABASE_URL:testDatabaseUrl,DEV_ALLOW_FIXTURE_ROUTE:"false",LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",STRUCTURED_DISCOVERY_ENABLED:"true",LIVE_RETRIEVAL_ENABLED:"true",OPENROUTER_API_KEY:`nonbillable-${crypto.randomUUID()}`,LIVE_SPEND_CAP_MICRO:"1000000",LIVE_KEY_SPEND_CAP_MICRO:"1000000",WRITING_CANCEL_WINDOW_MS:"1"});
 const driver=await productionDriver(pool,boss,config,grant,account.token);return {driver,config,grant,account};
}
it("executes the same API/worker/parser/writer/checker for paired originals, correction and full rerun with durable trace",async()=>{
 const x=await setup();const model=matchedDocumentModel();globalThis.fetch=model.transport;const read=vi.spyOn(transport,"safeFetch").mockImplementation(async url=>{const body='<html><body><h1>Field note</h1><p>Ardent does not support underwater recording.</p><p>Ardent supports offline recording only on firmware 4.2.</p><p>This original synthetic document provides deliberately fabricated control statements about the named device. It tests the common production evidence path and does not establish actual product capabilities.</p></body></html>';return {url:String(url),body,bytes:Buffer.from(body),status:200,mime:"text/html",redirectChain:[]};});
 const plan:RegisteredPlan={authorization:x.grant,tasks:[{id:"MC-D01",index:0,repetitions:1,question:"What does Ardent say about underwater recording?",correctedQuestion:"What firmware does Ardent require for offline recording?"}],registeredTaskIds:["MC-D01"],unselectedTaskIds:[],protocolHash:"0".repeat(64),freezeHash:"0".repeat(64),tasksHash:"0".repeat(64),sourcesHash:"0".repeat(64)};
 const events:any[]=[];traces.push({kind:"four_run_and_replay",events});
 try{
  const result=await runMatched(plan,x.driver,async e=>{events.push(e)});expect(result).toEqual({expectedSteps:4,recordedResults:4,halted:null});
  const rows=events.filter(e=>e.event==="result").map(e=>e.receipt);expect(rows.map(r=>r.trace.strategy)).toEqual(["iterative-baseline.v1","criterion-adaptive.v1","criterion-adaptive.v1","iterative-baseline.v1"]);
  for(const row of rows){expect(row.outcome).toBe("completed");expect(row.trace.report.blocks.length).toBeGreaterThan(0);expect(row.trace.passages.length).toBeGreaterThan(0);expect(row.trace.support.length).toBeGreaterThan(0);expect(row.trace.attempts.length).toBeGreaterThan(0);expect(row.trace.operations.length).toBeGreaterThan(0);expect(row.trace.extraction.length).toBeGreaterThan(0);expect(row.trace.artifacts.length).toBeGreaterThan(0);expect(createHash("sha256").update(Buffer.from(row.trace.artifacts[0].bytes_base64,"base64")).digest("hex")).toBe(row.trace.artifacts[0].digest);expect(row.trace.extraction[0].extraction.version).toBe("trafilatura-2.2.0/structure-v3");expect(row.cost.heldMicro).toBe(0);}
  expect(rows[2].trace.reuse.length).toBeGreaterThan(0);expect(rows[2].trace.passages.map((p:any)=>p.id)).toEqual(rows[1].trace.passages.map((p:any)=>p.id));expect(rows[3].trace.passages[0].id).not.toBe(rows[1].trace.passages[0].id);expect(read).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(rows[2].trace.report)).toContain("firmware 4.2");expect(JSON.stringify(rows[3].trace.report)).toContain("firmware 4.2");
  const calls=model.calls.length;const steps=stepsFor(plan);const replay=await x.driver.admit(steps[0]!);expect(replay.runId).toBe(rows[0].runId);expect(model.calls.length).toBe(calls);
  const replayed=await runMatched(plan,x.driver,async()=>{});expect(replayed.recordedResults).toBe(4);expect(model.calls.length).toBe(calls);expect(read).toHaveBeenCalledTimes(3);
  const artifact=rows[0].trace.artifacts[0];
  await pool.query("UPDATE evidence_artifacts SET body=$2 WHERE id=$1",[artifact.id,Buffer.from("Synthetic corrupted stored artifact")]);
  await expect(x.driver.execute(rows[0].runId)).rejects.toThrow("evaluation_receipt_identity_unconfirmed");
  expect(model.calls.length).toBe(calls);expect(read).toHaveBeenCalledTimes(3);
  traces.push({kind:"tampered_stored_artifact",runId:rows[0].runId,receiptRejected:true,extraProviderCalls:0,extraReads:0});
 }finally{await x.driver.close();}
},120000);
it("prior different-account same-key held and confirmed liabilities count before any new provider work",async()=>{
 const x=await setup();try{
  const other=await withTx(pool,async db=>{const a=await createDevSession(db);await grantConsent(db,a.accountId);return a;});
  const run=await admitRun(pool,other.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question:"Synthetic ledger control",routeMode:"controlled-research"}));
  const keyScope=createHash("sha256").update(`openrouter:${x.config.openRouterApiKey!.trim()}`).digest("hex"),intent=crypto.randomUUID();
  await pool.query("INSERT INTO provider_intents(id,run_id,correlation_id,route,request_digest,reserved_max_micro,state,scope_key,provider_key_scope) VALUES($1,$2,$4,'openrouter:synthetic-ledger','synthetic',5000,'outcome-unknown','other-evaluation',$3)",[intent,run.runId,keyScope,intent]);
  const held=await x.driver.exposure();traces.push({kind:"different_account_same_key_prior_liability",held});expect(held).toEqual({confirmedMicro:0,heldMicro:5000,unknownIntents:1});
  const plan:RegisteredPlan={authorization:x.grant,tasks:[{id:"MC-D01",index:0,repetitions:1,question:"Original",correctedQuestion:"Corrected"}],registeredTaskIds:["MC-D01"],unselectedTaskIds:[],protocolHash:"",freezeHash:"",tasksHash:"",sourcesHash:""};
  const admit=vi.spyOn(x.driver,"admit");expect((await runMatched(plan,x.driver,async()=>{})).halted).toBe("prior_unknown_exposure");expect(admit).not.toHaveBeenCalled();
  await pool.query("UPDATE provider_intents SET state='confirmed',confirmed_micro=3000 WHERE id=$1",[intent]);expect(await x.driver.exposure()).toEqual({confirmedMicro:3000,heldMicro:0,unknownIntents:0});
 }finally{await x.driver.close();}
});
it("records a new opaque provider failure and retains its real reservation without issuing later steps",async()=>{
 const x=await setup();const provider=vi.fn(async()=>{throw new TypeError("Synthetic opaque transport loss");});globalThis.fetch=provider as typeof fetch;
 const plan:RegisteredPlan={authorization:x.grant,tasks:[{id:"MC-D01",index:0,repetitions:1,question:"What does Ardent say about underwater recording?",correctedQuestion:"What firmware does Ardent require?"}],registeredTaskIds:["MC-D01"],unselectedTaskIds:[],protocolHash:"",freezeHash:"",tasksHash:"",sourcesHash:""};
 const events:any[]=[];traces.push({kind:"opaque_provider_failure",events});
 try{const r=await runMatched(plan,x.driver,async e=>{events.push(e)});expect(r.halted).toBe("unknown_or_incomplete_run");expect(provider).toHaveBeenCalledOnce();const result=events.find(e=>e.event==="result").receipt;expect(result.reportId).toBeNull();expect(result.cost.heldMicro).toBeGreaterThan(0);expect(result.cost.unknownIntents).toBe(1);expect(result.trace.attempts).toHaveLength(1);expect(events.filter(e=>e.event==="unrun")).toHaveLength(3);}finally{await x.driver.close();}
},30000);

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import type pg from "pg";
import { buildApp } from "../src/api/app.js";
import { createPool, migrate } from "../src/platform/db.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createQueue } from "../src/adapters/queue.js";
import { processRun } from "../src/worker/executor.js";
import { getRun } from "../src/modules/runs.js";
import { measureRunCost } from "../src/modules/run-cost.js";
import { matchedDocumentModel } from "./helpers/matched-model.js";
import * as publicTransport from "../src/platform/ssrf.js";
import * as extraction from "../src/adapters/extraction/offline.js";
const originalFetch=globalThis.fetch;
let pool:pg.Pool,boss:PgBoss,baseline:FastifyInstance,adaptive:FastifyInstance,config:AppConfig;
// Repeated verification must not overwrite committed historical receipts.
const artifactRoot=process.env.MATCHED_PIPELINE_ARTIFACT_DIR ? resolve(process.env.MATCHED_PIPELINE_ARTIFACT_DIR) : await mkdtemp(join(tmpdir(),"deep-matched-pipeline-"));
const traces:unknown[]=[];
const digest=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");
beforeAll(async()=>{
 const databaseUrl=process.env.TEST_DATABASE_URL??"postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
 pool=createPool(databaseUrl);await migrate(pool);boss=await createQueue(databaseUrl);
 config=loadConfig({NODE_ENV:"test",DATABASE_URL:databaseUrl,DEV_ALLOW_FIXTURE_ROUTE:"false",LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",OPENROUTER_API_KEY:"nonbillable-matched-key",LIVE_SPEND_CAP_MICRO:"1000000000",LIVE_KEY_SPEND_CAP_MICRO:"1000000000",LIVE_BUDGET_SCOPE:crypto.randomUUID(),WRITING_CANCEL_WINDOW_MS:"1"});
 baseline=await buildApp({pool,boss,config:{...config,structuredStrategy:"iterative-baseline.v1"}});
 adaptive=await buildApp({pool,boss,config:{...config,structuredStrategy:"criterion-adaptive.v1"}});
});
afterEach(()=>{globalThis.fetch=originalFetch;vi.restoreAllMocks();});
afterAll(async()=>{
 await mkdir(artifactRoot,{recursive:true});
 const versions=await Promise.all(["apps/backend/src/adapters/model/prompts.ts","apps/backend/src/ports/model-policy.ts","packages/contracts/src/research-model.ts","evals/matched-pipeline/protocol.json","apps/backend/src/worker/structured-research.ts","apps/backend/src/worker/attachment-ingestion.ts","apps/backend/test/matched-pipeline.extraction.test.ts"].map(async path=>({path,sha256:digest(await readFile(new URL(`../../../${path}`,import.meta.url)))})));
 await writeFile(join(artifactRoot,"document-controls.json"),JSON.stringify({commit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),workingTree:execFileSync("git",["status","--porcelain=v1"],{encoding:"utf8"}).trim()?"working_tree_changes_present":"clean_checkout",environment:{node:process.version,platform:process.platform,extractionRuntime:process.env.EXTRACTION_RUNTIME},versions,protocol:"matched-pipeline.v1",evidenceClass:"actual_extraction_production_api_worker_fabricated_model",newPaidCalls:0,actualProviderCostMicro:0,semanticScores:null,humanAdjudication:null,traces},null,2)+"\n");
 process.stdout.write(`matched-pipeline artifact: ${join(artifactRoot,"document-controls.json")}\n`);
 await baseline.close();await adaptive.close();await boss.stop({graceful:false,timeout:2000});await pool.end();
});
async function account(){
 const auth=(await baseline.inject({method:"POST",url:"/v1/dev/session",payload:{}})).json(),headers={authorization:`Bearer ${auth.token}`};
 expect((await baseline.inject({method:"POST",url:"/v1/consent",headers,payload:{grant:true}})).statusCode).toBe(200);
 return {id:auth.accountId,headers};
}
async function upload(headers:Record<string,string>,bytes:Buffer){
 const result=await baseline.inject({method:"POST",url:"/v1/attachments/bytes",headers:{...headers,"content-type":"application/octet-stream","x-document-mime":"application/pdf","x-file-name":"research-note.pdf"},payload:bytes});
 expect(result.statusCode).toBe(201);return result.json().attachmentId as string;
}
async function admit(app:FastifyInstance,headers:Record<string,string>,question:string,attachmentId:string){
 const response=await app.inject({method:"POST",url:"/v1/runs",headers:{...headers,"idempotency-key":crypto.randomUUID()},payload:{question,routeMode:"controlled-research",attachmentIds:[attachmentId]}});
 expect(response.statusCode).toBe(200);return response.json().runId as string;
}
async function execute(runId:string,label:string,headers:Record<string,string>,publicDiscovery=false){
 const model=matchedDocumentModel();globalThis.fetch=model.transport;
 const parser=vi.spyOn(extraction,"extractOffline");const started=performance.now();let error:string|null=null;
 try {
  // Opposite current default proves the worker uses the admitted policy on restart.
  const workerConfig={...config,structuredDiscoveryEnabled:publicDiscovery,liveRetrievalEnabled:publicDiscovery};
  await processRun(pool,{...workerConfig,structuredStrategy:(await getRun(pool,runId))!.research_strategy==="iterative-baseline.v1"?"criterion-adaptive.v1":"iterative-baseline.v1"},runId,{pauseAt:"researching"});
  await processRun(pool,workerConfig,runId);
 } catch(e){error=e instanceof Error?e.message:String(e);}
 const run=(await getRun(pool,runId))!;
 const reports=(await pool.query("SELECT id FROM reports WHERE run_id=$1",[runId])).rows;
 const report=reports[0]?(await baseline.inject({method:"GET",url:`/v1/reports/${reports[0].id}`,headers})).json():null;
 const passages=await pool.query("SELECT p.id,p.source_version_id,p.exact_text,p.locator,v.access_level,p.extraction_method FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id WHERE p.run_id=$1 ORDER BY p.id",[runId]);
 const support=(await pool.query("SELECT claim_revision_id,result FROM scoped_support_results WHERE run_id=$1",[runId])).rows;
 const trace={label,runId,strategy:run.research_strategy,outcome:run.terminal_outcome,error,wallMs:performance.now()-started,modelCalls:model.calls,actualParserCalls:parser.mock.calls.length,report,sources:passages.rows,support,cost:{kind:"fabricated_transport_receipts_not_actual_provider_spend",ledger:await measureRunCost(pool,runId,run.account_id)}};
 traces.push(trace);parser.mockRestore();if(error)throw new Error(error);return trace;
}
it("W08 matched A1/B production document, reopen, source and corrected B versus fresh A1 controls",async()=>{
 const auth=await account();
 try {
  const original=await readFile(new URL("./fixtures/documents/digital-scoped.pdf",import.meta.url));
  const entity=Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>String.fromCharCode(65+n%26)).join("");
  const bytes=Buffer.from(original.toString("latin1").replaceAll("Ardent",entity),"latin1");
  const question=`What does the ${entity} field note say about underwater recording?`;
  const attachment=await upload(auth.headers,bytes);traces.push({task:"MP-DOCUMENT-NEGATION",question,sourceSha256:digest(bytes),sourceClass:"original_synthetic_actual_pdf",entityMutation:"same_length_randomized"});
  const a1=await execute(await admit(baseline,auth.headers,question,attachment),"A1-original",auth.headers);
  const b=await execute(await admit(adaptive,auth.headers,question,await upload(auth.headers,bytes)),"B-original",auth.headers);
  for(const result of [a1,b]) {
   expect(result.outcome).toBe("completed");expect(result.report.blocks[1].text).toBe(`${entity} does not support underwater recording.`);
   expect(result.actualParserCalls).toBe(1);expect(result.support.every(s=>s.result.decision==="supported")).toBe(true);
   const passageId=result.report.blocks[1].citationIds[0];const source=(await baseline.inject({method:"GET",url:`/v1/sources/${passageId}`,headers:auth.headers})).json();
   expect(source.exactText).toContain(result.report.blocks[1].text);expect(source.passageLocator.block).toBe("page:1/block:0");
   expect(source.accessLevel).toBe("partial-text");
  }
  expect(a1.modelCalls).toEqual(b.modelCalls);
  const correctedQuestion=`What firmware does ${entity} require for offline recording?`;
  const correction=await baseline.inject({method:"POST",url:`/v1/runs/${b.runId}/corrections`,headers:auth.headers,payload:{expectedBriefRevision:1,correctionText:"Ask about firmware instead.",patch:{kind:"replace_question",question:correctedQuestion,evidencePolicy:"reuse_snapshot"}}});
  expect(correction.statusCode).toBe(200);
  const child=await execute(correction.json().runId,"B-correction",auth.headers);
  const full=await execute(await admit(baseline,auth.headers,correctedQuestion,await upload(auth.headers,bytes)),"A1-corrected-full-rerun",auth.headers);
  expect(child.strategy).toBe("criterion-adaptive.v1");expect(full.strategy).toBe("iterative-baseline.v1");
  for(const result of [child,full]){expect(result.outcome).toBe("completed");expect(result.report.blocks[1].text).toBe(`${entity} supports offline recording only on firmware 4.2.`);}
  expect(child.actualParserCalls).toBe(0);expect(full.actualParserCalls).toBe(1);
  expect(child.report.blocks[1].citationIds).toEqual(b.report.blocks[1].citationIds);
  expect(full.report.blocks[1].citationIds).not.toEqual(b.report.blocks[1].citationIds);
  expect(child.report.changeSummary.comparison.reusedCitedSourceVersionIds).toHaveLength(1);
  expect((await baseline.inject({method:"GET",url:"/v1/library",headers:auth.headers})).statusCode).toBe(200);
 } finally {await baseline.inject({method:"POST",url:"/v1/account/deletion",headers:auth.headers});}
},120000);
it("W08 both arms retain inaccessible evidence failure with no invented report",async()=>{
 const auth=await account();
 try {
  const bytes=await readFile(new URL("./fixtures/documents/empty-page.pdf",import.meta.url));
  for(const [label,app] of [["A1",baseline],["B",adaptive]] as const){const result=await execute(await admit(app,auth.headers,"What does the document establish?",await upload(auth.headers,bytes)),`${label}-unavailable`,auth.headers);expect(result.outcome).toBe("failed");expect(result.report).toBeNull();expect(result.actualParserCalls).toBe(1);}
 } finally {await baseline.inject({method:"POST",url:"/v1/account/deletion",headers:auth.headers});}
},60000);

it("W08 A1 and B both iterate through the same actual HTML extraction and checked writer",async()=>{
 const auth=await account();
 try {
  const entity=Array.from(crypto.getRandomValues(new Uint8Array(7)),n=>String.fromCharCode(65+n%26)).join("");
  const question=`Does ${entity} support export and offline editing?`;
  vi.spyOn(publicTransport,"safeFetch").mockImplementation(async(url)=>{
   const fact=String(url).endsWith("offline.html")?`${entity} supports offline editing.`:`${entity} supports full export.`;
   const body=`<!doctype html><html><head><title>Technical note</title></head><body><main><article><h1>Feature documentation</h1><p>${fact}</p><p>This original synthetic document is used to test actual saved-byte extraction. Its statements concern the named option and describe the available functionality. The test does not establish any real product capability or comparative research quality.</p></article></main></body></html>`;
   return {url:String(url),body,bytes:Buffer.from(body),status:200,mime:"text/html",redirectChain:[]};
  });
  const results=[];
  for(const [label,app] of [["A1",baseline],["B",adaptive]] as const){
   const response=await app.inject({method:"POST",url:"/v1/runs",headers:{...auth.headers,"idempotency-key":crypto.randomUUID()},payload:{question,routeMode:"controlled-research",attachmentIds:[]}});expect(response.statusCode).toBe(200);
   const result=await execute(response.json().runId,`${label}-iterative-public`,auth.headers,true);results.push(result);
   expect(result.outcome).toBe("completed");expect(result.actualParserCalls).toBe(2);
   const prose=result.report.blocks.map((b:{text:string})=>b.text).join(" ");expect(prose).toContain(`${entity} supports full export.`);expect(prose).toContain(`${entity} supports offline editing.`);
  }
  expect(results[0]!.modelCalls.filter(c=>c.startsWith("search:"))).toEqual([`search:${question}`,"search:export","search:offline editing"]);
  expect(results[1]!.modelCalls.filter(c=>c.startsWith("search:"))).toEqual([`search:${question}`,"search:offline editing"]);
 } finally {await baseline.inject({method:"POST",url:"/v1/account/deletion",headers:auth.headers});}
},120000);

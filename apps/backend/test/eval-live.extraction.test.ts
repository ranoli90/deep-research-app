import {afterAll,afterEach,beforeAll,expect,it,vi} from "vitest";
import {mkdir,writeFile,mkdtemp,readFile} from "node:fs/promises";
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
import * as attachmentStore from "../src/modules/attachments.js";
import * as executor from "../src/worker/executor.js";
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
async function setup(frozen?:{source:any;bytes:Buffer},additional:{source:any;bytes:Buffer}[]=[]){
 const account=await withTx(pool,async db=>{const a=await createDevSession(db);await grantConsent(db,a.accountId);return a;});
 const grant:Authorization={version:"matched-evaluation-authorization.v1",approvalId:crypto.randomUUID(),approvalReference:"synthetic-control-not-paid-approval",issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),protocolSha256:"0".repeat(64),freezeSha256:"0".repeat(64),taskIds:["MC-D01"],budgetMicro:1000000,accountId:account.accountId,budgetScope:`evaluation:${crypto.randomUUID()}`,sourceMode:"live_discovery",exclusiveDatabaseAcknowledged:true};
 const config=loadConfig({NODE_ENV:"test",DATABASE_URL:testDatabaseUrl,DEV_ALLOW_FIXTURE_ROUTE:"false",LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",STRUCTURED_DISCOVERY_ENABLED:"true",LIVE_RETRIEVAL_ENABLED:"true",OPENROUTER_API_KEY:`nonbillable-${crypto.randomUUID()}`,LIVE_SPEND_CAP_MICRO:"1000000",LIVE_KEY_SPEND_CAP_MICRO:"1000000",WRITING_CANCEL_WINDOW_MS:"1"});
 if(frozen)grant.sourceMode="frozen_supplied_document";
 const driver=await productionDriver(pool,boss,config,grant,account.token,frozen?new Map([frozen,...additional].map(d=>[d.source.id,d])):undefined,async event=>{traces.push(event)});return {driver,config,grant,account};
}
it("executes the same API/worker/parser/writer/checker for paired originals, correction and full rerun with durable trace",async()=>{
 const x=await setup();const model=matchedDocumentModel();globalThis.fetch=model.transport;const read=vi.spyOn(transport,"safeFetch").mockImplementation(async url=>{const body='<html><body><h1>Field note</h1><p>Ardent does not support underwater recording.</p><p>Ardent supports offline recording only on firmware 4.2.</p><p>This original synthetic document provides deliberately fabricated control statements about the named device. It tests the common production evidence path and does not establish actual product capabilities.</p></body></html>';return {url:String(url),body,bytes:Buffer.from(body),status:200,mime:"text/html",redirectChain:[]};});
 const plan:RegisteredPlan={authorization:x.grant,tasks:[{id:"MC-D01",index:0,repetitions:1,question:"What does Ardent say about underwater recording?",correctedQuestion:"What firmware does Ardent require for offline recording?"}],registeredTaskIds:["MC-D01"],unselectedTaskIds:[],protocolHash:"0".repeat(64),freezeHash:"0".repeat(64),tasksHash:"0".repeat(64),sourcesHash:"0".repeat(64)};
 const events:any[]=[];traces.push({kind:"four_run_and_replay",events});
 try{
  const result=await runMatched(plan,x.driver,async e=>{events.push(e)});expect(result).toEqual({expectedSteps:4,recordedResults:4,halted:null});
  const rows=events.filter(e=>e.event==="result").map(e=>e.receipt);expect(rows.map(r=>r.trace.strategy)).toEqual(["iterative-baseline.v1","criterion-adaptive.v1","criterion-adaptive.v1","iterative-baseline.v1"]);
  for(const row of rows){expect(row.outcome).toBe("completed");expect(row.trace.report.blocks.length).toBeGreaterThan(0);expect(row.trace.passages.length).toBeGreaterThan(0);expect(row.trace.support.length).toBeGreaterThan(0);expect(row.trace.attempts.length).toBeGreaterThan(0);expect(row.trace.operations.length).toBeGreaterThan(0);expect(row.trace.extraction.length).toBeGreaterThan(0);expect(row.trace.artifacts.length).toBeGreaterThan(0);expect(createHash("sha256").update(Buffer.from(row.trace.artifacts[0].bytes_base64,"base64")).digest("hex")).toBe(row.trace.artifacts[0].digest);expect(row.trace.extraction[0].extraction.version).toBe("trafilatura-2.2.0/structure-v4");expect(row.cost.heldMicro).toBe(0);}
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

it.each(["pdf","html"] as const)("frozen %s pairs use exact owned uploads, actual parser, inherited correction and replay without discovery",async kind=>{
 const entity=kind==="pdf"?"Ardent":`Device${crypto.randomUUID().replaceAll("-","")}`;
 const bytes=kind==="pdf"?await readFile(new URL("./fixtures/documents/digital-scoped.pdf",import.meta.url)):Buffer.from(`<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Saved field note</h1><p>${entity} does not support underwater recording.</p><p>${entity} supports offline recording only on firmware 4.2.</p><script src="https://example.invalid/tracker">FABRICATED_SCRIPT_ASSERTION</script><p>This synthetic document tests exact byte ingestion and scoped evidence handling. Its statements are fabricated, not actual product capabilities.</p></body></html>`);
 const source={id:`synthetic-${kind}`,file:`document.${kind}`,mime:kind==="pdf"?"application/pdf":"text/html",sha256:createHash("sha256").update(bytes).digest("hex")};
 const x=await setup({source,bytes});const model=matchedDocumentModel();globalThis.fetch=model.transport;
 if(kind==="html"){
  const store=attachmentStore.storeAttachment;let seeded=false;
  vi.spyOn(attachmentStore,"storeAttachment").mockImplementation(async(...args)=>{
   const id=await store(...args);
   if(id&&!seeded){seeded=true;await pool.query("UPDATE attachments SET extraction=$2 WHERE id=$1",[id,JSON.stringify({version:"trafilatura-2.2.0/structure-v3",digest:source.sha256,status:"partial",warnings:[],blocks:[{kind:"text",locator:"block:0",text:"Old cached extraction omitted the decisive evidence.",rows:[]}]})]);}
   return id;
  });
 }
 const read=vi.spyOn(transport,"safeFetch").mockImplementation(async()=>{throw Error("frozen_mode_must_not_fetch");});
 const plan:RegisteredPlan={authorization:x.grant,tasks:[{id:"MC-D01",index:0,repetitions:1,question:`What does ${entity} say about underwater recording?`,correctedQuestion:`What firmware does ${entity} require for offline recording?`,sources:[source]}],registeredTaskIds:["MC-D01"],unselectedTaskIds:[],protocolHash:"",freezeHash:"",tasksHash:"",sourcesHash:""};
 const events:any[]=[];traces.push({kind:`frozen_${kind}_four_run`,events});
 try{
 expect(await runMatched(plan,x.driver,async e=>{events.push(e)})).toEqual({expectedSteps:4,recordedResults:4,halted:null});
 const rows=events.filter(e=>e.event==="result").map(e=>e.receipt);
 for(const row of rows){expect(row.outcome).toBe("completed");expect(row.trace.extraction).toHaveLength(1);expect(row.trace.extraction[0].extraction.version).toBe(kind==="pdf"?"docling-parse-7.20.0/geometry-v1":"trafilatura-2.2.0/structure-v4");expect(row.trace.artifacts[0].digest).toBe(source.sha256);expect(Buffer.from(row.trace.artifacts[0].bytes_base64,"base64")).toEqual(bytes);expect(row.trace.support.length).toBeGreaterThan(0);expect(JSON.stringify(row.trace.passages)).not.toContain("FABRICATED_SCRIPT_ASSERTION");expect(row.trace.extraction[0].transport.requestedUrl).toMatch(/^attachment:\/\//);}
 expect(JSON.stringify(rows[0].trace.report)).toContain("does not support underwater recording");
 expect(JSON.stringify(rows[2].trace.report)).toContain("only on firmware 4.2");
 expect(JSON.stringify(rows[3].trace.report)).toContain("only on firmware 4.2");
 expect(rows[2].trace.passages.map((p:any)=>p.id)).toEqual(rows[1].trace.passages.map((p:any)=>p.id));expect(rows[3].trace.passages[0].id).not.toBe(rows[1].trace.passages[0].id);
 expect((await pool.query("SELECT count(*)::int n FROM attachments WHERE account_id=$1",[x.account.accountId])).rows[0].n).toBe(3);
 const calls=model.calls.length;expect((await runMatched(plan,x.driver,async()=>{})).recordedResults).toBe(4);expect(model.calls.length).toBe(calls);
 expect((await pool.query("SELECT count(*)::int n FROM attachments WHERE account_id=$1",[x.account.accountId])).rows[0].n).toBe(3);expect(read).not.toHaveBeenCalled();expect(model.calls.some(c=>c.startsWith("search:"))).toBe(false);
 }finally{await x.driver.close();}
},120000);
it("unreadable frozen PDF retains attempted version and original bytes with no supporting passages",async()=>{
 const bytes=await readFile(new URL("./fixtures/documents/empty-page.pdf",import.meta.url));const source={id:"empty-pdf",file:"empty.pdf",mime:"application/pdf",sha256:createHash("sha256").update(bytes).digest("hex")};
 const x=await setup({source,bytes});globalThis.fetch=matchedDocumentModel().transport;
 try{
 const run=await x.driver.admit({id:"empty",taskId:"MC-D01",repeat:1,arm:"A1",kind:"original",question:"What does the document support?",idempotencyKey:crypto.randomUUID(),sources:[source]});
 const receipt=await x.driver.execute(run.runId);traces.push({kind:"unreadable_frozen_pdf",receipt});expect(receipt.reportId).toBeNull();const trace=receipt.trace as any;expect(trace.passages).toHaveLength(0);expect(trace.extraction).toHaveLength(1);expect(trace.artifacts[0].digest).toBe(source.sha256);expect(trace.extraction[0].extraction.blocks).toHaveLength(0);
 await pool.query("UPDATE source_versions SET content_hash=$2 WHERE id=$1",[trace.extraction[0].source_version_id,"0".repeat(64)]);
 await expect(x.driver.execute(run.runId)).rejects.toThrow("evaluation_receipt_identity_unconfirmed");
 }finally{await x.driver.close();}
},60000);
it("registered official frozen PDFs traverse owned admission and real extraction without a semantic success claim",async()=>{
 const execute=executor.processRun;vi.spyOn(executor,"processRun").mockImplementation(async(...args)=>{try{return await execute(...args);}catch(error){console.info("synthetic official document worker failure",error);throw error;}});
 const {registeredPlan}=await import("../src/evaluation/authorization.js");const {loadFrozenDocuments}=await import("../src/evaluation/frozen-documents.js");
 const root=new URL("../../../",import.meta.url),base=new URL("evals/matched-pipeline/",root);
 const [protocol,freeze,tasks,sources]=await Promise.all(["model-protocol.json","FREEZE.json","tasks.json","sources.json"].map(name=>readFile(new URL(name,base),"utf8")));
 for(const sourceId of ["rfc9112","tmp117","esp32"]){
  const task=JSON.parse(tasks!).tasks.find((t:any)=>t.sourceIds.includes(sourceId));
  const grant={sourceMode:"frozen_supplied_document",protocolSha256:createHash("sha256").update(protocol!).digest("hex"),freezeSha256:createHash("sha256").update(freeze!).digest("hex"),taskIds:[task.id]} as Authorization;
  const plan=registeredPlan(grant,{protocol:protocol!,freeze:freeze!,tasks:tasks!,sources:sources!});
  const docs=await loadFrozenDocuments(plan,new URL("verification/v6/matched-corpus/raw",root).pathname),document=docs.get(sourceId)!;
  const x=await setup(document);globalThis.fetch=matchedDocumentModel().transport;
  const read=vi.spyOn(transport,"safeFetch").mockImplementation(async()=>{throw Error("frozen_mode_must_not_fetch");});
  try{
   const admitted=await x.driver.admit({id:sourceId,taskId:task.id,repeat:1,arm:"A1",kind:"original",question:task.question,idempotencyKey:crypto.randomUUID(),sources:[document.source]});
   const receipt=await x.driver.execute(admitted.runId);traces.push({kind:"official_pdf_ingestion_only_no_semantic_score",sourceId,receipt});
   const trace=receipt.trace as any;expect(trace.extraction).toHaveLength(1);expect(trace.artifacts[0].digest).toBe(document.source.sha256);expect(Buffer.from(trace.artifacts[0].bytes_base64,"base64")).toEqual(document.bytes);expect(trace.extraction[0].extraction.version).toBe("docling-parse-7.20.0/geometry-v1");expect(trace.passages.length).toBeGreaterThan(0);expect(trace.supplied).toHaveLength(1);expect(read).not.toHaveBeenCalled();expect(receipt.reportId).toBeNull();expect(receipt.cost.unknownIntents).toBe(0);
   expect(trace.events.every((e:any)=>e.run_id===admitted.runId&&e.account_id===x.account.accountId)).toBe(true);
   expect(trace.events.map((e:any)=>Number(e.sequence))).toEqual(trace.events.map((e:any)=>Number(e.sequence)).sort((a:number,b:number)=>a-b));
   expect(trace.events.find((e:any)=>e.type==="research_unresolved")?.payload.reason).toBe(sourceId==="esp32"?"model_context_exceeds_policy":"no_relevant_assertions");
  }finally{await x.driver.close();read.mockRestore();}
 }
},120000);

it("registered SQLite HTML retains decisive restrictions through owned API and real extraction",async()=>{
 const {registeredPlan}=await import("../src/evaluation/authorization.js"),{loadFrozenDocuments}=await import("../src/evaluation/frozen-documents.js");
 const root=new URL("../../../",import.meta.url),base=new URL("evals/matched-pipeline/",root);
 const [protocol,freeze,tasks,sources]=await Promise.all(["model-protocol.json","FREEZE.json","tasks.json","sources.json"].map(name=>readFile(new URL(name,base),"utf8")));
 const task=JSON.parse(tasks!).tasks.find((t:any)=>t.sourceIds.includes("sqlite-wal"));
 const grant={sourceMode:"frozen_supplied_document",protocolSha256:createHash("sha256").update(protocol!).digest("hex"),freezeSha256:createHash("sha256").update(freeze!).digest("hex"),taskIds:[task.id]} as Authorization;
 const plan=registeredPlan(grant,{protocol:protocol!,freeze:freeze!,tasks:tasks!,sources:sources!});
 const docs=await loadFrozenDocuments(plan,new URL("verification/v6/matched-corpus/raw",root).pathname),document=docs.get("sqlite-wal")!;
 const x=await setup(document);globalThis.fetch=matchedDocumentModel().transport;
 const read=vi.spyOn(transport,"safeFetch").mockImplementation(async()=>{throw Error("frozen_mode_must_not_fetch");});
 try{
  const admitted=await x.driver.admit({id:"sqlite",taskId:task.id,repeat:1,arm:"A1",kind:"original",question:task.question,idempotencyKey:crypto.randomUUID(),sources:[document.source]});
  const receipt=await x.driver.execute(admitted.runId);traces.push({kind:"official_html_ingestion_only_no_semantic_score",sourceId:"sqlite-wal",receipt});
  const trace=receipt.trace as any;expect(trace.extraction).toHaveLength(1);expect(trace.extraction[0].extraction.version).toBe("trafilatura-2.2.0/structure-v4");
  expect(trace.artifacts[0].digest).toBe(document.source.sha256);expect(Buffer.from(trace.artifacts[0].bytes_base64,"base64")).toEqual(document.bytes);
  expect(trace.passages.some((p:any)=>/does not work over a network filesystem/.test(p.exact_text))).toBe(true);
  expect(trace.passages.some((p:any)=>/only be one writer at a time/.test(p.exact_text))).toBe(true);
  expect(trace.passages.every((p:any)=>p.locator&&p.source_digest===document.source.sha256)).toBe(true);
  expect(trace.supplied[0].mime).toBe("text/html");expect(read).not.toHaveBeenCalled();
  expect(receipt.reportId).toBeNull();expect(receipt.cost.unknownIntents).toBe(0);
  expect(trace.events.find((e:any)=>e.type==="research_unresolved")?.payload.reason).toBe("no_relevant_assertions");
 }finally{await x.driver.close();}
},60000);

it("expiry after first awaited upload prevents second upload, admission and provider work",async()=>{
 const bytes=await readFile(new URL("./fixtures/documents/digital-scoped.pdf",import.meta.url));const source={id:"first",file:"first.pdf",mime:"application/pdf",sha256:createHash("sha256").update(bytes).digest("hex")},second={...source,id:"second",file:"second.pdf"};
 const x=await setup({source,bytes},[{source:second,bytes}]);const store=attachmentStore.storeAttachment;
 const upload=vi.spyOn(attachmentStore,"storeAttachment").mockImplementation(async(...args)=>{const id=await store(...args);x.grant.expiresAt=new Date(Date.now()-1).toISOString();return id;});const provider=vi.fn();globalThis.fetch=provider as typeof fetch;
 try{
 await expect(x.driver.admit({id:"expiry",taskId:"MC-D01",repeat:1,arm:"A1",kind:"original",question:"Document fact?",idempotencyKey:crypto.randomUUID(),sources:[source,second]})).rejects.toThrow("approval_expired");
 expect(upload).toHaveBeenCalledOnce();expect(provider).not.toHaveBeenCalled();expect((await pool.query("SELECT count(*)::int n FROM attachments WHERE account_id=$1",[x.account.accountId])).rows[0].n).toBe(1);expect((await pool.query("SELECT count(*)::int n FROM runs WHERE account_id=$1",[x.account.accountId])).rows[0].n).toBe(0);
 traces.push({kind:"expiry_after_first_upload",accountId:x.account.accountId,retainedAttachments:1,admittedRuns:0,providerCalls:0});
 }finally{await x.driver.close();}
});
it("changed bytes cannot reuse a frozen slot upload identity to admit different evidence",async()=>{
 const bytes=await readFile(new URL("./fixtures/documents/digital-scoped.pdf",import.meta.url));const source={id:"doc",file:"document.pdf",mime:"application/pdf",sha256:createHash("sha256").update(bytes).digest("hex")};const x=await setup({source,bytes});
 const step={id:"changed",taskId:"MC-D01",repeat:1,arm:"A1" as const,kind:"original" as const,question:"Document fact?",idempotencyKey:crypto.randomUUID(),sources:[source]};const provider=vi.fn();globalThis.fetch=provider as typeof fetch;
 try{
 const first=await x.driver.admit(step);bytes[bytes.length-1]=bytes[bytes.length-1]===10?32:10;source.sha256=createHash("sha256").update(bytes).digest("hex");
 await expect(x.driver.admit(step)).rejects.toThrow("frozen_upload_unconfirmed");expect(provider).not.toHaveBeenCalled();expect((await pool.query("SELECT count(*)::int n FROM runs WHERE account_id=$1",[x.account.accountId])).rows[0].n).toBe(1);traces.push({kind:"changed_bytes_replay_rejected",runId:first.runId});
 }finally{await x.driver.close();}
});
it.each(["bodyless_fetch","http_error_body","parser_throw"] as const)("retains legitimate unavailable public read receipt %s and rejects fabricated success or digest",async kind=>{
 const x=await setup();const model=matchedDocumentModel();globalThis.fetch=model.transport;
 const failureBytes=kind==="parser_throw"?Buffer.from([0xff,0xfe,0xff]):Buffer.from("Synthetic unavailable service");
 vi.spyOn(transport,"safeFetch").mockImplementation(async url=>{if(kind==="bodyless_fetch")throw Error("Synthetic unavailable transport");return {url:String(url),body:failureBytes.toString(),bytes:failureBytes,status:kind==="parser_throw"?200:503,mime:"text/plain",redirectChain:[]};});
 try{
 const admitted=await x.driver.admit({id:kind,taskId:"MC-D01",repeat:1,arm:"A1",kind:"original",question:"What does Ardent say about underwater recording?",idempotencyKey:crypto.randomUUID()});
 const result=await x.driver.execute(admitted.runId);traces.push({kind:`legitimate_${kind}`,receipt:result});const trace=result.trace as any;
 expect(result.lifecycle).toBe("terminal");expect(result.reportId).toBeNull();expect(trace.passages).toHaveLength(0);expect(trace.extraction.length).toBeGreaterThan(0);
 const receipt=trace.extraction[0];expect(receipt.transport.outcome).toBe(kind==="bodyless_fetch"?"fetch_unavailable":kind==="parser_throw"?"extraction_unavailable":"unavailable_status");expect(receipt.extraction.status).toBe("unavailable");expect(receipt.extraction.blocks).toHaveLength(0);
 if(kind==="bodyless_fetch"){expect(receipt.artifact_id).toBeNull();expect(receipt.source_digest).toBeNull();expect(trace.artifacts).toHaveLength(0);}else{expect(trace.artifacts.length).toBeGreaterThan(0);expect(receipt.source_digest).toBe(createHash("sha256").update(failureBytes).digest("hex"));}
 const calls=model.calls.length;
 await pool.query("UPDATE extraction_receipts SET transport=jsonb_set(transport,'{outcome}','\"successful_body\"'::jsonb) WHERE source_version_id=$1",[receipt.source_version_id]);
 await expect(x.driver.execute(admitted.runId)).rejects.toThrow("evaluation_receipt_identity_unconfirmed");
 await pool.query("UPDATE extraction_receipts SET transport=$2 WHERE source_version_id=$1",[receipt.source_version_id,JSON.stringify(receipt.transport)]);
 await pool.query("UPDATE source_versions SET content_hash=$2 WHERE id=$1",[receipt.source_version_id,"0".repeat(64)]);
 await expect(x.driver.execute(admitted.runId)).rejects.toThrow("evaluation_receipt_identity_unconfirmed");expect(model.calls.length).toBe(calls);
 }finally{await x.driver.close();}
},60000);

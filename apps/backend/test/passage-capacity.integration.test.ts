/** Real PostgreSQL/production worker; fabricated model and extraction receipts, no live semantic claim. */
import { createHash } from "node:crypto";
import { afterAll,afterEach,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import { CreateRunRequestSchema,CorrectionRequestSchema,RequestedVerificationRequestSchema } from "@deep/contracts";
import { createPool,migrate,withTx } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";
import { createDevSession,grantConsent,deleteAccount } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { admitResearchCorrection } from "../src/modules/research-corrections.js";
import { admitRequestedVerification,loadVerification } from "../src/modules/requested-verification.js";
import { insertSource,insertExtractedVersion } from "../src/modules/evidence.js";
import { getLatestReportForRun } from "../src/modules/reports.js";
import { processRun } from "../src/worker/executor.js";
import { matchedDocumentModel } from "./helpers/matched-model.js";
const url=process.env.TEST_DATABASE_URL!;let pool:pg.Pool;const accounts:string[]=[],originalFetch=globalThis.fetch;
const config=loadConfig({DATABASE_URL:url,NODE_ENV:"test",APP_AUTH_MODE:"development",LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",LIVE_RETRIEVAL_ENABLED:"true",OPENROUTER_API_KEY:"nonbillable-capacity",LIVE_KEY_SPEND_CAP_MICRO:"1000000000",LIVE_SPEND_CAP_MICRO:"1000000",LIVE_BUDGET_SCOPE:crypto.randomUUID()});
const fact="Ardent supports offline recording only on firmware 4.2.";
beforeAll(async()=>{pool=createPool(url);await migrate(pool);});
afterEach(async()=>{globalThis.fetch=originalFetch;for(const id of accounts.splice(0))await deleteAccount(pool,id);});
afterAll(async()=>{await pool.end();});
async function setup(count:number,size=100,contradiction=false){
 const accountId=await withTx(pool,async db=>{const s=await createDevSession(db);await grantConsent(db,s.accountId);return s.accountId;});accounts.push(accountId);
 const run=await admitRun(pool,accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question:"Which firmware supports Ardent offline recording?",routeMode:"controlled-research"}));
 const locator="https://example.org/synthetic-capacity.txt",sourceId=await insertSource(pool,{accountId,runId:run.runId,locator,title:"Synthetic firmware note",publisher:"Synthetic",originCluster:"synthetic",sourceType:"web"});
 const texts=Array.from({length:count},(_,i)=>i===count-1?(contradiction?"Ardent does not support offline recording on firmware 4.2.":fact):contradiction&&i===0?fact:`Background ${i}. ${"x".repeat(size)}`),bytes=Buffer.from(texts.join("\n")),digest=createHash("sha256").update(bytes).digest("hex");
 await insertExtractedVersion(pool,{accountId,runId:run.runId,sourceId,bytes,receipt:{requestedUrl:locator,finalUrl:locator,redirectChain:[],status:200,mime:"text/plain",retrievedAt:new Date().toISOString(),outcome:"successful_body"},extraction:{version:"utf8-notes-v1",digest,status:"extracted",warnings:[],blocks:texts.map((text,i)=>({kind:"text",locator:`paragraph:${i}`,text,rows:[]}))}});
 // Stable UUID order makes the limiting statement demonstrably later than the former 24-passages boundary.
 const prefix=crypto.randomUUID().slice(0,24);
 const rows=(await pool.query("SELECT id,locator FROM passages WHERE run_id=$1",[run.runId])).rows;
 for(const row of rows){const i=Number(row.locator.block.split(":")[1]);await pool.query("UPDATE passages SET id=$2 WHERE id=$1",[row.id,`${prefix}${String(i+1).padStart(12,"0")}`]);}
 const basis=(await pool.query("SELECT id,content_hash AS digest,exact_text AS text,source_version_id AS version FROM passages WHERE run_id=$1 ORDER BY id",[run.runId])).rows;
 const model=matchedDocumentModel(),contexts:Array<{operation:string;context:any}>=[];
 globalThis.fetch=async(input,init)=>{const body=JSON.parse(String(init?.body));if(body.plugins?.length)return new Response(JSON.stringify({id:"nonbillable-empty-search",model:"openai/gpt-4o-mini",provider:"OpenAI",usage:{cost:"0.000003"},choices:[{finish_reason:"stop",message:{annotations:[]}}]}));contexts.push({operation:body.response_format.json_schema.name,context:JSON.parse(body.messages[1].content)});return model.transport(input,init);};
 return{accountId,run,basis,contexts,model};
}
it("W05 sends all 25 whole passages including the late firmware limitation, replays, and restores requested verification",async()=>{
 const x=await setup(25);await processRun(pool,config,x.run.runId);
 const report=await getLatestReportForRun(pool,x.run.runId,x.accountId);expect(report,JSON.stringify((await pool.query("SELECT payload FROM run_events WHERE run_id=$1",[x.run.runId])).rows)).toBeTruthy();
 const extraction=x.contexts.find(c=>c.operation==="research_extract_assertions_v1")!.context;
 expect(extraction.passages.map((p:any)=>({id:p.id,digest:p.digest,text:p.text,version:p.sourceVersionId}))).toEqual(x.basis);
 expect(extraction.passages[24].text).toBe(fact);
 for(const operation of ["research_assess_support_v1","research_write_report_v1"]){const c=x.contexts.find(c=>c.operation===operation)!.context;expect(c.passages).toEqual(extraction.passages);expect(c.passages[24].text).toBe(fact);}
expect(report!.blocks.map((b:any)=>b.text).join("\n")).toContain(fact);
 const calls=x.contexts.length;await processRun(pool,config,x.run.runId);expect(x.contexts).toHaveLength(calls);
 const check=await admitRequestedVerification(pool,config,x.accountId,x.run.runId,RequestedVerificationRequestSchema.parse({version:"requested-verification.v1",reportId:report!.id,reportVersion:report!.version,claimId:report!.claim_ids[0],evidencePolicy:"reuse_snapshot",idempotencyKey:crypto.randomUUID(),note:""}));
 await processRun(pool,config,check.runId);expect(await getLatestReportForRun(pool,check.runId,x.accountId)).toBeTruthy();
 expect((await loadVerification(pool,{runId:check.runId,accountId:x.accountId,briefRevision:check.briefRevision})).target.passages).toEqual(x.basis.map(p=>({id:p.id,digest:p.digest})));
 const checked=x.contexts.at(-1)!.context;expect(checked.passages.map((p:any)=>p.id)).toEqual(x.basis.map(p=>p.id));expect(checked.passages[24].text).toBe(fact);
 const correction=await admitResearchCorrection(pool,x.accountId,x.run.runId,CorrectionRequestSchema.parse({expectedBriefRevision:1,correctionText:"Clarify exact firmware",patch:{kind:"replace_question",question:"What exact firmware supports Ardent offline recording?",evidencePolicy:"reuse_snapshot"}}));
 await processRun(pool,{...config,structuredDiscoveryEnabled:true},correction.runId);expect(await getLatestReportForRun(pool,correction.runId,x.accountId)).toBeTruthy();
 const corrected=x.contexts.filter(c=>c.operation==="research_extract_assertions_v1").at(-1)!.context;
 expect(corrected.passages).toEqual(extraction.passages);
});
it("W05 accepts 128 complete small passages at the bounded capacity",async()=>{const x=await setup(128);await processRun(pool,config,x.run.runId);expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeTruthy();expect(x.contexts.find(c=>c.operation==="research_extract_assertions_v1")!.context.passages).toHaveLength(128);},120_000);
it.each([{count:129,size:100,reason:"invalid_extraction_selection"},{count:25,size:7000,reason:"model_context_exceeds_policy"}])("W02 rejects $count passages / $size characters before extraction issuance",async({count,size,reason})=>{
 const x=await setup(count,size);await processRun(pool,config,x.run.runId);expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeNull();
 expect(x.contexts.map(c=>c.operation)).toEqual(["research_brief_v1"]);
 const operations=(await pool.query("SELECT operation FROM model_operation_results WHERE run_id=$1",[x.run.runId])).rows;expect(operations).toEqual([{operation:"brief"}]);
 expect((await pool.query("SELECT count(*)::int AS n FROM provider_intents WHERE run_id=$1",[x.run.runId])).rows[0].n).toBe(1);
 expect(JSON.stringify((await pool.query("SELECT payload FROM run_events WHERE run_id=$1",[x.run.runId])).rows)).toContain(reason);
});

it("W01 observes a contradiction at passage25 and cannot publish the positive claim",async()=>{const x=await setup(25,100,true);await processRun(pool,config,x.run.runId);const support=x.contexts.find(c=>c.operation==="research_assess_support_v1");expect(support,JSON.stringify((await pool.query("SELECT payload FROM run_events WHERE run_id=$1",[x.run.runId])).rows)).toBeTruthy();const assessment=support!.context;expect(assessment.passages).toHaveLength(25);expect(assessment.passages[24].text).toBe("Ardent does not support offline recording on firmware 4.2.");expect((await pool.query("SELECT decision FROM scoped_support_results WHERE run_id=$1",[x.run.runId])).rows).toEqual([{decision:"disputed"}]);expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeNull();});

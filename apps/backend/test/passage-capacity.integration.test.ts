import { writeFileSync } from "node:fs";
import { claimLease } from "../src/modules/runs.js";
import { fencedSession } from "../src/worker/fenced-session.js";
import { extractEvidenceAssertions } from "../src/worker/assertion-extraction.js";
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
const config=loadConfig({DATABASE_URL:url,NODE_ENV:"test",APP_AUTH_MODE:"development",LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",LIVE_RETRIEVAL_ENABLED:"true",OPENROUTER_API_KEY:"nonbillable-capacity",LIVE_KEY_SPEND_CAP_MICRO:"1000000000",LIVE_SPEND_CAP_MICRO:"1000000",LIVE_BUDGET_SCOPE:crypto.randomUUID(),LEASE_MS:"180000"});
const fact="Ardent supports offline recording only on firmware 4.2.";
beforeAll(async()=>{pool=createPool(url);await migrate(pool);});
afterEach(async()=>{globalThis.fetch=originalFetch;for(const id of accounts.splice(0))await deleteAccount(pool,id);});
afterAll(async()=>{await pool.end();});
async function setup(count:number,size=100,contradiction=false,underwater=false,omittedOpposite=false,emptyFirst=false){
 const accountId=await withTx(pool,async db=>{const s=await createDevSession(db);await grantConsent(db,s.accountId);return s.accountId;});accounts.push(accountId);
 const run=await admitRun(pool,accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question:"Which firmware supports Ardent offline recording?",routeMode:"controlled-research"}));
 const locator="https://example.org/synthetic-capacity.txt",sourceId=await insertSource(pool,{accountId,runId:run.runId,locator,title:"Synthetic firmware note",publisher:"Synthetic",originCluster:"synthetic",sourceType:"web"});
 const texts=Array.from({length:count},(_,i)=>omittedOpposite&&i===11?"Ardent does not support offline recording on firmware 4.2.":i===count-1?(contradiction?"Ardent does not support offline recording on firmware 4.2.":fact):underwater&&i===count-2?"Ardent does not support underwater recording.":contradiction&&i===0?fact:`Background ${i}. ${emptyFirst?"Which firmware supports Ardent offline recording? ":""}${"x".repeat(omittedOpposite&&[9,10,12,13].includes(i)?23980:size)}`),bytes=Buffer.from(texts.join("\n")),digest=createHash("sha256").update(bytes).digest("hex");
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
},120_000);
it("W05 accepts 128 complete small passages at the bounded capacity",async()=>{const x=await setup(128);await processRun(pool,config,x.run.runId);expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeTruthy();expect(x.contexts.find(c=>c.operation==="research_extract_assertions_v1")!.context.passages).toHaveLength(128);},120_000);
it.each([{count:129,size:100,reason:"invalid_extraction_selection"},{count:25,size:7000,reason:"model_context_exceeds_policy"}])("W02 rejects $count passages / $size characters before extraction issuance",async({count,size,reason})=>{
 const x=await setup(count,size);await processRun(pool,config,x.run.runId,{pauseAt:"researching"});
 const owner=crypto.randomUUID(),fence=(await claimLease(pool,x.run.runId,owner,60000))!,session=fencedSession(pool,{accountId:x.accountId,runId:x.run.runId,owner,fence,briefRevision:1,leaseMs:60000});
 try{const task=(await pool.query("SELECT id FROM research_tasks WHERE run_id=$1",[x.run.runId])).rows[0];
 const result=await extractEvidenceAssertions(pool,config,session,{accountId:x.accountId,runId:x.run.runId,fence,briefRevision:1,taskId:task.id,passageIds:x.basis.map(p=>p.id)});expect(result).toEqual({kind:"blocked",reason});
 }finally{session.stop();}
 expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeNull();
 expect(x.contexts.map(c=>c.operation)).toEqual(["research_brief_v1"]);
 const operations=(await pool.query("SELECT operation FROM model_operation_results WHERE run_id=$1",[x.run.runId])).rows;expect(operations).toEqual([{operation:"brief"}]);
 expect((await pool.query("SELECT count(*)::int AS n FROM provider_intents WHERE run_id=$1",[x.run.runId])).rows[0].n).toBe(1);
 // Direct oversize input remains rejected before extraction issuance; worker selection is tested separately.
});

it("W01 observes a contradiction at passage25 and cannot publish the positive claim",async()=>{const x=await setup(25,100,true);await processRun(pool,config,x.run.runId);const support=x.contexts.find(c=>c.operation==="research_assess_support_v1");expect(support,JSON.stringify((await pool.query("SELECT payload FROM run_events WHERE run_id=$1",[x.run.runId])).rows)).toBeTruthy();const assessment=support!.context;expect(assessment.passages).toHaveLength(25);expect(assessment.passages[24].text).toBe("Ardent does not support offline recording on firmware 4.2.");expect((await pool.query("SELECT decision FROM scoped_support_results WHERE run_id=$1",[x.run.runId])).rows).toEqual([{decision:"disputed"}]);expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeNull();});

it.each([{count:129,size:100},{count:25,size:7000}])("W05 selects whole evidence for $count / $size and publishes explicit omissions",async({count,size})=>{
 const x=await setup(count,size);await processRun(pool,config,x.run.runId);
 const report=await getLatestReportForRun(pool,x.run.runId,x.accountId);expect(report).toBeTruthy();expect(report!.outcome).toBe("completed_with_limitations");
 const extraction=x.contexts.find(c=>c.operation==="research_extract_assertions_v1")!.context,selection=extraction.evidenceSelection;
 expect(selection.available).toBe(count);expect(selection.omitted).toBeGreaterThan(0);expect(extraction.passages.length).toBe(selection.selected);
 expect(report!.limitations).toContain(`This assessment selected ${selection.selected} of ${count} available passages. The ${selection.omitted} omitted passages were not included in the model assessment; additional qualifications or counterevidence may remain.`);
 expect(report!.blocks.some((b:{text:string})=>b.text===fact)).toBe(true);
 for(const p of extraction.passages)expect(x.basis).toContainEqual({id:p.id,digest:p.digest,text:p.text,version:p.sourceVersionId});
 expect(extraction.passages.some((p:any)=>p.text===fact)).toBe(true);
 const calls=x.contexts.length;await processRun(pool,config,x.run.runId);expect(x.contexts.length).toBe(calls);
 expect((await getLatestReportForRun(pool,x.run.runId,x.accountId))!.id).toBe(report!.id);
},120_000);

it("W02 terminalizes lost selection proof without another model call or report",async()=>{
 const x=await setup(25,7000);await processRun(pool,config,x.run.runId,{pauseAt:"writing"});const calls=x.contexts.length;
 expect((await pool.query("SELECT count(*)::int AS n FROM evidence_selections WHERE run_id=$1",[x.run.runId])).rows[0].n).toBeGreaterThan(0);
 await pool.query("DELETE FROM evidence_selections WHERE run_id=$1",[x.run.runId]);await processRun(pool,config,x.run.runId);
 expect(x.contexts.length).toBe(calls);expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeNull();
 expect((await pool.query("SELECT lifecycle,terminal_outcome FROM runs WHERE id=$1",[x.run.runId])).rows[0]).toEqual({lifecycle:"terminal",terminal_outcome:"failed"});
 expect(JSON.stringify((await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='research_unresolved'",[x.run.runId])).rows)).toContain("required_selection_proof_missing");
});

it("W02 retains the legacy input manifest and logical request identity for admitted pre-migration runs",async()=>{
 const x=await setup(25);await pool.query("UPDATE runs SET evidence_selection_policy='legacy-all.v1' WHERE id=$1",[x.run.runId]);
 await processRun(pool,config,x.run.runId,{pauseAt:"writing"});
 const contexts=x.contexts.length,extractions=x.contexts.filter(c=>c.operation==="research_extract_assertions_v1").length;
 expect(x.contexts.every(c=>c.context.evidenceSelection===undefined)).toBe(true);
 expect((await pool.query("SELECT count(*)::int AS n FROM evidence_selections WHERE run_id=$1",[x.run.runId])).rows[0].n).toBe(0);
 await processRun(pool,config,x.run.runId);expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeTruthy();
 expect(x.contexts.filter(c=>c.operation==="research_extract_assertions_v1")).toHaveLength(extractions);expect(x.contexts.length).toBeGreaterThan(contexts);
 expect(x.contexts.every(c=>c.context.evidenceSelection===undefined)).toBe(true);
},120_000);

it("W06 changes the requested constraint over an oversized reused document and publishes the newly relevant qualification",async()=>{
 const x=await setup(25,7000,false,true);await processRun(pool,config,x.run.runId);const original=await getLatestReportForRun(pool,x.run.runId,x.accountId);expect(original).toBeTruthy();
 expect(original!.blocks.some((b:{text:string})=>b.text===fact)).toBe(true);
 const correction=await admitResearchCorrection(pool,x.accountId,x.run.runId,CorrectionRequestSchema.parse({expectedBriefRevision:1,correctionText:"The recording must work underwater",patch:{kind:"replace_question",question:"Can Ardent record underwater?",evidencePolicy:"reuse_snapshot"}}));
 await processRun(pool,{...config,structuredDiscoveryEnabled:true},correction.runId);const revised=await getLatestReportForRun(pool,correction.runId,x.accountId);expect(revised,JSON.stringify({events:(await pool.query("SELECT type,payload FROM run_events WHERE run_id=$1",[correction.runId])).rows,support:(await pool.query("SELECT decision,result FROM scoped_support_results WHERE run_id=$1",[correction.runId])).rows})).toBeTruthy();
 expect(revised!.outcome).toBe("completed_with_limitations");expect(revised!.blocks.some((b:{text:string})=>b.text==="Ardent does not support underwater recording.")).toBe(true);
 expect(revised!.blocks.some((b:{text:string})=>b.text===fact)).toBe(false);
 expect((await pool.query("SELECT reused_passages FROM research_change_sets WHERE run_id=$1",[correction.runId])).rows[0].reused_passages).toBe(25);
 expect((await pool.query("SELECT count(*)::int AS n FROM run_evidence_membership WHERE run_id=$1",[correction.runId])).rows[0].n).toBe(25);
 const selections=(await pool.query("SELECT id,run_id,evidence_revision,version,candidates,selection,proof_digest FROM evidence_selections WHERE run_id=ANY($1::uuid[]) ORDER BY run_id,id",[[x.run.runId,correction.runId]])).rows;
 expect(selections).toHaveLength(2);expect(selections[0].id).not.toBe(selections[1].id);
 const extraction=x.contexts.filter(c=>c.operation==="research_extract_assertions_v1");expect(extraction).toHaveLength(2);
 for(const ctx of extraction)for(const p of ctx.context.passages)expect(x.basis).toContainEqual({id:p.id,digest:p.digest,text:p.text,version:p.sourceVersionId});
 if(process.env.EVIDENCE_SELECTION_TRACE_PATH)writeFileSync(process.env.EVIDENCE_SELECTION_TRACE_PATH,JSON.stringify({evidenceClass:"synthetic production-worker and real PostgreSQL; fabricated model/extraction receipts",original,revised,selections,passages:x.basis,contexts:x.contexts,reusedPassages:25,paidCost:0,semanticQuality:null},null,2));
},120_000);


it("W01 rejects a supported selected claim when the immutable omitted inventory contradicts it",async()=>{
 const x=await setup(25,100,false,false,true);await processRun(pool,config,x.run.runId);
 const extraction=x.contexts.find(c=>c.operation==="research_extract_assertions_v1")!.context;
 const opposite=x.basis.find(p=>p.text==="Ardent does not support offline recording on firmware 4.2.")!;
 expect(opposite).toBeTruthy();expect(extraction.passages.some((p:any)=>p.id===opposite.id)).toBe(false);
 expect((await pool.query("SELECT decision FROM scoped_support_results WHERE run_id=$1",[x.run.runId])).rows).toEqual([{decision:"supported"}]);
 const checks=(await pool.query("SELECT decision,result,claim_revision_id,evidence_digest FROM selection_inventory_checks WHERE run_id=$1",[x.run.runId])).rows;
 expect(checks).toHaveLength(1);expect(checks[0].decision).toBe("disputed");expect(JSON.stringify(checks[0].result)).toContain(opposite.id);
 expect(checks[0].evidence_digest).toBe(extraction.evidenceSelection.proofDigest);
 expect((await pool.query("SELECT id FROM claim_revisions WHERE id=$1 AND run_id=$2 AND account_id=$3",[checks[0].claim_revision_id,x.run.runId,x.accountId])).rowCount).toBe(1);
 expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeNull();
 expect(x.contexts.some(c=>c.operation==="research_write_report_v1")).toBe(false);
 const calls=x.contexts.length;await processRun(pool,config,x.run.runId);expect(x.contexts).toHaveLength(calls);
 await deleteAccount(pool,x.accountId);expect((await pool.query("SELECT count(*)::int AS n FROM selection_inventory_checks WHERE account_id=$1",[x.accountId])).rows[0].n).toBe(0);
},120_000);

it("W01 refuses a tampered inventory support receipt before writing",async()=>{
 const x=await setup(25,7000);await processRun(pool,config,x.run.runId,{pauseAt:"writing"});
 expect((await pool.query("UPDATE selection_inventory_checks SET decision='disputed' WHERE run_id=$1 RETURNING selection_id",[x.run.runId])).rowCount).toBeGreaterThan(0);
 const calls=x.contexts.length;await processRun(pool,config,x.run.runId);
 expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeNull();expect(x.contexts).toHaveLength(calls);
 expect(JSON.stringify((await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='research_unresolved'",[x.run.runId])).rows)).toContain("selection_inventory_check_changed");
});

it("W01 restores an admitted result without a cached inventory check by executing the guard again",async()=>{
 const x=await setup(25,7000);await processRun(pool,config,x.run.runId,{pauseAt:"writing"});
 expect((await pool.query("DELETE FROM selection_inventory_checks WHERE run_id=$1 RETURNING selection_id",[x.run.runId])).rowCount).toBeGreaterThan(0);
 const assessments=x.contexts.filter(c=>c.operation==="research_assess_support_v1").length;
 await processRun(pool,config,x.run.runId);expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeTruthy();
 // Writer support is new work; the source assessment's logical request must not be repeated.
 expect(x.contexts.filter(c=>c.operation==="research_assess_support_v1")).toHaveLength(assessments+1);
});


it("W05 recovers an empty selected context by inspecting different whole evidence, then replays without reissuing extraction",async()=>{
 const x=await setup(12,7000,false,false,false,true);await processRun(pool,config,x.run.runId,{pauseAt:"writing"});
 const extractions=x.contexts.filter(c=>c.operation==="research_extract_assertions_v1");
 expect(extractions[0]!.context.passages.some((p:any)=>p.text===fact)).toBe(false);
 expect(extractions.length).toBeGreaterThan(1);
 expect(extractions.at(-1)!.context.passages.some((p:any)=>p.text===fact)).toBe(true);
 const inspected=new Set<string>();for(const call of extractions){expect(call.context.passages.some((p:any)=>!inspected.has(p.id))).toBe(true);for(const p of call.context.passages){inspected.add(p.id);expect(x.basis).toContainEqual({id:p.id,digest:p.digest,text:p.text,version:p.sourceVersionId});}}
 await processRun(pool,config,x.run.runId);const report=await getLatestReportForRun(pool,x.run.runId,x.accountId);
 expect(report!.blocks.some((b:{text:string})=>b.text===fact)).toBe(true);
 expect(x.contexts.filter(c=>c.operation==="research_extract_assertions_v1")).toHaveLength(extractions.length);
 const calls=x.contexts.length;await processRun(pool,config,x.run.runId);expect(x.contexts).toHaveLength(calls);
 if(process.env.EMPTY_RECOVERY_TRACE_PATH)writeFileSync(process.env.EMPTY_RECOVERY_TRACE_PATH,JSON.stringify({evidenceClass:"synthetic real PostgreSQL and production worker; fabricated model/extraction receipts",report,passages:x.basis,contexts:x.contexts,selections:(await pool.query("SELECT * FROM evidence_selections WHERE run_id=$1",[x.run.runId])).rows,support:(await pool.query("SELECT * FROM selection_inventory_checks WHERE run_id=$1",[x.run.runId])).rows,operations:(await pool.query("SELECT operation,input_manifest FROM model_operation_results WHERE run_id=$1",[x.run.runId])).rows,paidCostMicro:0,semanticQuality:null},null,2));
},120_000);

it("W02 preserves no-recovery behavior for an already admitted policy and refuses unknown policy before model cost",async()=>{
 const legacy=await setup(12,7000,false,false,false,true);await pool.query("UPDATE runs SET evidence_recovery_policy='none.v1' WHERE id=$1",[legacy.run.runId]);
 await processRun(pool,config,legacy.run.runId);expect(legacy.contexts.filter(c=>c.operation==="research_extract_assertions_v1")).toHaveLength(1);expect(await getLatestReportForRun(pool,legacy.run.runId,legacy.accountId)).toBeNull();
 const unknown=await setup(12,7000,false,false,false,true);await pool.query("UPDATE runs SET evidence_recovery_policy='unrecognized' WHERE id=$1",[unknown.run.runId]);
 await processRun(pool,config,unknown.run.runId);expect(unknown.contexts).toHaveLength(0);expect((await pool.query("SELECT count(*)::int AS n FROM provider_intents WHERE run_id=$1",[unknown.run.runId])).rows[0].n).toBe(0);
 expect(JSON.stringify((await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='research_unresolved'",[unknown.run.runId])).rows)).toContain("evidence_recovery_policy_unavailable");
});
it("W05 stops empty-context recovery at the existing four-iteration bound with explicit unresolved evidence",async()=>{
 const x=await setup(40,7000,false,false,false,true),transport=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{const body=JSON.parse(String(init?.body));if(body.response_format?.json_schema.name==="research_extract_assertions_v1"){
  x.contexts.push({operation:"research_extract_assertions_v1",context:JSON.parse(body.messages[1].content)});
  return new Response(JSON.stringify({id:"nonbillable-empty-recovery",model:"openai/gpt-4o-mini",provider:"OpenAI",usage:{cost:"0.000001"},choices:[{finish_reason:"stop",message:{content:JSON.stringify({candidates:[],assertions:[],limitations:[]})}}]}));
 }return transport(input,init);};
 await processRun(pool,config,x.run.runId);
 expect(x.contexts.filter(c=>c.operation==="research_extract_assertions_v1")).toHaveLength(4);
 expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeNull();
 expect(JSON.stringify((await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='research_unresolved'",[x.run.runId])).rows)).toContain("evidence_selection_recovery_limit");
});
it("W02 keeps an unknown recovery attempt reserved and never blindly resends it",async()=>{
 const x=await setup(12,7000,false,false,false,true),transport=globalThis.fetch;let extractionAttempts=0;
 globalThis.fetch=async(input,init)=>{const body=JSON.parse(String(init?.body));if(body.response_format?.json_schema.name==="research_extract_assertions_v1"&&++extractionAttempts===2)throw new Error("synthetic_unknown_recovery_transport");return transport(input,init);};
 await processRun(pool,config,x.run.runId);expect(extractionAttempts).toBe(2);expect(await getLatestReportForRun(pool,x.run.runId,x.accountId)).toBeNull();
 const held=(await pool.query("SELECT state,confirmed_micro,reserved_max_micro FROM provider_intents WHERE run_id=$1 AND state='outcome-unknown'",[x.run.runId])).rows;
 expect(held).toHaveLength(1);expect(held[0].confirmed_micro).toBeNull();expect(Number(held[0].reserved_max_micro)).toBeGreaterThan(0);
 await processRun(pool,config,x.run.runId);expect(extractionAttempts).toBe(2);
 expect((await pool.query("SELECT state,confirmed_micro,reserved_max_micro FROM provider_intents WHERE run_id=$1 AND state='outcome-unknown'",[x.run.runId])).rows).toEqual(held);
});

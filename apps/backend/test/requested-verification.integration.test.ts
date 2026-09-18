import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import type PgBoss from "pg-boss";
import type { FastifyInstance } from "fastify";
import { reportCompletionCovered } from "../src/modules/publication-coverage.js";
import { createHash } from "node:crypto";
import * as sourceReader from "../src/adapters/retrieval/read-source.js";
import { insertSource,insertVersionAndPassage } from "../src/modules/evidence.js";
import { resolveAdmission } from "../src/modules/admission-recovery.js";
import { afterAll,afterEach,beforeAll,expect,it,vi } from "vitest";
import type pg from "pg";
import { CreateRunRequestSchema,RequestedVerificationRequestSchema,type CanonicalReport } from "@deep/contracts";
import { createPool,migrate,withTx } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";
import { createDevSession,grantConsent,deleteAccount,revokeConsent } from "../src/modules/access.js";
import { storeAttachment } from "../src/modules/attachments.js";
import { admitRun } from "../src/modules/run-admission.js";
import { admitRequestedVerification,loadVerification } from "../src/modules/requested-verification.js";
import { verificationReportContent } from "../src/modules/verification-proof.js";
import { processRun } from "../src/worker/executor.js";
import { getRun } from "../src/modules/runs.js";
import { getLatestReportForRun,publishReport } from "../src/modules/reports.js";
import { matchedDocumentModel } from "./helpers/matched-model.js";
import { deleteSourceForAccount } from "../src/modules/source-deletion.js";
let pool:pg.Pool,boss:PgBoss,app:FastifyInstance;const accounts:string[]=[];const originalFetch=globalThis.fetch;
const url=process.env.TEST_DATABASE_URL??"postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
const config=loadConfig({DATABASE_URL:url,NODE_ENV:"test",APP_AUTH_MODE:"development",LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",LIVE_RETRIEVAL_ENABLED:"true",OPENROUTER_API_KEY:"nonbillable-requested-verification",LIVE_KEY_SPEND_CAP_MICRO:"1000000000",LIVE_SPEND_CAP_MICRO:"1000000",LIVE_BUDGET_SCOPE:crypto.randomUUID()});
const text="Ardent supports offline recording only on firmware 4.2.";
beforeAll(async()=>{pool=createPool(url);await migrate(pool);boss=await createQueue(url);app=await buildApp({pool,boss,config});});
afterEach(async()=>{globalThis.fetch=originalFetch;vi.restoreAllMocks();for(const id of accounts.splice(0))await deleteAccount(pool,id);});
afterAll(async()=>{await app.close();await boss.stop({graceful:false,timeout:2000});await pool.end();});
async function setup(web=false){
 const owner=await withTx(pool,async db=>{const s=await createDevSession(db);await grantConsent(db,s.accountId);return s;});accounts.push(owner.accountId);
 const attachment=await storeAttachment(pool,{accountId:owner.accountId,filename:"synthetic.txt",mime:"text/plain",bytes:Buffer.from(text),extractedText:text});
 const model=matchedDocumentModel();globalThis.fetch=model.transport;
 const parent=await admitRun(pool,owner.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question:"Which firmware supports Ardent offline recording?",routeMode:"controlled-research",attachmentIds:web?[]:[attachment]}));
 if(web){const sourceId=await insertSource(pool,{accountId:owner.accountId,runId:parent.runId,locator:"https://example.org/requested-target.txt",title:"Synthetic known source",publisher:"Synthetic control",originCluster:"example.org"});await insertVersionAndPassage(pool,{sourceId,accountId:owner.accountId,runId:parent.runId,locator:"https://example.org/requested-target.txt",text,accessLevel:"full-text"});}
 await processRun(pool,config,parent.runId);
 const report=await getLatestReportForRun(pool,parent.runId,owner.accountId);expect(report).toBeTruthy();
 const request=RequestedVerificationRequestSchema.parse({version:"requested-verification.v1",reportId:report!.id,reportVersion:report!.version,claimId:report!.claim_ids[0],evidencePolicy:"reuse_snapshot",idempotencyKey:crypto.randomUUID(),note:"PRIVATE_VERIFY_NOTE_NEVER_A_SEARCH_QUERY"});
 return {...owner,parent,report:report!,request,model,attachment};
}
it("W05 explicitly requested verification executes exact target support and publishes a source-bound scoped outcome",async()=>{
 const x=await setup(),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request);
 const before=x.model.calls.length;await processRun(pool,config,child.runId);
 expect(x.model.calls.slice(before)).toEqual(["research_assess_support_v1"]);
 const report=await getLatestReportForRun(pool,child.runId,x.accountId);expect(report?.outcome).toBe("completed_with_limitations");
 expect(report?.blocks).toEqual([{id:"answer",kind:"text",text,claimIds:expect.any(Array),citationIds:expect.any(Array)}]);
 const saved=await loadVerification(pool,{runId:child.runId,accountId:x.accountId,briefRevision:child.briefRevision});
 expect(saved.result).toMatchObject({outcome:"supported_in_inspected_evidence"});expect(saved.target.assertion.text).toBe(text);
 expect(JSON.stringify(report)).not.toContain(x.request.note);
 expect((await getLatestReportForRun(pool,x.parent.runId,x.accountId))?.id).toBe(x.report.id);
});
it("W02/W05 replay and concurrent requests reuse one child allowance/outbox while distinct requests allocate revisions",async()=>{
 const x=await setup();const children=await Promise.all(Array.from({length:3},()=>admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request)));
 expect(new Set(children.map(c=>c.runId)).size).toBe(1);expect(children.filter(c=>!c.reused)).toHaveLength(1);
 await expect(admitRequestedVerification(pool,config,x.accountId,x.parent.runId,{...x.request,note:"different"})).rejects.toThrow("idempotency_conflict");
 const next=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,{...x.request,idempotencyKey:crypto.randomUUID()});expect(next.briefRevision).toBe(children[0]!.briefRevision+1);
 const counts=(await pool.query("SELECT count(*)::int AS n FROM reservations WHERE run_id=$1",[children[0]!.runId])).rows[0];expect(counts.n).toBe(1);
 expect((await pool.query("SELECT count(*)::int AS n FROM run_dispatch_outbox WHERE run_id=$1",[children[0]!.runId])).rows[0].n).toBe(1);
});
it("W03/W05 rejects foreign or stale report targets and disabled processing before child admission",async()=>{
 const x=await setup();const foreign=await withTx(pool,createDevSession);accounts.push(foreign.accountId);await grantConsent(pool,foreign.accountId);
 await expect(admitRequestedVerification(pool,config,foreign.accountId,x.parent.runId,x.request)).rejects.toThrow("verification_parent_unavailable");
 await expect(admitRequestedVerification(pool,config,x.accountId,x.parent.runId,{...x.request,reportVersion:x.request.reportVersion+1})).rejects.toThrow("verification_report_or_claim_unavailable");
 await expect(admitRequestedVerification(pool,config,x.accountId,x.parent.runId,{...x.request,claimId:crypto.randomUUID()})).rejects.toThrow("verification_report_or_claim_unavailable");
 await expect(admitRequestedVerification(pool,{...config,structuredModelEnabled:false},x.accountId,x.parent.runId,x.request)).rejects.toThrow("verification_route_unavailable");
 await revokeConsent(pool,x.accountId);await expect(admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request)).rejects.toThrow("consent_required");
 expect((await pool.query("SELECT count(*)::int AS n FROM runs WHERE parent_run_id=$1",[x.parent.runId])).rows[0].n).toBe(0);
});
it("W05 omission of the requested assertion in the model assessment cannot publish verification",async()=>{
 const x=await setup(),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request);
 globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify({id:"synthetic-omitted-target",model:"openai/gpt-4o-mini",provider:"OpenAI",usage:{cost:"0.000001"},choices:[{finish_reason:"stop",message:{content:JSON.stringify({assessments:[]})}}]}))) as typeof fetch;
 await processRun(pool,config,child.runId);expect(await getLatestReportForRun(pool,child.runId,x.accountId)).toBeNull();
 expect((await getRun(pool,child.runId))?.terminal_outcome).toBe("failed");
 expect((await loadVerification(pool,{runId:child.runId,accountId:x.accountId,briefRevision:child.briefRevision})).result).toMatchObject({outcome:"blocked"});
});
it("W02 unknown assessment retains the admitted allowance and is never blindly resent",async()=>{
 const x=await setup(),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request);
 globalThis.fetch=vi.fn(async()=>{throw new Error("synthetic lost response");}) as typeof fetch;
 await processRun(pool,config,child.runId);await processRun(pool,config,child.runId);expect(globalThis.fetch).toHaveBeenCalledTimes(1);
 expect((await pool.query("SELECT state FROM reservations WHERE run_id=$1",[child.runId])).rows[0].state).toBe("reserved");
 expect((await loadVerification(pool,{runId:child.runId,accountId:x.accountId,briefRevision:child.briefRevision})).result).toMatchObject({outcome:"outcome_unknown"});
 expect(await getLatestReportForRun(pool,child.runId,x.accountId)).toBeNull();
});
it("W05 a missing target remains required and cannot fall through to ordinary research even when challenge scheduling is off",async()=>{
 const x=await setup(),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request),before=x.model.calls.length;
 await pool.query("DELETE FROM requested_verifications WHERE run_id=$1",[child.runId]);
 await processRun(pool,{...config,structuredChallengeEnabled:false},child.runId);
 expect(x.model.calls.length).toBe(before);expect((await getRun(pool,child.runId))?.terminal_outcome).toBe("failed");
 expect((await pool.query("SELECT verification_required_revision FROM runs WHERE id=$1",[child.runId])).rows[0].verification_required_revision).toBe(child.briefRevision);
 expect(await getLatestReportForRun(pool,child.runId,x.accountId)).toBeNull();
});
it("W03 account deletion purges private target/note/result and keeps opaque required obligation",async()=>{
 const x=await setup(),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request);await processRun(pool,config,child.runId);
 await deleteAccount(pool,x.accountId);
 expect((await pool.query("SELECT count(*)::int AS n FROM requested_verifications WHERE account_id=$1",[x.accountId])).rows[0].n).toBe(0);
 expect((await pool.query("SELECT verification_required_revision FROM runs WHERE id=$1",[child.runId])).rows[0].verification_required_revision).toBe(child.briefRevision);
});
it("W03/W06 deleting an original source invalidates and purges requested verification descendants",async()=>{
 const x=await setup(),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request);
 const saved=await loadVerification(pool,{runId:child.runId,accountId:x.accountId,briefRevision:child.briefRevision});
 const deleted=await deleteSourceForAccount(pool,x.accountId,saved.target.sources[0]!.id);expect(deleted.invalidatedRunIds).toContain(child.runId);
 expect((await pool.query("SELECT count(*)::int AS n FROM requested_verifications WHERE run_id=$1",[child.runId])).rows[0].n).toBe(0);
 await expect(admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request)).rejects.toThrow("idempotency_withdrawn");
});
it("W05 refreshed uploaded source produces new owned extraction evidence without public discovery",async()=>{
 const x=await setup(),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,{...x.request,evidencePolicy:"refresh_sources"});
 const calls:string[]=[];globalThis.fetch=async(_input,init)=>{
  const body=JSON.parse(String(init?.body)),context=JSON.parse(body.messages[1].content);calls.push(body.response_format.json_schema.name);
  expect(body.plugins).toEqual([]);expect(JSON.stringify(context)).not.toContain(x.request.note);
  const p=context.passages[0],quote=p.text;
  return new Response(JSON.stringify({id:"synthetic-refreshed-check",model:"openai/gpt-4o-mini",provider:"OpenAI",usage:{cost:"0.000001"},choices:[{finish_reason:"stop",message:{content:JSON.stringify({assessments:context.assertions.map((a:{key:string;scope:unknown})=>({claimKey:a.key,status:"supported",scope:a.scope,evidence:[{passageId:p.id,start:0,end:quote.length,quote}],rationale:"Synthetic refreshed support control",missingEvidence:[]}))})}}]}));
 };
 await processRun(pool,config,child.runId);expect(calls).toEqual(["research_assess_support_v1"]);
 const report=await getLatestReportForRun(pool,child.runId,x.accountId);expect(report).toBeTruthy();
 const oldIds=x.report.blocks.flatMap((b:{citationIds:string[]})=>b.citationIds),newIds=report!.blocks.flatMap((b:{citationIds:string[]})=>b.citationIds);
 expect(newIds.length).toBeGreaterThan(0);expect(newIds.some((id:string)=>oldIds.includes(id))).toBe(false);
 expect((await pool.query("SELECT count(*)::int AS n FROM extraction_receipts WHERE run_id=$1",[child.runId])).rows[0].n).toBe(1);
});
it("W02 uppercase request identity resolves exactly and withdrawn keys cannot admit a delayed verification",async()=>{
 const x=await setup(),request={...x.request,idempotencyKey:crypto.randomUUID().toUpperCase()};
 const child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,request);
 expect(await resolveAdmission(pool,x.accountId,request.idempotencyKey)).toMatchObject({status:"accepted",run:{runId:child.runId}});
 expect((await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,request)).runId).toBe(child.runId);
 const delayed={...x.request,idempotencyKey:crypto.randomUUID().toUpperCase()};
 expect(await resolveAdmission(pool,x.accountId,delayed.idempotencyKey)).toEqual({status:"withdrawn"});
 await expect(admitRequestedVerification(pool,config,x.accountId,x.parent.runId,delayed)).rejects.toThrow("idempotency_withdrawn");
});
it("W05 API strict verification schedules a child while ordinary output feedback schedules no work",async()=>{
 const x=await setup(),headers={authorization:`Bearer ${x.token}`};
 const feedback=await app.inject({method:"POST",url:`/v1/reports/${x.report.id}/challenges`,headers,payload:{category:"claim",claimId:x.request.claimId,note:"Synthetic ordinary feedback"}});
 expect(feedback.statusCode).toBe(200);
 expect((await pool.query("SELECT count(*)::int AS n FROM runs WHERE parent_run_id=$1",[x.parent.runId])).rows[0].n).toBe(0);
 for(const payload of [{claimId:x.request.claimId},{...x.request,unsafeAction:"shell"},{...x.request,reportVersion:0}])expect((await app.inject({method:"POST",url:`/v1/runs/${x.parent.runId}/follow-up`,headers,payload})).statusCode).toBe(400);
 const first=await app.inject({method:"POST",url:`/v1/runs/${x.parent.runId}/follow-up`,headers,payload:x.request});expect(first.statusCode).toBe(200);expect(first.json()).toMatchObject({reopenedDiscovery:false,evidencePolicy:"reuse_snapshot",reused:false});
 const retry=await app.inject({method:"POST",url:`/v1/runs/${x.parent.runId}/follow-up`,headers,payload:x.request});expect(retry.json()).toMatchObject({runId:first.json().runId,reused:true});
 await processRun(pool,config,first.json().runId);expect(await getLatestReportForRun(pool,first.json().runId,x.accountId)).toBeTruthy();
});
for(const mutation of ["missing_result","missing_target","changed_scope","false_result"] as const)it(`W05 publication independently rejects ${mutation} after a completed verification`,async()=>{
 const x=await setup(),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request);await processRun(pool,config,child.runId);
 const saved=await getLatestReportForRun(pool,child.runId,x.accountId);expect(saved).toBeTruthy();
 const report={reportId:saved!.id,runId:child.runId,version:saved!.version,outcome:saved!.outcome,basis:saved!.basis,blocks:saved!.blocks,claimIds:saved!.claim_ids,limitations:saved!.limitations,sourceAccessSummary:saved!.source_access_summary,routeMode:"controlled-research"} as CanonicalReport;
 expect(await reportCompletionCovered(pool,x.accountId,report)).toBe(true);
 if(mutation==="missing_target")await pool.query("DELETE FROM requested_verifications WHERE run_id=$1",[child.runId]);
 else if(mutation==="missing_result")await pool.query("UPDATE requested_verifications SET model_intent_id=NULL,result=NULL WHERE run_id=$1",[child.runId]);
 else if(mutation==="changed_scope")await pool.query("UPDATE requested_verifications SET target=jsonb_set(target,'{assertion,scope,geography}','\"France\"') WHERE run_id=$1",[child.runId]);
 else await pool.query("UPDATE requested_verifications SET result=jsonb_set(result,'{outcome}','\"contradicted_in_inspected_evidence\"') WHERE run_id=$1",[child.runId]);
 await expect(reportCompletionCovered(pool,x.accountId,report)).rejects.toThrow(mutation==="changed_scope"?"verification_target_digest_changed":mutation==="missing_target"?"required_verification_target_missing":mutation==="missing_result"?"required_verification_result_missing":"required_verification_result_changed");
});
function assessmentResponse(context:{assertions:{key:string;scope:unknown}[];passages:{id:string;text:string}[]},status="supported",scopeOverride?:unknown,omitEvidence=false){
 const p=context.passages[0]!,quote=p.text;
 return new Response(JSON.stringify({id:`synthetic-check-${crypto.randomUUID()}`,model:"openai/gpt-4o-mini",provider:"OpenAI",usage:{cost:"0.000001"},choices:[{finish_reason:"stop",message:{content:JSON.stringify({assessments:context.assertions.map(a=>({claimKey:a.key,status,scope:scopeOverride??a.scope,evidence:omitEvidence?[]:[{passageId:p.id,start:0,end:quote.length,quote}],rationale:"Synthetic target assessment control",missingEvidence:[]}))})}}]}));
}
for(const status of ["contradicted","partially_supported","insufficient"] as const)it(`W05 refreshed known URL produces localized ${status} outcome without candidate discovery or target replacement`,async()=>{
 const x=await setup(true),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,{...x.request,evidencePolicy:"refresh_sources"});
 const refreshed=status==="contradicted"?"Ardent does not support offline recording on firmware 4.2.":text;
 const bytes=Buffer.from(refreshed),digest=createHash("sha256").update(bytes).digest("hex");
 const reader=vi.spyOn(sourceReader,"readSource").mockImplementation(async locator=>({receipt:{requestedUrl:locator,finalUrl:locator,redirectChain:[],status:200,mime:"text/plain",retrievedAt:new Date().toISOString(),outcome:"successful_body"},bytes,
  extraction:{version:"utf8-notes-v1",digest,status:"extracted",warnings:[],blocks:[{kind:"text",locator:"paragraph:0",text:refreshed,rows:[]}]}}));
 const operations:string[]=[];globalThis.fetch=async(input,init)=>{const body=JSON.parse(String(init?.body)),context=JSON.parse(body.messages[1].content);expect(body.plugins).toEqual([]);expect(JSON.stringify(body)).not.toContain(x.request.note);operations.push(body.response_format.json_schema.name);
  if(body.response_format.json_schema.name==="research_brief_v1")return x.model.transport(input,init);
  expect(body.response_format.json_schema.name).toBe("research_assess_support_v1");expect(context.assertions.map((a:{text:string})=>a.text)).toEqual([text]);return assessmentResponse(context,status==="contradicted"?"insufficient":status,undefined,status==="contradicted");
 };
 await processRun(pool,config,child.runId);expect(reader).toHaveBeenCalledTimes(1);expect(operations).toEqual(["research_brief_v1","research_assess_support_v1"]);
 const saved=await loadVerification(pool,{runId:child.runId,accountId:x.accountId,briefRevision:child.briefRevision});
 expect(saved.result).toMatchObject({outcome:status==="contradicted"?"contradicted_in_inspected_evidence":status==="partially_supported"?"qualification_needed":"unresolved"});
 const report=await getLatestReportForRun(pool,child.runId,x.accountId);expect(report?.outcome).toBe("completed_with_limitations");expect(report?.claim_ids).toEqual([]);
 expect(report?.limitations).toContain(`Selected claim (quoted for review): ${text}`);
 if(status==="contradicted"){
  const contrary=(await pool.query("SELECT id FROM authorized_run_passages WHERE run_id=$1 AND exact_text=$2",[child.runId,refreshed])).rows[0].id;
  expect(report!.blocks[0].citationIds).toContain(contrary);
  expect(saved.result).toMatchObject({check:{evidence:[],counterEvidence:[{passageId:contrary,decision:"contradicts"}]}});
 }
 expect((await pool.query("SELECT count(*)::int AS n FROM source_read_operations WHERE run_id=$1 AND state='finished'",[child.runId])).rows[0].n).toBe(1);
});
it("W05 a verified output claim can be explicitly checked again with intact provenance and a new child revision",async()=>{
 const x=await setup(),first=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request);await processRun(pool,config,first.runId);
 const report=await getLatestReportForRun(pool,first.runId,x.accountId);expect(report).toBeTruthy();
 const second=await admitRequestedVerification(pool,config,x.accountId,first.runId,{...x.request,reportId:report!.id,reportVersion:report!.version,claimId:report!.claim_ids[0],idempotencyKey:crypto.randomUUID()});
 await processRun(pool,config,second.runId);expect((await getLatestReportForRun(pool,second.runId,x.accountId))?.blocks[0].text).toBe(text);
 expect(second.briefRevision).toBe(first.briefRevision+1);
});
it("W05 losing a marker while target rows remain cannot silently execute ordinary research",async()=>{
 const x=await setup(),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request),before=x.model.calls.length;
 await pool.query("UPDATE runs SET verification_required_revision=NULL WHERE id=$1",[child.runId]);
 await processRun(pool,config,child.runId);expect(x.model.calls.length).toBe(before);expect((await getRun(pool,child.runId))?.terminal_outcome).toBe("failed");
 expect(await getLatestReportForRun(pool,child.runId,x.accountId)).toBeNull();
});
it("W05 scheduling flag disable after admission leaves the required target intact and publishes no substitute",async()=>{
 const x=await setup(),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request),before=x.model.calls.length;
 await processRun(pool,{...config,structuredModelEnabled:false,structuredChallengeEnabled:false},child.runId);
 expect(x.model.calls.length).toBe(before);expect((await getRun(pool,child.runId))?.terminal_outcome).toBe("failed");
 expect((await loadVerification(pool,{runId:child.runId,accountId:x.accountId,briefRevision:child.briefRevision})).target.assertion.text).toBe(text);
 expect(await getLatestReportForRun(pool,child.runId,x.accountId)).toBeNull();
});
it("W02/W03 deletion during assessment allows only incurred-cost settlement and no target or report resurrection",async()=>{
 const x=await setup(),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request);
 globalThis.fetch=async(_input,init)=>{const body=JSON.parse(String(init?.body)),context=JSON.parse(body.messages[1].content);await deleteAccount(pool,x.accountId);return assessmentResponse(context);};
 await processRun(pool,config,child.runId);
 expect((await pool.query("SELECT count(*)::int AS n FROM requested_verifications WHERE account_id=$1",[x.accountId])).rows[0].n).toBe(0);
 expect((await pool.query("SELECT count(*)::int AS n FROM reports WHERE run_id=$1",[child.runId])).rows[0].n).toBe(0);
 expect((await pool.query("SELECT confirmed_micro::text FROM provider_intents WHERE run_id=$1",[child.runId])).rows).toEqual([{confirmed_micro:"1"}]);
});
it("W02 bound recovery rejects ordinary-run collisions, key mismatches, changed requests and lost target proof",async()=>{
 const x=await setup(),headers={authorization:`Bearer ${x.token}`};
 const parentKey=(await pool.query("SELECT idempotency_key FROM runs WHERE id=$1",[x.parent.runId])).rows[0].idempotency_key;
 const recover=(key:string,request=x.request)=>app.inject({method:"POST",url:"/v1/run-requests/resolve",headers,payload:{idempotencyKey:key,verification:{parentRunId:x.parent.runId,request}}});
 expect((await recover(parentKey,{...x.request,idempotencyKey:parentKey})).statusCode).toBe(409);
 expect((await recover(crypto.randomUUID())).statusCode).toBe(400);
 const child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request);
 expect((await recover(x.request.idempotencyKey,{...x.request,note:"changed"})).statusCode).toBe(409);
 expect((await recover(x.request.idempotencyKey)).json()).toMatchObject({status:"accepted",run:{runId:child.runId}});
 await pool.query("DELETE FROM requested_verifications WHERE run_id=$1",[child.runId]);
 expect((await recover(x.request.idempotencyKey)).statusCode).toBe(409);
});
it("W02 bound recovery remains available with scheduling disabled and withdraws exact uppercase keys",async()=>{
 const x=await setup(),request={...x.request,idempotencyKey:crypto.randomUUID().toUpperCase()};
 const child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,request);
 const disabled=await buildApp({pool,boss,config:{...config,liveRouteEnabled:false,structuredModelEnabled:false}});
 try{
 const recover=(r:typeof request)=>disabled.inject({method:"POST",url:"/v1/run-requests/resolve",headers:{authorization:`Bearer ${x.token}`},payload:{idempotencyKey:r.idempotencyKey,verification:{parentRunId:x.parent.runId,request:r}}});
 expect((await recover(request)).json()).toMatchObject({status:"accepted",run:{runId:child.runId}});
 const delayed={...request,idempotencyKey:crypto.randomUUID().toUpperCase()};
 expect((await recover(delayed)).json()).toEqual({status:"withdrawn"});
 await expect(admitRequestedVerification(pool,config,x.accountId,x.parent.runId,delayed)).rejects.toThrow("idempotency_withdrawn");
 }finally{await disabled.close();}
});
it("W05 malformed cyclic target lineage is rejected before recursive proof restoration",async()=>{
 const x=await setup(),child=await admitRequestedVerification(pool,config,x.accountId,x.parent.runId,x.request);await processRun(pool,config,child.runId);
 const report=await getLatestReportForRun(pool,child.runId,x.accountId);expect(report).toBeTruthy();
 await pool.query("UPDATE requested_verifications SET parent_run_id=run_id WHERE run_id=$1",[child.runId]);
 await expect(admitRequestedVerification(pool,config,x.accountId,child.runId,{...x.request,reportId:report!.id,reportVersion:report!.version,claimId:report!.claim_ids[0],idempotencyKey:crypto.randomUUID()})).rejects.toThrow("verification_lineage_cycle");
});

it("W05 finite repeated verification lineage reaches an explicit admission ceiling without another reservation",async()=>{
 const x=await setup();let parentId=x.parent.runId,report=x.report;
 for(let i=0;i<8;i++){
  const request={...x.request,reportId:report.id,reportVersion:report.version,claimId:report.claim_ids[0],idempotencyKey:crypto.randomUUID()};
  const child=await admitRequestedVerification(pool,config,x.accountId,parentId,request);await processRun(pool,config,child.runId);
  report=(await getLatestReportForRun(pool,child.runId,x.accountId))!;expect(report).toBeTruthy();parentId=child.runId;
 }
 const before=(await pool.query("SELECT count(*)::int AS n FROM runs WHERE account_id=$1",[x.accountId])).rows[0].n;
 await expect(admitRequestedVerification(pool,config,x.accountId,parentId,{...x.request,reportId:report.id,reportVersion:report.version,claimId:report.claim_ids[0],idempotencyKey:crypto.randomUUID()})).rejects.toThrow("verification_lineage_limit");
 expect((await pool.query("SELECT count(*)::int AS n FROM runs WHERE account_id=$1",[x.accountId])).rows[0].n).toBe(before);
},120000);

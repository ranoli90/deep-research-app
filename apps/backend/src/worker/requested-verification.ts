import { createHash } from "node:crypto";
import type pg from "pg";
import { type CanonicalReport } from "@deep/contracts";
import type { AppConfig } from "../platform/config.js";
import type { FencedSession } from "./fenced-session.js";
import { getRun,getBrief,emitEvent,markTerminal,setPhase } from "../modules/runs.js";
import { settleRun } from "../modules/billing.js";
import { loadVerification,VerificationTargetError } from "../modules/requested-verification.js";
import { verificationContext,restoreVerificationCheck,verificationReportContent } from "../modules/verification-proof.js";
import { modelInputManifest } from "../modules/model-operations.js";
import { insertSource } from "../modules/evidence.js";
import { publishReport } from "../modules/reports.js";
import { ensureResearchTask } from "./research-task.js";
import { executeSourceRead } from "./source-reading.js";
import { ingestAttachments } from "./attachment-ingestion.js";
import { performModelOperation } from "./model-gateway.js";

/** Targeted source reassessment. The target is restored independently, never extracted away. */
export async function processRequestedVerification(pool:pg.Pool,config:AppConfig,session:FencedSession,args:{runId:string;accountId:string;briefRevision:number;fence:number}){
 const fail=async(reason:string,unknown=false,intentId?:string)=>session.write(async db=>{
  await db.query("UPDATE requested_verifications SET state=$3,result=$4,model_intent_id=COALESCE($5,model_intent_id) WHERE run_id=$1 AND account_id=$2",[args.runId,args.accountId,unknown?"unknown":"blocked",JSON.stringify({version:"requested-verification-result.v1",outcome:unknown?"outcome_unknown":"blocked",reason}),intentId??null]);
  await emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"verification_unresolved",phase:"researching",summary:"The selected claim could not be checked with the available evidence or processing. No verification conclusion was published.",payload:{reason}});
  await markTerminal(db,args.runId,"failed");await settleRun(db,args.accountId,args.runId,0);
 });
 let saved;
 try{saved=await session.write(db=>loadVerification(db,args));}catch(error){if(error instanceof VerificationTargetError)return fail(error.reason);throw error;}
 await session.write(db=>setPhase(db,args.runId,"researching"));
 if(saved.evidence_policy==="refresh_sources"){
  const run=(await getRun(pool,args.runId))!,brief=await getBrief(pool,run.brief_id);
  await ingestAttachments(pool,run,brief,session);
  const web=saved.target.sources.filter(s=>!s.locator.startsWith("attachment://"));
  if(web.length){
   if(!config.liveRetrievalEnabled)return fail("verification_source_refresh_unavailable");
   const task=await ensureResearchTask(pool,config,session,args);if(task.kind!=="task")return fail(task.kind==="pending"?"verification_task_outcome_unknown":task.reason,task.kind==="pending",task.kind==="pending"?task.intentId:undefined);
   if(task.task.planningStatus!=="ready")return fail("verification_task_unavailable");
   const sources=await session.write(async db=>{
    const current=await loadVerification(db,args);
    if(current.source_map.length)return current.source_map as {originSourceId:string;sourceId:string}[];
    const mapped=[];
    for(const source of web){const sourceId=await insertSource(db,{accountId:args.accountId,runId:args.runId,locator:source.locator,title:source.title,publisher:source.publisher,originCluster:source.originCluster});mapped.push({originSourceId:source.id,sourceId});}
    await db.query("UPDATE requested_verifications SET source_map=$2,state='reading' WHERE id=$1",[current.id,JSON.stringify(mapped)]);return mapped;
   });
   for(const source of sources){
    const read=await executeSourceRead(config,session,{...args,taskId:task.task.id,proposal:{rationale:"Reread a selected source for the explicit claim verification request.",action:{type:"fetch",sourceHandle:source.sourceId,questionKeys:Object.keys(task.task.questionIds)}}});
    if(read.kind!=="read"||!read.readable)return fail(read.kind==="pending"?"verification_read_outcome_unknown":"verification_source_unavailable",read.kind==="pending");
   }
  }
 }
 let basis;
 try{basis=await session.write(db=>verificationContext(db,args));}catch(error){if(error instanceof Error&&error.message==="verification_evidence_unavailable")return fail(error.message);throw error;}
 const assessment=await performModelOperation(pool,config,session,{...args,context:basis.context,evidenceRevision:basis.evidenceRevision,operation:"assess_support"});
 if(assessment.kind!=="result")return fail(assessment.kind==="pending"?"verification_assessment_outcome_unknown":assessment.reason,assessment.kind==="pending",assessment.kind==="pending"?assessment.intentId:undefined);
 if(assessment.result.status!=="succeeded"||assessment.result.receipt.actualMicro===null)return fail("verification_assessment_unavailable",assessment.result.receipt.actualMicro===null,assessment.intentId);
 await session.write(async db=>{
  const checked=await restoreVerificationCheck(db,args,assessment.intentId);
  let claimId=checked.saved.output_claim_id as string|null;
  if(checked.value.outcome==="supported_in_inspected_evidence"&&!claimId){
   claimId=crypto.randomUUID();
   await db.query("INSERT INTO claims(id,run_id,account_id,text,type,support_status) VALUES($1,$2,$3,$4,'external-fact','unverified')",[claimId,args.runId,args.accountId,checked.saved.target.assertion.text]);
   await db.query("INSERT INTO claim_revisions(id,claim_id,account_id,run_id,revision,text,text_digest,scope) VALUES($1,$2,$3,$4,1,$5,$6,$7)",[crypto.randomUUID(),claimId,args.accountId,args.runId,checked.saved.target.assertion.text,
    createHash("sha256").update(checked.saved.target.assertion.text).digest("hex"),JSON.stringify({requestedVerificationId:checked.saved.id,originalClaimRevisionId:checked.saved.claim_revision_id,semanticScope:checked.saved.target.assertion.scope})]);
  }
  await db.query(`UPDATE requested_verifications SET state='checked',model_intent_id=$2,evidence_revision=$3,context_manifest=$4,result=$5,output_claim_id=$6 WHERE id=$1`,
   [checked.saved.id,assessment.intentId,checked.evidenceRevision,JSON.stringify(modelInputManifest(checked.context)),JSON.stringify(checked.value),claimId]);
 });
 await session.write(async db=>{
  const content=await verificationReportContent(db,args),run=(await getRun(db,args.runId))!;
  const report:CanonicalReport={reportId:crypto.randomUUID(),version:1,runId:args.runId,routeMode:"controlled-research",
   outcome:content.outcome,
   basis:{briefRevision:run.brief_revision,evidenceRevision:run.evidence_revision,consentEpoch:run.consent_epoch,cancellationEpoch:run.cancellation_epoch,workerLeaseFence:run.worker_lease_fence},
   blocks:content.blocks,claimIds:content.claims.map(c=>c.id),limitations:content.limitations,sourceAccessSummary:[]};
  const passages=(await db.query(`SELECT p.id,p.source_version_id,p.exact_text,v.source_id,s.title,v.access_level FROM authorized_run_passages p
   JOIN source_versions v ON v.id=p.source_version_id JOIN sources s ON s.id=v.source_id WHERE p.run_id=$1 AND p.account_id=$2 AND p.id=ANY($3::uuid[])`,[args.runId,args.accountId,content.context.passages.map(p=>p.id)])).rows;
  report.sourceAccessSummary=[...new Map(passages.map(p=>[p.source_id,{sourceId:p.source_id,title:p.title,accessLevel:p.access_level}])).values()];
  const published=await publishReport(db,{report,accountId:args.accountId,loaded:report.basis,claims:content.claims,
   passages:passages.map(p=>({id:p.id,sourceId:p.source_id,sourceVersionId:p.source_version_id,exactText:p.exact_text,locator:"document"})),deleted:false});
  if(!published.accepted)throw new Error(`verification_publication_${published.reason}`);
 });
}

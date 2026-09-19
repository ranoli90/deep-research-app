import {runModelVersions} from "../modules/run-model-policy.js";
import { sourcePolicyAllows, policyFromRestrictions } from "@deep/research-core";
import { getBrief, getRun } from "../modules/runs.js";
import { z } from "zod";
import { ResearchModelOutputs } from "@deep/contracts";
import type { AppConfig } from "../platform/config.js";
import { loadResearchTask } from "../modules/research-tasks.js";
import { bumpEvidence,emitEvent } from "../modules/runs.js";
import { insertExtractedVersion } from "../modules/evidence.js";
import * as reader from "../adapters/retrieval/read-source.js";
import { LostWorkerLease, type FencedSession } from "./fenced-session.js";
const READER_VERSION="source-read.v2";

/** A strict source handle resolves to an owned URL; provider/source text cannot expand network authority. */
export async function executeSourceRead(config:AppConfig,session:FencedSession,args:{runId:string;accountId:string;briefRevision:number;taskId:string;proposal:unknown}) {
 if(!config.liveRetrievalEnabled)return {kind:"blocked" as const,reason:"public_reading_disabled"};
 const parsed=ResearchModelOutputs.propose_action.safeParse(args.proposal);
 if(!parsed.success||parsed.data.action.type!=="fetch"||!z.string().uuid().safeParse(parsed.data.action.sourceHandle).success)return {kind:"blocked" as const,reason:"invalid_read_action"};
 const action=parsed.data.action;
 const admitted=await session.write(async(db)=>{
  const task=await loadResearchTask(db,args.runId,args.accountId,args.briefRevision,await runModelVersions(db,args.runId));
  if(!task||task.id!==args.taskId||task.planningStatus!=="ready"||action.questionKeys.some((key)=>!task.questionIds[key]))throw new Error("read_task_mismatch");
  const source=(await db.query("SELECT canonical_locator FROM sources WHERE id=$1 AND account_id=$2 AND run_id=$3",[action.sourceHandle,args.accountId,args.runId])).rows[0];
  if(!source)throw new Error("read_source_owner_mismatch");
  let url:URL;try {url=new URL(source.canonical_locator);}catch {throw new Error("read_source_url_invalid");}
  if(!["https:","http:"].includes(url.protocol)||url.username||url.password)throw new Error("read_source_url_invalid");
  const activeRun=await getRun(db,args.runId);
  const activeBrief=await getBrief(db,activeRun!.brief_id);
  if(!sourcePolicyAllows(policyFromRestrictions(activeBrief.sourceRestrictions),source.canonical_locator,activeBrief.originalQuestion))
    return {id:"",issue:false,state:"policy_denied",locator:source.canonical_locator as string,versionId:null as string|null};
  const inserted=await db.query(`INSERT INTO source_read_operations(id,account_id,run_id,source_id,brief_revision,reader_version,locator,state,issue_fence)
    SELECT $1,$2,$3,$4,$5,$6,$7,'issued',(SELECT worker_lease_fence FROM runs WHERE id=$3)
    WHERE NOT EXISTS(SELECT 1 FROM source_read_operations WHERE run_id=$3 AND source_id=$4 AND brief_revision=$5 AND reader_version IN ('source-read.v1','source-read.v2'))
    ON CONFLICT DO NOTHING RETURNING id`,
    [crypto.randomUUID(),args.accountId,args.runId,action.sourceHandle,args.briefRevision,READER_VERSION,source.canonical_locator]);
  const row=(await db.query(`SELECT * FROM source_read_operations WHERE run_id=$1 AND source_id=$2 AND brief_revision=$3 AND reader_version=ANY($4::text[]) ORDER BY reader_version LIMIT 1`,[args.runId,action.sourceHandle,args.briefRevision,["source-read.v1",READER_VERSION]])).rows[0];
  if(row.account_id!==args.accountId||row.locator!==source.canonical_locator)throw new Error("read_operation_mismatch");
  if (inserted.rowCount !== 1 && row.state === "issued") {
    const run = await getRun(db,args.runId);
    if (row.issue_fence === null || Number(row.issue_fence) !== Number(run?.worker_lease_fence)) {
      await db.query("UPDATE source_read_operations SET state='unknown',failure_reason='worker_ended_before_read_persisted' WHERE id=$1 AND state='issued'",[row.id]);
      row.state="unknown";
    }
  }
  return {id:row.id as string,issue:inserted.rowCount===1,state:row.state as string,locator:row.locator as string,versionId:row.source_version_id as string|null};
 });
 const load=()=>session.write(async(db)=>{
  const row=(await db.query(`SELECT v.id,v.access_level,r.transport FROM source_versions v JOIN extraction_receipts r ON r.source_version_id=v.id
    WHERE v.id=$1 AND v.source_id=$2 AND v.account_id=$3 AND r.account_id=$3 AND r.run_id=$4`,[admitted.versionId,action.sourceHandle,args.accountId,args.runId])).rows[0];
  if(!row||row.transport.requestedUrl!==admitted.locator)throw new Error("saved_read_unavailable");
  const run=await getRun(db,args.runId),brief=await getBrief(db,run!.brief_id);
  if(!sourcePolicyAllows(policyFromRestrictions(brief.sourceRestrictions),row.transport.finalUrl,brief.originalQuestion))return {kind:"blocked" as const,reason:"redirect_source_policy_denied",operationId:admitted.id};
  return {kind:"read" as const,operationId:admitted.id,sourceVersionId:row.id as string,readable:row.access_level==="partial-text"||row.access_level==="full-text",reused:!admitted.issue};
 });
 if(!admitted.issue)return admitted.state==="finished"?load():admitted.state==="issued"?{kind:"pending" as const,operationId:admitted.id}:{kind:"blocked" as const,reason:`source_read_${admitted.state}`,operationId:admitted.id};
 let result: Awaited<ReturnType<typeof reader.readSource>>;
 try { result=await reader.readSource(admitted.locator,session.signal); }
 catch(error) {
  // Only the adapter call is degradable. Fence, owner and persistence failures propagate.
  if(session.signal.aborted || error instanceof LostWorkerLease)throw error;
  await session.write(db=>db.query("UPDATE source_read_operations SET state='failed',failure_reason='reader_unavailable' WHERE id=$1 AND state='issued'",[admitted.id]));
  return {kind:"blocked" as const,reason:"source_read_failed",operationId:admitted.id};
 }
 admitted.versionId=await session.write(async(db)=>{
  const source=(await db.query("SELECT canonical_locator FROM sources WHERE id=$1 AND account_id=$2 AND run_id=$3",[action.sourceHandle,args.accountId,args.runId])).rows[0];
  if(source?.canonical_locator!==admitted.locator)throw new Error("read_source_changed");
  const run=await getRun(db,args.runId);
  const brief=await getBrief(db,run!.brief_id);
  const policy=policyFromRestrictions(brief.sourceRestrictions);
  if(!sourcePolicyAllows(policy,result.receipt.finalUrl,brief.originalQuestion)) {
    await db.query("UPDATE source_read_operations SET state='failed',failure_reason='redirect_source_policy_denied' WHERE id=$1",[admitted.id]);
    await db.query("INSERT INTO source_policy_exclusions(run_id,account_id,brief_revision,source_version_id) SELECT $1,$2,$3,id FROM source_versions WHERE source_id=$4 AND account_id=$2 ON CONFLICT DO NOTHING",[args.runId,args.accountId,args.briefRevision,action.sourceHandle]);
    await bumpEvidence(db,args.runId);
    return null;
  }
  const versionId=await insertExtractedVersion(db,{...args,sourceId:action.sourceHandle,...result});
  await db.query("UPDATE source_read_operations SET state='finished',source_version_id=$2 WHERE id=$1 AND state='issued'",[admitted.id,versionId]);
  await bumpEvidence(db,args.runId);
  await emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"source_read",phase:"researching",
   summary:result.receipt.outcome==="successful_body"?"Source reading finished; extracted evidence retains its access limitations.":"The source could not provide readable evidence.",
   payload:{operationId:admitted.id,sourceVersionId:versionId,outcome:result.receipt.outcome}});
  return versionId;
 });
 return admitted.versionId ? load() : {kind:"blocked" as const,reason:"redirect_source_policy_denied",operationId:admitted.id};
}

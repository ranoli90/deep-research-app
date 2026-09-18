import {runModelVersions} from "../modules/run-model-policy.js";
import { z } from "zod";
import { ResearchModelOutputs } from "@deep/contracts";
import type { AppConfig } from "../platform/config.js";
import { loadResearchTask } from "../modules/research-tasks.js";
import { bumpEvidence,emitEvent } from "../modules/runs.js";
import { insertExtractedVersion } from "../modules/evidence.js";
import * as reader from "../adapters/retrieval/read-source.js";
import type { FencedSession } from "./fenced-session.js";
const READER_VERSION="source-read.v1";

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
  const inserted=await db.query(`INSERT INTO source_read_operations(id,account_id,run_id,source_id,brief_revision,reader_version,locator,state)
    VALUES($1,$2,$3,$4,$5,$6,$7,'issued') ON CONFLICT DO NOTHING RETURNING id`,
    [crypto.randomUUID(),args.accountId,args.runId,action.sourceHandle,args.briefRevision,READER_VERSION,source.canonical_locator]);
  const row=(await db.query(`SELECT * FROM source_read_operations WHERE run_id=$1 AND source_id=$2 AND brief_revision=$3 AND reader_version=$4`,[args.runId,action.sourceHandle,args.briefRevision,READER_VERSION])).rows[0];
  if(row.account_id!==args.accountId||row.locator!==source.canonical_locator)throw new Error("read_operation_mismatch");
  return {id:row.id as string,issue:inserted.rowCount===1,state:row.state as string,locator:row.locator as string,versionId:row.source_version_id as string|null};
 });
 const load=()=>session.write(async(db)=>{
  const row=(await db.query(`SELECT v.id,v.access_level,r.transport FROM source_versions v JOIN extraction_receipts r ON r.source_version_id=v.id
    WHERE v.id=$1 AND v.source_id=$2 AND v.account_id=$3 AND r.account_id=$3 AND r.run_id=$4`,[admitted.versionId,action.sourceHandle,args.accountId,args.runId])).rows[0];
  if(!row||row.transport.requestedUrl!==admitted.locator)throw new Error("saved_read_unavailable");
  return {kind:"read" as const,operationId:admitted.id,sourceVersionId:row.id as string,readable:row.access_level==="partial-text",reused:!admitted.issue};
 });
 if(!admitted.issue)return admitted.state==="finished"?load():{kind:"pending" as const,operationId:admitted.id};
 const result=await reader.readSource(admitted.locator,session.signal);
 admitted.versionId=await session.write(async(db)=>{
  const source=(await db.query("SELECT canonical_locator FROM sources WHERE id=$1 AND account_id=$2 AND run_id=$3",[action.sourceHandle,args.accountId,args.runId])).rows[0];
  if(source?.canonical_locator!==admitted.locator)throw new Error("read_source_changed");
  const versionId=await insertExtractedVersion(db,{...args,sourceId:action.sourceHandle,...result});
  await db.query("UPDATE source_read_operations SET state='finished',source_version_id=$2 WHERE id=$1 AND state='issued'",[admitted.id,versionId]);
  await bumpEvidence(db,args.runId);
  await emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"source_read",phase:"researching",
   summary:result.receipt.outcome==="successful_body"?"Source reading finished; extracted evidence retains its access limitations.":"The source could not provide readable evidence.",
   payload:{operationId:admitted.id,sourceVersionId:versionId,outcome:result.receipt.outcome}});
  return versionId;
 });
 return load();
}

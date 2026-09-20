import type pg from "pg";
import { COUNTEREVIDENCE_VERSION } from "@deep/contracts";
import { counterevidenceSearch } from "@deep/research-core";
import type { AppConfig } from "../platform/config.js";
import { getCounterevidence,prepareCounterevidence,counterevidenceContext,persistCounterevidenceResult } from "../modules/counterevidence.js";
import type { SupportArgs } from "../modules/scoped-support.js";
import { getBrief,getRun } from "../modules/runs.js";
import { adoptSearchSources } from "../modules/search-sources.js";
import type { FencedSession } from "./fenced-session.js";
import { performPublicSearch } from "./public-search.js";
import { executeSourceRead } from "./source-reading.js";
import { performModelOperation } from "./model-gateway.js";
/** One bounded counterevidence objective; existing search/read/model admission retains all authority. */
export async function executeCounterevidence(pool:pg.Pool,config:AppConfig,session:FencedSession,args:SupportArgs&{supportIntentId:string;fence:number}) {
 if(!config.structuredChallengeEnabled)return {kind:"not_applicable" as const,reason:"counterevidence_disabled"};
 const startingRevision=await session.write(async db=>(await getRun(db,args.runId))!.evidence_revision);
 let saved=await session.write(db=>getCounterevidence(db,args));
 if(!saved){
  const prior=await session.write(db=>db.query("SELECT 1 FROM run_actions WHERE run_id=$1 AND brief_revision=$2 AND kind IN ('write_report','write_calculated_report') LIMIT 1",[args.runId,args.briefRevision]));
  if(prior.rowCount)return {kind:"not_applicable" as const,reason:"legacy_writer_context_preserved"};
  saved=await session.write(db=>prepareCounterevidence(db,args));if(!saved)return {kind:"not_applicable" as const,reason:"no_supported_consequential_target"};
 }
 let evidenceChanged=false;
 const finish=async(state:"blocked"|"unknown",outcome:"blocked"|"unresolved_at_limit"|"outcome_unknown",reason:string)=>{
  await session.write(async db=>{await db.query("UPDATE counterevidence_checks SET state=$2,outcome=$3,reason=$4 WHERE id=$1",[saved.id,state,outcome,reason]);
   evidenceChanged ||= (await getRun(db,args.runId))!.evidence_revision!==startingRevision;});
  return {kind:"challenge" as const,id:saved.id as string,outcome,evidenceChanged,version:COUNTEREVIDENCE_VERSION};
 };
 if(["blocked","unknown"].includes(saved.state))return {kind:"challenge" as const,id:saved.id as string,outcome:saved.outcome as string,evidenceChanged:false,version:COUNTEREVIDENCE_VERSION};
 if(saved.state==="planned"){
  const run=(await getRun(pool,args.runId))!,brief=await getBrief(pool,run.brief_id);
  if(!config.structuredDiscoveryEnabled||!config.liveRetrievalEnabled)return finish("blocked","blocked","counterevidence_search_unavailable");
  const proposal=counterevidenceSearch(brief.originalQuestion,saved.action.questionKeys);
  if(!proposal)return finish("blocked","blocked","counterevidence_query_too_long");
  let search:Awaited<ReturnType<typeof performPublicSearch>>;
  try {search=await performPublicSearch(pool,config,session,{...args,proposal});}
  catch(error){
   if(!(error instanceof Error)||error.message!=="document_search_requires_public_query_approval")throw error;
   return {kind:"permission_required" as const};
  }
  if(search.kind!=="search")return finish(search.kind==="pending"?"unknown":"blocked",search.kind==="pending"?"outcome_unknown":search.reason==="discovery_query_limit"?"unresolved_at_limit":"blocked",search.kind==="pending"?"search_outcome_unknown":search.reason);
  await session.write(db=>db.query("UPDATE counterevidence_checks SET search_intent_id=$2 WHERE id=$1",[saved.id,search.intentId]));
  const sources=await session.write(db=>adoptSearchSources(db,{...args,intentId:search.intentId}));
  const reads:{operationId:string;sourceVersionId:string;readable:boolean}[]=[];
  for(const sourceHandle of sources){
   const read=await executeSourceRead(config,session,{...args,proposal:{rationale:"Read the admitted counterevidence search result.",action:{type:"fetch",sourceHandle,questionKeys:saved.action.questionKeys}}});
   if(read.kind!=="read")return finish(read.kind==="pending"?"unknown":"blocked",read.kind==="pending"?"outcome_unknown":"blocked",read.kind==="pending"?"source_read_outcome_unknown":read.reason);
   reads.push({operationId:read.operationId,sourceVersionId:read.sourceVersionId,readable:read.readable});evidenceChanged ||= !read.reused;
  }
  await session.write(db=>db.query("UPDATE counterevidence_checks SET state='read',read_operations=$2 WHERE id=$1",[saved.id,JSON.stringify(reads)]));
  if(reads.length!==search.hits.length||!reads.length||reads.some(r=>!r.readable))return finish("blocked","unresolved_at_limit","counterevidence_readable_evidence_unavailable");
 }
 const basis=await session.write(db=>counterevidenceContext(db,args));
 if(basis.kind!=="basis")return finish("blocked","unresolved_at_limit",basis.reason);
 evidenceChanged ||= basis.evidenceRevision!==startingRevision;
 if(basis.row.state==="checked"&&basis.row.evidence_revision===basis.evidenceRevision){
  if(!basis.row.model_intent_id)throw new Error("challenge_support_execution_unavailable");
  const modelIntentId=basis.row.model_intent_id;
  const result=await session.write(db=>persistCounterevidenceResult(db,{...args,modelIntentId},true));
  return {kind:"challenge" as const,id:saved.id as string,outcome:result.outcome,evidenceChanged,version:COUNTEREVIDENCE_VERSION};
 }
 const assessment=await performModelOperation(pool,config,session,{...args,...basis,operation:"assess_support"});
 if(assessment.kind!=="result")return finish(assessment.kind==="pending"?"unknown":"blocked",assessment.kind==="pending"?"outcome_unknown":"blocked",assessment.kind==="pending"?"support_outcome_unknown":assessment.reason);
 if(assessment.result.receipt.actualMicro===null)return finish("unknown","outcome_unknown","support_receipt_outcome_unknown");
 if(assessment.result.status!=="succeeded")return finish(assessment.result.status==="outcome_unknown"?"unknown":"blocked",assessment.result.status==="outcome_unknown"?"outcome_unknown":"unresolved_at_limit",`support_${assessment.result.status}`);
 const result=await session.write(db=>persistCounterevidenceResult(db,{...args,modelIntentId:assessment.intentId}));
 return {kind:"challenge" as const,id:saved.id as string,outcome:result.outcome,evidenceChanged,version:COUNTEREVIDENCE_VERSION};
}

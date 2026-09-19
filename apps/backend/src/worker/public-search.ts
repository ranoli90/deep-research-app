import {runModelVersions,runModelPolicy} from "../modules/run-model-policy.js";
import { createHash } from "node:crypto";
import type pg from "pg";
import { CONSENT_POLICY_VERSION,ResearchModelOutputs,CounterevidenceSearchSchema,COUNTEREVIDENCE_SUFFIX } from "@deep/contracts";
import { DEEP_DISCOVERY_CEILING,validateModelBindings } from "@deep/research-core";
import type { AppConfig } from "../platform/config.js";
import { withTx } from "../platform/db.js";
import { getBrief,getRun } from "../modules/runs.js";
import { briefContext,loadResearchTask } from "../modules/research-tasks.js";
import { reserveLiveAttempt } from "../modules/live-spend.js";
import { updateIntentState } from "../modules/billing.js";
import { DISCOVERY_POLICY,discoveryPolicyForNewSearch,DISCOVERY_ATTEMPT_RESERVE_MICRO,SearchResultSchema,type SearchResult } from "../ports/search.js";
import { liveWebSearch,publicSearchDigest } from "../adapters/retrieval/live-web.js";
import type { FencedSession } from "./fenced-session.js";
import { authorizeDiscoveryQuery,hasPublicQueryApproval,loadApprovedPrivateTerms,loadPrivateCanaries,loadPrivateDocumentText,persistFreshnessPolicy,recordQueryAuthorization } from "../modules/retrieval-intelligence.js";
import type { SourceClass } from "@deep/research-core";

/** One public query per logical action, independent of unrelated evidence arrival. No private source projection. */
export async function performPublicSearch(pool:pg.Pool,config:AppConfig,session:FencedSession,args:{runId:string;accountId:string;fence:number;briefRevision:number;taskId:string;proposal:unknown;sourceClass?:SourceClass}) {
 if(!config.structuredDiscoveryEnabled||!config.structuredModelEnabled||!config.liveRouteEnabled||config.openRouterModel!==DISCOVERY_POLICY.model)
  return {kind:"blocked" as const,reason:"structured_discovery_disabled"};
 const transformed=CounterevidenceSearchSchema.safeParse(args.proposal);
 const parsed=transformed.success?transformed:ResearchModelOutputs.propose_action.safeParse(args.proposal);
 if(!parsed.success||parsed.data.action.type!=="search")return {kind:"blocked" as const,reason:"invalid_search_action"};
 const proposal={...parsed.data,action:{...parsed.data.action,query:parsed.data.action.query.trim()}};
 const authorize=()=>session.write(async(db)=>{
  const run=await getRun(db,args.runId);if(!run||run.account_id!==args.accountId)throw new Error("search_owner_mismatch");
  const brief=await getBrief(db,run.brief_id),task=await loadResearchTask(db,args.runId,args.accountId,args.briefRevision,await runModelVersions(db,args.runId));
  if(!task||task.id!==args.taskId)throw new Error("search_task_mismatch");
  if(task.planningStatus!=="ready")throw new Error("search_task_requires_clarification");
  if(brief.attachmentIds.length&&!(await hasPublicQueryApproval(db,{accountId:args.accountId,runId:args.runId,briefRevision:args.briefRevision})))throw new Error("document_search_requires_public_query_approval");
  if(transformed.success&&(!config.structuredChallengeEnabled||proposal.action.query!==`${proposal.action.publicQueryBasis.quote.trim()} ${COUNTEREVIDENCE_SUFFIX}`))throw new Error("invalid_counterevidence_query_transform");
  const validatedProposal=transformed.success?{...proposal,action:{type:"search" as const,query:proposal.action.publicQueryBasis.quote.trim(),questionKeys:proposal.action.questionKeys,publicQueryBasis:proposal.action.publicQueryBasis}}:proposal;
  const errors=validateModelBindings("propose_action",validatedProposal,{...briefContext(brief.originalQuestion),task:task.specification});
  if(errors.length)throw new Error(`invalid_public_query:${errors.join(",")}`);
  const canaries=await loadPrivateCanaries(db,args.accountId,{runId:args.runId,briefRevision:args.briefRevision});
  const documentText=await loadPrivateDocumentText(db,args.accountId,{runId:args.runId,briefRevision:args.briefRevision});
  const approvedTerms=await loadApprovedPrivateTerms(db,{accountId:args.accountId,runId:args.runId,briefRevision:args.briefRevision});
  const auth=authorizeDiscoveryQuery({question:brief.originalQuestion,query:validatedProposal.action.query,privateCanaries:canaries,privateDocumentText:documentText,approvedPrivateTerms:approvedTerms,sourceClass:args.sourceClass});
  if(auth.kind==="blocked")throw new Error(auth.reason==="private_query_blocked"?"private_query_blocked":"unapproved_public_query_terms");
  if(auth.kind==="permission_required"){
    await recordQueryAuthorization(db,{accountId:args.accountId,runId:args.runId,briefRevision:args.briefRevision,proposedQuery:validatedProposal.action.query,authorization:auth});
    throw new Error("document_search_requires_public_query_approval");
  }
  if(canaries.some((c)=>c&&auth.query.toLowerCase().includes(c.toLowerCase())))throw new Error("private_query_blocked");
  return {query:auth.query,auth,question:brief.originalQuestion};
 });
 const prepared=await authorize();
 const searchQuery=transformed.success?proposal.action.query:prepared.query;
 const policy=await session.write(async db=>discoveryPolicyForNewSearch((await runModelPolicy(db,args.runId)).id));
 const bodyDigest=publicSearchDigest(searchQuery,policy.id);
 const digest=createHash("sha256").update(JSON.stringify({bodyDigest,policy:policy.id,briefRevision:args.briefRevision})).digest("hex");
 let attempt:Awaited<ReturnType<typeof reserveLiveAttempt>>;
 try {attempt=await reserveLiveAttempt(pool,config,{...args,requiredConsentPolicy:CONSENT_POLICY_VERSION,logicalKey:`public-search:${digest}:${args.sourceClass??"default"}`,kind:"search",
  route:`openrouter:${policy.model}:${policy.id}`,requestDigest:digest,reserveMicro:DISCOVERY_ATTEMPT_RESERVE_MICRO,maxRunRouteAttempts:DEEP_DISCOVERY_CEILING});}
 catch(error){if(error instanceof Error&&error.message==="route_attempt_limit")return {kind:"blocked" as const,reason:"discovery_query_limit"};throw error;}
 const finish=(result:SearchResult,reused:boolean)=>result.receipt.state==="confirmed"&&result.receipt.actualMicro!==undefined
  ?{kind:"search" as const,intentId:attempt.intentId,hits:result.hits,reused}
  :result.receipt.state==="failed"?{kind:"blocked" as const,reason:result.receipt.failureReason??"search_output_unavailable"}
  :result.receipt.actualMicro===undefined?{kind:"pending" as const,intentId:attempt.intentId}
  :{kind:"blocked" as const,reason:result.receipt.failureReason??"search_output_unavailable"};
 if(!attempt.issue) {
  const saved=await session.write(async (db)=>db.query(`SELECT s.result,(s.result->'receipt'=i.receipt AND i.run_id=s.run_id AND i.request_digest=s.request_digest) AS valid
   FROM search_operations s JOIN provider_intents i ON i.id=s.intent_id WHERE s.intent_id=$1 AND s.account_id=$2 AND s.run_id=$3 AND s.task_id=$4
   AND s.brief_revision=$5 AND s.policy_id=$6 AND s.request_digest=$7`,[attempt.intentId,args.accountId,args.runId,args.taskId,args.briefRevision,policy.id,digest]));
  if(!saved.rows[0])return {kind:"pending" as const,intentId:attempt.intentId};
  const result=SearchResultSchema.safeParse(saved.rows[0].result);
  if(!saved.rows[0].valid||!result.success||result.data.receipt.requestDigest!==bodyDigest||result.data.receipt.route!==`openrouter:${policy.model}:${policy.id}`)
   throw new Error("invalid_saved_search");
  return finish(result.data,true);
 }
 const result=SearchResultSchema.parse(await liveWebSearch(searchQuery,config,session.signal,45_000,true,policy.id));
 await withTx(pool,async(db)=>{
  const state=result.receipt.state==="failed"?"failed":result.receipt.actualMicro===undefined?"outcome-unknown":"confirmed";
  await updateIntentState(db,attempt.intentId,state,state==="confirmed"?result.receipt.actualMicro:undefined);
  await db.query("UPDATE provider_intents SET receipt=$2 WHERE id=$1",[attempt.intentId,JSON.stringify(result.receipt)]);
 });
 await authorize();
 await session.write(async (db)=>{
  await recordQueryAuthorization(db,{accountId:args.accountId,runId:args.runId,briefRevision:args.briefRevision,proposedQuery:proposal.action.query,authorization:{...prepared.auth,query:searchQuery}});
  await persistFreshnessPolicy(db,{accountId:args.accountId,runId:args.runId,question:prepared.question});
  await db.query(`INSERT INTO search_operations(intent_id,account_id,run_id,task_id,brief_revision,policy_id,request_digest,result)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[attempt.intentId,args.accountId,args.runId,args.taskId,args.briefRevision,policy.id,digest,JSON.stringify(result)]);
 });
 return finish(result,false);
}

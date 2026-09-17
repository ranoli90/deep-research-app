import { createHash } from "node:crypto";
import type pg from "pg";
import { CONSENT_POLICY_VERSION,ResearchModelOutputs } from "@deep/contracts";
import { validateModelBindings } from "@deep/research-core";
import type { AppConfig } from "../platform/config.js";
import { withTx } from "../platform/db.js";
import { getBrief,getRun } from "../modules/runs.js";
import { briefContext,loadResearchTask } from "../modules/research-tasks.js";
import { reserveLiveAttempt } from "../modules/live-spend.js";
import { updateIntentState } from "../modules/billing.js";
import { DISCOVERY_POLICY,DISCOVERY_RESERVE_MICRO,SearchResultSchema,type SearchResult } from "../ports/search.js";
import { liveWebSearch,publicSearchDigest } from "../adapters/retrieval/live-web.js";
import { TASK_MODEL_VERSIONS } from "./research-task.js";
import type { FencedSession } from "./fenced-session.js";

/** One public query per logical action, independent of unrelated evidence arrival. No private source projection. */
export async function performPublicSearch(pool:pg.Pool,config:AppConfig,session:FencedSession,args:{runId:string;accountId:string;fence:number;briefRevision:number;taskId:string;proposal:unknown}) {
 if(!config.structuredDiscoveryEnabled||!config.structuredModelEnabled||!config.liveRouteEnabled||config.openRouterModel!==DISCOVERY_POLICY.model)
  return {kind:"blocked" as const,reason:"structured_discovery_disabled"};
 const parsed=ResearchModelOutputs.propose_action.safeParse(args.proposal);
 if(!parsed.success||parsed.data.action.type!=="search")return {kind:"blocked" as const,reason:"invalid_search_action"};
 const proposal={...parsed.data,action:{...parsed.data.action,query:parsed.data.action.query.trim()}};
 const validate=()=>session.write(async(db)=>{
  const run=await getRun(db,args.runId);if(!run||run.account_id!==args.accountId)throw new Error("search_owner_mismatch");
  const brief=await getBrief(db,run.brief_id),task=await loadResearchTask(db,args.runId,args.accountId,args.briefRevision,TASK_MODEL_VERSIONS);
  if(!task||task.id!==args.taskId)throw new Error("search_task_mismatch");
  if(task.planningStatus!=="ready")throw new Error("search_task_requires_clarification");
  // Explicit private/public query approval for mixed document tasks remains a separate unfinished capability.
  if(brief.attachmentIds.length)throw new Error("document_search_requires_public_query_approval");
  const errors=validateModelBindings("propose_action",proposal,{...briefContext(brief.originalQuestion),task:task.specification});
  if(errors.length)throw new Error(`invalid_public_query:${errors.join(",")}`);
 });
 await validate();
 const bodyDigest=publicSearchDigest(proposal.action.query);
 const digest=createHash("sha256").update(JSON.stringify({bodyDigest,policy:DISCOVERY_POLICY.id,briefRevision:args.briefRevision})).digest("hex");
 const attempt=await reserveLiveAttempt(pool,config,{...args,requiredConsentPolicy:CONSENT_POLICY_VERSION,logicalKey:`public-search:${digest}`,kind:"search",
  route:`openrouter:${DISCOVERY_POLICY.model}:${DISCOVERY_POLICY.id}`,requestDigest:digest,reserveMicro:DISCOVERY_RESERVE_MICRO});
 const finish=(result:SearchResult,reused:boolean)=>result.receipt.state==="confirmed"&&result.receipt.actualMicro!==undefined
  ?{kind:"search" as const,intentId:attempt.intentId,hits:result.hits,reused}
  :result.receipt.actualMicro===undefined?{kind:"pending" as const,intentId:attempt.intentId}
  :{kind:"blocked" as const,reason:result.receipt.failureReason??"search_output_unavailable"};
 if(!attempt.issue) {
  const saved=await session.write((db)=>db.query(`SELECT s.result,(s.result->'receipt'=i.receipt AND i.run_id=s.run_id AND i.request_digest=s.request_digest) AS valid
   FROM search_operations s JOIN provider_intents i ON i.id=s.intent_id WHERE s.intent_id=$1 AND s.account_id=$2 AND s.run_id=$3 AND s.task_id=$4
   AND s.brief_revision=$5 AND s.policy_id=$6 AND s.request_digest=$7`,[attempt.intentId,args.accountId,args.runId,args.taskId,args.briefRevision,DISCOVERY_POLICY.id,digest]));
  if(!saved.rows[0])return {kind:"pending" as const,intentId:attempt.intentId};
  const result=SearchResultSchema.safeParse(saved.rows[0].result);
  if(!saved.rows[0].valid||!result.success||result.data.receipt.requestDigest!==bodyDigest||result.data.receipt.route!==`openrouter:${DISCOVERY_POLICY.model}:${DISCOVERY_POLICY.id}`)
   throw new Error("invalid_saved_search");
  return finish(result.data,true);
 }
 const result=SearchResultSchema.parse(await liveWebSearch(proposal.action.query,config,session.signal,45_000,true));
 await withTx(pool,async(db)=>{await updateIntentState(db,attempt.intentId,result.receipt.actualMicro===undefined?"outcome-unknown":"confirmed",result.receipt.actualMicro);
  await db.query("UPDATE provider_intents SET receipt=$2 WHERE id=$1",[attempt.intentId,JSON.stringify(result.receipt)]);});
 await validate();
 await session.write((db)=>db.query(`INSERT INTO search_operations(intent_id,account_id,run_id,task_id,brief_revision,policy_id,request_digest,result)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[attempt.intentId,args.accountId,args.runId,args.taskId,args.briefRevision,DISCOVERY_POLICY.id,digest,JSON.stringify(result)]));
 return finish(result,false);
}

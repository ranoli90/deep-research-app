import {runModelPolicy} from "./run-model-policy.js";
import type { Queryable } from "../platform/db.js";
import { discoveryPolicyForNewSearch,SearchResultSchema } from "../ports/search.js";
import { sourcePolicyAllows, primarySourceEntity, canonicalSourceUrl, parseSourcePublicationDate, applySourcePolicy, admitUserSuppliedUrl, policyFromRestrictions } from "@deep/research-core";
import { getBrief, getRun } from "./runs.js";
import { insertSource,insertVersionAndPassage } from "./evidence.js";
import { bumpEvidence } from "./runs.js";
import { persistSourceOrigins } from "./retrieval-intelligence.js";
/** Adopt only an owned persisted successful search, never caller-supplied hits. Caller holds its fence. */
export async function adoptSearchSources(db:Queryable,args:{runId:string;accountId:string;briefRevision:number;taskId:string;intentId:string}) {
 const policy=discoveryPolicyForNewSearch((await runModelPolicy(db,args.runId)).id);
 const row=(await db.query(`SELECT s.result,(s.result->'receipt'=i.receipt AND i.run_id=s.run_id AND i.request_digest=s.request_digest) AS valid
  FROM search_operations s JOIN provider_intents i ON i.id=s.intent_id WHERE s.intent_id=$1 AND s.run_id=$2 AND s.account_id=$3
  AND s.brief_revision=$4 AND s.task_id=$5 AND s.policy_id=$6`,[args.intentId,args.runId,args.accountId,args.briefRevision,args.taskId,policy.id])).rows[0];
 const parsed=SearchResultSchema.safeParse(row?.result);
 if(!row?.valid||!parsed.success||parsed.data.receipt.state!=="confirmed"||parsed.data.receipt.actualMicro===undefined||parsed.data.receipt.route!==`openrouter:${policy.model}:${policy.id}`)throw new Error("search_result_not_adoptable");
 const run=await getRun(db,args.runId);
 const brief=run?await getBrief(db,run.brief_id):null;
 const sourcePolicy=policyFromRestrictions(brief?.sourceRestrictions);
 const sourceIds:string[]=[];let changed=false;
 for(const originalHit of [...parsed.data.hits].sort((a,b)=>Number(applySourcePolicy(sourcePolicy,b.locator,brief?.originalQuestion)==="prefer")-Number(applySourcePolicy(sourcePolicy,a.locator,brief?.originalQuestion)==="prefer"))) {
  let locator:string;
  try { locator=canonicalSourceUrl(originalHit.locator); }
  catch { continue; }
  const hit={...originalHit,locator};
  if(applySourcePolicy(sourcePolicy,hit.locator,brief?.originalQuestion)==="exclude")continue;
  const blocked=(await db.query(`SELECT 1 FROM sources s JOIN source_versions v ON v.source_id=s.id
    JOIN extraction_receipts r ON r.source_version_id=v.id
    WHERE s.account_id=$1 AND s.run_id=$2 AND s.canonical_locator=$3 AND v.access_level='blocked' LIMIT 1`,
    [args.accountId,args.runId,hit.locator])).rowCount;
  if(blocked)continue;
  const prior=(await db.query("SELECT s.id,(s.run_id=$1) AS owned FROM sources s WHERE s.account_id=$2 AND (s.canonical_locator=$3 OR EXISTS(SELECT 1 FROM source_versions alias WHERE alias.source_id=s.id AND alias.account_id=s.account_id AND alias.final_locator=$3)) AND (s.run_id=$1 OR EXISTS(SELECT 1 FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id WHERE p.run_id=$1 AND p.account_id=$2 AND v.source_id=s.id)) ORDER BY (s.run_id=$1) DESC LIMIT 1",[args.runId,args.accountId,hit.locator])).rows[0];
  if(prior){if(prior.owned)sourceIds.push(prior.id);continue;}
  const id=await insertSource(db,{...args,...hit,originalLocator:originalHit.locator,sourceType:primarySourceEntity(hit.locator,brief?.originalQuestion)?.sourceType ?? hit.sourceType,publicationDate:parseSourcePublicationDate(`${hit.title}\n${hit.snippet}`)});sourceIds.push(id);changed=true;
  if(hit.snippet)await insertVersionAndPassage(db,{...args,sourceId:id,locator:hit.locator,text:hit.snippet,accessLevel:"snippet",extractionMethod:"search-snippet"});
 }
 if(changed)await bumpEvidence(db,args.runId);
 await persistSourceOrigins(db,{accountId:args.accountId,runId:args.runId});
 return sourceIds;
}

/** Persist user-supplied locators as owned sources so the worker can read them. Search hits are not a substitute. */
export async function adoptDirectUrls(db:Queryable,args:{runId:string;accountId:string}) {
 const run=await getRun(db,args.runId);
 const brief=run?await getBrief(db,run.brief_id):null;
 const policy=policyFromRestrictions(brief?.sourceRestrictions);
 const sourceIds:string[]=[];let changed=false;
 for(const originalLocator of policy.userSuppliedUrls){
  if(!admitUserSuppliedUrl(policy,originalLocator))continue;
  let locator:string;
  try { locator=canonicalSourceUrl(originalLocator); }
  catch { continue; }
  const prior=(await db.query("SELECT id FROM sources WHERE account_id=$1 AND run_id=$2 AND canonical_locator=$3",[args.accountId,args.runId,locator])).rows[0];
  if(prior){sourceIds.push(prior.id);continue;}
  let host="source";
  try { host=new URL(locator).hostname.replace(/^www\./,"").toLowerCase(); } catch { continue; }
  const id=await insertSource(db,{accountId:args.accountId,runId:args.runId,locator,originalLocator,title:host,publisher:host,originCluster:`direct:${host}`,sourceType:"web"});
  sourceIds.push(id);changed=true;
 }
 if(changed)await bumpEvidence(db,args.runId);
 return sourceIds;
}

/** Revision-scoped exclusions remove newly forbidden evidence without rewriting historical versions. */
export async function revalidateSourcePolicy(db:Queryable,args:{runId:string;accountId:string;briefRevision:number}) {
 const run=await getRun(db,args.runId);
 if(!run||run.account_id!==args.accountId||run.brief_revision!==args.briefRevision)throw new Error("source_policy_revision_mismatch");
 const brief=await getBrief(db,run.brief_id),policy=policyFromRestrictions(brief.sourceRestrictions);
 const versions=await db.query<{id:string;final_locator:string}>(`SELECT DISTINCT v.id,v.final_locator FROM source_versions v JOIN sources s ON s.id=v.source_id
   WHERE v.account_id=$2 AND s.account_id=$2 AND (s.run_id=$1 OR EXISTS(SELECT 1 FROM run_evidence_membership m WHERE m.run_id=$1 AND m.account_id=$2 AND m.source_version_id=v.id))`,[args.runId,args.accountId]);
 let changed=false;
 for(const v of versions.rows){
  if(v.final_locator.startsWith("attachment://"))continue;
  if(sourcePolicyAllows(policy,v.final_locator,brief.originalQuestion))continue;
  const inserted=await db.query("INSERT INTO source_policy_exclusions(run_id,account_id,brief_revision,source_version_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[args.runId,args.accountId,args.briefRevision,v.id]);
  changed ||= inserted.rowCount===1;
 }
 if(changed)await bumpEvidence(db,args.runId);
}

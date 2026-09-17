import type { Queryable } from "../platform/db.js";
import { DISCOVERY_POLICY,SearchResultSchema } from "../ports/search.js";
import { insertSource,insertVersionAndPassage } from "./evidence.js";
import { bumpEvidence } from "./runs.js";
/** Adopt only an owned persisted successful search, never caller-supplied hits. Caller holds its fence. */
export async function adoptSearchSources(db:Queryable,args:{runId:string;accountId:string;briefRevision:number;taskId:string;intentId:string}) {
 const row=(await db.query(`SELECT s.result,(s.result->'receipt'=i.receipt AND i.run_id=s.run_id AND i.request_digest=s.request_digest) AS valid
  FROM search_operations s JOIN provider_intents i ON i.id=s.intent_id WHERE s.intent_id=$1 AND s.run_id=$2 AND s.account_id=$3
  AND s.brief_revision=$4 AND s.task_id=$5 AND s.policy_id=$6`,[args.intentId,args.runId,args.accountId,args.briefRevision,args.taskId,DISCOVERY_POLICY.id])).rows[0];
 const parsed=SearchResultSchema.safeParse(row?.result);
 if(!row?.valid||!parsed.success||parsed.data.receipt.state!=="confirmed"||parsed.data.receipt.actualMicro===undefined||parsed.data.receipt.route!==`openrouter:${DISCOVERY_POLICY.model}:${DISCOVERY_POLICY.id}`)throw new Error("search_result_not_adoptable");
 const sourceIds:string[]=[];let changed=false;
 for(const hit of parsed.data.hits) {
  const prior=(await db.query("SELECT id FROM sources WHERE run_id=$1 AND account_id=$2 AND canonical_locator=$3",[args.runId,args.accountId,hit.locator])).rows[0];
  if(prior){sourceIds.push(prior.id);continue;}
  const id=await insertSource(db,{...args,...hit});sourceIds.push(id);changed=true;
  if(hit.snippet)await insertVersionAndPassage(db,{...args,sourceId:id,locator:hit.locator,text:hit.snippet,accessLevel:"snippet",extractionMethod:"search-snippet"});
 }
 if(changed)await bumpEvidence(db,args.runId);
 return sourceIds;
}

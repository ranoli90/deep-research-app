import { createHash } from "node:crypto";
import type pg from "pg";
import { CONSENT_POLICY_VERSION,DEFAULT_RUN_BUDGET_MICRO,ResearchCorrectionPatchSchema,type CorrectionRequest } from "@deep/contracts";
import { extractConstraints,inferOutputPreference } from "@deep/research-core";
import { withTx } from "../platform/db.js";
import { currentConsent,lockActiveAccount } from "./access.js";
import { reserveAllowance } from "./billing.js";
import { findRunByIdempotency,getRun,getBrief,insertBrief,insertRun,emitEvent } from "./runs.js";
import { inheritRunEvidence } from "./run-evidence.js";
function reject(message:string,statusCode:number):never {throw Object.assign(new Error(message),{statusCode});}

/** Atomic patch, child, allowance, immutable evidence membership and dispatch outbox. */
export async function admitResearchCorrection(pool:pg.Pool,accountId:string,parentRunId:string,input:CorrectionRequest) {
 const patch=ResearchCorrectionPatchSchema.parse(input.patch);
 if(input.claimId||input.blockId)reject("replacement_patch_cannot_target_claim_or_block",400);
 const accepted={version:"research-correction.v1",patch,acceptedText:input.correctionText,expectedBriefRevision:input.expectedBriefRevision};
 const key=`correction-v2:${parentRunId}:${createHash("sha256").update(JSON.stringify(accepted)).digest("hex")}`;
 return withTx(pool,async(db)=>{
  await lockActiveAccount(db,accountId);
  const parent=await getRun(db,parentRunId,{forUpdate:true});
  if(!parent||parent.account_id!==accountId||parent.route_mode!=="controlled-research")reject("correction_parent_unavailable",404);
  if((await db.query("SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='run' AND object_id=$2 AND reason='source_deletion'",[accountId,parentRunId])).rowCount)reject("correction_parent_unavailable",409);
  const consent=await currentConsent(db,accountId);
  if(!consent||consent.revoked||consent.policyVersion!==CONSENT_POLICY_VERSION)reject("consent_required",403);
  if(parent.brief_revision!==input.expectedBriefRevision)reject("stale_revision",409);
  const existing=await findRunByIdempotency(db,accountId,key);
  if(existing)return {runId:existing.id,parentRunId,briefRevision:existing.brief_revision,fullRerun:true,reused:true};
  await db.query("SELECT id FROM conversations WHERE id=$1 AND account_id=$2 FOR UPDATE",[parent.conversation_id,accountId]);
  const old=await getBrief(db,parent.brief_id);
  for(const id of old.attachmentIds)if(!(await db.query("SELECT 1 FROM attachments WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL",[id,accountId])).rowCount)reject("attachment_unavailable",409);
  const revision=(await db.query("SELECT COALESCE(MAX(revision),0)::integer+1 AS revision FROM research_briefs WHERE conversation_id=$1",[parent.conversation_id])).rows[0].revision as number;
  const brief={...old,id:crypto.randomUUID(),revision,originalQuestion:patch.question,constraints:extractConstraints(patch.question),
    assumptions:[],outputPreferences:inferOutputPreference(patch.question),consentPolicyVersion:CONSENT_POLICY_VERSION};
  await insertBrief(db,brief,accountId);
  const runId=crypto.randomUUID();
  await insertRun(db,{id:runId,accountId,conversationId:parent.conversation_id,briefId:brief.id,parentRunId,routeMode:parent.route_mode,briefRevision:revision,consentEpoch:consent.epoch,idempotencyKey:key,budgetMicro:DEFAULT_RUN_BUDGET_MICRO});
  await reserveAllowance(db,accountId,runId,DEFAULT_RUN_BUDGET_MICRO);
  const reusedPassages=patch.evidencePolicy==="reuse_snapshot"?await inheritRunEvidence(db,{runId,parentRunId,accountId}):0;
  await db.query("INSERT INTO research_change_sets(run_id,account_id,parent_run_id,patch,dependency_completeness,reused_passages,reopen_discovery) VALUES($1,$2,$3,$4,'unknown',$5,true)",[runId,accountId,parentRunId,JSON.stringify(accepted),reusedPassages]);
  await emitEvent(db,{runId,accountId,type:"correction_accepted",phase:"preparing",summary:"The revised question will be researched again; prior conclusions are not carried forward.",payload:{patchKind:patch.kind,evidencePolicy:patch.evidencePolicy,reusedPassages,dependencyCompleteness:"unknown",fullRerun:true,reopenDiscovery:true}});
  return {runId,parentRunId,briefRevision:revision,fullRerun:true,reused:false};
 });
}

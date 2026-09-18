import { createHash } from "node:crypto";
import type pg from "pg";
import { CONSENT_POLICY_VERSION,DEFAULT_RUN_BUDGET_MICRO,ResearchCorrectionPatchSchema,type CorrectionRequest } from "@deep/contracts";
import { applyQuestionPatch,extractConstraints,inferOutputPreference } from "@deep/research-core";
import { withTx } from "../platform/db.js";
import { currentConsent,lockActiveAccount } from "./access.js";
import { reserveAllowance } from "./billing.js";
import { findRunByIdempotency,getRun,getBrief,insertBrief,insertRun,emitEvent } from "./runs.js";
import { admissionKeyHash } from "./admission-recovery.js";
import { inheritRunEvidence } from "./run-evidence.js";
function reject(message:string,statusCode:number):never {throw Object.assign(new Error(message),{statusCode});}

/** Shared exact accepted correction identity; no caller-supplied run/account fields. */
export function researchCorrectionIdentity(parentRunId:string,input:CorrectionRequest) {
 const patch=ResearchCorrectionPatchSchema.parse(input.patch);
 if(input.claimId||input.blockId)reject("replacement_patch_cannot_target_claim_or_block",400);
 const accepted={version:"research-correction.v1",patch,acceptedText:input.correctionText,expectedBriefRevision:input.expectedBriefRevision};
 const key=`correction-v2:${parentRunId}:${createHash("sha256").update(JSON.stringify(accepted)).digest("hex")}`;
 return {patch,accepted,key};
}

/** Atomic patch, child, allowance, immutable evidence membership and dispatch outbox. */
export async function admitResearchCorrection(pool:pg.Pool,accountId:string,parentRunId:string,input:CorrectionRequest) {
 const {patch,accepted,key}=researchCorrectionIdentity(parentRunId,input);
 return withTx(pool,async(db)=>{
  await lockActiveAccount(db,accountId);
  const parent=await getRun(db,parentRunId,{forUpdate:true});
  if(!parent||parent.account_id!==accountId||parent.route_mode!=="controlled-research")reject("correction_parent_unavailable",404);
  if((await db.query("SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='run' AND object_id=$2 AND reason='source_deletion'",[accountId,parentRunId])).rowCount)reject("correction_parent_unavailable",409);
  if((await db.query("SELECT 1 FROM admission_withdrawals WHERE account_id=$1 AND key_hash=$2",[accountId,admissionKeyHash(key)])).rowCount)reject("idempotency_withdrawn",409);
  const consent=await currentConsent(db,accountId);
  if(!consent||consent.revoked||consent.policyVersion!==CONSENT_POLICY_VERSION)reject("consent_required",403);
  if(parent.brief_revision!==input.expectedBriefRevision)reject("stale_revision",409);
  const existing=await findRunByIdempotency(db,accountId,key);
  if(existing)return {runId:existing.id,parentRunId,briefRevision:existing.brief_revision,fullRerun:true,reused:true};
  await db.query("SELECT id FROM conversations WHERE id=$1 AND account_id=$2 FOR UPDATE",[parent.conversation_id,accountId]);
  const old=await getBrief(db,parent.brief_id);
  let question:string;
  try{question=applyQuestionPatch(old.originalQuestion,createHash("sha256").update(old.originalQuestion).digest("hex"),patch);}
  catch(error){if(error instanceof Error&&error.message.startsWith("question_patch_"))reject(error.message,409);throw error;}
  const append=patch.kind==="append_attachments";
  const attachmentIds=append?[...old.attachmentIds,...patch.attachmentIds.map(id=>id.toLowerCase())]:old.attachmentIds;
  if(append&&(attachmentIds.length>3||patch.attachmentIds.some(id=>old.attachmentIds.some(prior=>prior.toLowerCase()===id.toLowerCase()))))reject("attachment_append_invalid",409);
  for(const id of attachmentIds)if(!(await db.query("SELECT 1 FROM attachments WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL",[id,accountId])).rowCount)reject("attachment_unavailable",409);
  const revision=(await db.query("SELECT COALESCE(MAX(revision),0)::integer+1 AS revision FROM research_briefs WHERE conversation_id=$1",[parent.conversation_id])).rows[0].revision as number;
  const brief={...old,id:crypto.randomUUID(),revision,attachmentIds,
    ...(append?{}:{originalQuestion:question,constraints:extractConstraints(question),assumptions:[],outputPreferences:inferOutputPreference(question)}),
    consentPolicyVersion:CONSENT_POLICY_VERSION};
  await insertBrief(db,brief,accountId);
  const runId=crypto.randomUUID();
  await insertRun(db,{id:runId,accountId,conversationId:parent.conversation_id,briefId:brief.id,parentRunId,routeMode:parent.route_mode,briefRevision:revision,consentEpoch:consent.epoch,idempotencyKey:key,budgetMicro:DEFAULT_RUN_BUDGET_MICRO});
  await reserveAllowance(db,accountId,runId,DEFAULT_RUN_BUDGET_MICRO);
  const reusedPassages=patch.evidencePolicy==="reuse_snapshot"?await inheritRunEvidence(db,{runId,parentRunId,accountId}):0;
  await db.query("INSERT INTO research_change_sets(run_id,account_id,parent_run_id,patch,dependency_completeness,reused_passages,reopen_discovery) VALUES($1,$2,$3,$4,'unknown',$5,$6)",[runId,accountId,parentRunId,JSON.stringify(accepted),reusedPassages,!append]);
  await emitEvent(db,{runId,accountId,type:"correction_accepted",phase:"preparing",summary:append?"New documents will be checked with earlier evidence; prior conclusions are not carried forward.":"The revised question will be researched again; prior conclusions are not carried forward.",payload:{patchKind:patch.kind,evidencePolicy:patch.evidencePolicy,reusedPassages,dependencyCompleteness:"unknown",fullRerun:true,reopenDiscovery:!append}});
  return {runId,parentRunId,briefRevision:revision,fullRerun:true,reused:false};
 });
}

/** Read an exact child or withdraw its identity; never schedule, spend, or require renewed processing consent. */
export async function resolveResearchCorrection(pool:pg.Pool,accountId:string,parentRunId:string,input:CorrectionRequest){
 const {accepted,key}=researchCorrectionIdentity(parentRunId,input),hash=admissionKeyHash(key);
 return withTx(pool,async db=>{
  const account=await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[accountId]);
  if(!account.rowCount)return null;
  const parent=await getRun(db,parentRunId,{forUpdate:true});
  if(!parent||parent.account_id!==accountId||parent.route_mode!=="controlled-research")reject("correction_parent_unavailable",404);
  const withdrawn=await db.query("SELECT 1 FROM admission_withdrawals WHERE account_id=$1 AND key_hash=$2",[accountId,hash]);
  if(withdrawn.rowCount)return {status:"withdrawn" as const};
  const deleted=await db.query("SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='run' AND object_id=$2 AND reason='source_deletion'",[accountId,parentRunId]);
  const run=deleted.rowCount?null:await findRunByIdempotency(db,accountId,key);
  if(run){
   const proof=await db.query("SELECT 1 FROM research_change_sets WHERE run_id=$1 AND account_id=$2 AND parent_run_id=$3 AND patch=$4::jsonb",[run.id,accountId,parentRunId,JSON.stringify(accepted)]);
   const removed=await db.query("SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='run' AND object_id=$2 AND reason='source_deletion'",[accountId,run.id]);
   if(run.parent_run_id!==parentRunId||run.route_mode!=="controlled-research"||!proof.rowCount||removed.rowCount)reject("correction_recovery_basis_unavailable",409);
   return {status:"accepted" as const,run:{runId:run.id,lifecycle:run.lifecycle,phase:run.phase,labeledDemo:false}};
  }
  await db.query("INSERT INTO admission_withdrawals(account_id,key_hash) VALUES($1,$2) ON CONFLICT DO NOTHING",[accountId,hash]);
  return {status:"withdrawn" as const};
 });
}

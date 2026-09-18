import {runModelVersions} from "./run-model-policy.js";
import { EvidenceSelectionProofError } from "./evidence-selections.js";
import { MODEL_CONTEXT_MAX_PASSAGES } from "../ports/model.js";
import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { CONSENT_POLICY_VERSION,DEFAULT_RUN_BUDGET_MICRO,ResearchModelOutputs,RequestedVerificationRequestSchema,type RequestedVerificationRequest } from "@deep/contracts";
import { withTx,type Queryable } from "../platform/db.js";
import type { AppConfig } from "../platform/config.js";
import { lockActiveAccount,currentConsent } from "./access.js";
import { getRun,getBrief,findRunByIdempotency,insertBrief,insertRun,emitEvent } from "./runs.js";
import { reserveAllowance } from "./billing.js";
import { admissionKeyHash } from "./admission-recovery.js";
import { inheritRunEvidence } from "./run-evidence.js";
import { loadSupportContext,persistScopedSupport } from "./scoped-support.js";
import { MODEL_PROMPT_VERSION,STRUCTURED_MODEL_POLICY } from "../ports/model-policy.js";
import { counterevidenceDigest } from "./counterevidence.js";

type VerificationTargetFailure =
 | "required_verification_target_missing" | "verification_target_schema_invalid" | "verification_target_record_invalid"
 | "verification_target_digest_changed" | "verification_original_target_changed"
 | "verification_report_or_claim_unavailable" | "verification_parent_unavailable"
 | "verification_lineage_cycle" | "verification_lineage_limit" | "verification_target_provenance_unavailable";
/** Deterministic stored-target failures only; never wraps database, lease or provider errors. */
export class VerificationTargetError extends Error {
 constructor(readonly reason:VerificationTargetFailure,readonly statusCode=409){super(reason);this.name="VerificationTargetError";}
}

const Source=z.object({id:z.string().uuid(),locator:z.string(),title:z.string(),publisher:z.string(),originCluster:z.string()}).strict();
export const VerificationTargetSchema=z.object({
 assertion:ResearchModelOutputs.extract_assertions.shape.assertions.element,task:ResearchModelOutputs.brief,
 parentTaskId:z.string().uuid(),extractionIntentId:z.string().uuid(),supportIntentId:z.string().uuid(),parentBriefRevision:z.number().int(),
 claimRevisionId:z.string().uuid(),passages:z.array(z.object({id:z.string().uuid(),digest:z.string()}).strict()).min(1).max(MODEL_CONTEXT_MAX_PASSAGES),sources:z.array(Source).min(1).max(24),
}).strict();
function parseVerificationTarget(raw:unknown){
 const parsed=VerificationTargetSchema.safeParse(raw);
 if(!parsed.success)throw new VerificationTargetError("verification_target_schema_invalid");
 return parsed.data;
}
const VerificationRowSchema=z.object({id:z.string().uuid(),account_id:z.string().uuid(),run_id:z.string().uuid(),parent_run_id:z.string().uuid(),
 report_id:z.string().uuid(),report_version:z.number().int(),claim_id:z.string().uuid(),claim_revision_id:z.string().uuid(),brief_revision:z.number().int(),
 request_digest:z.string(),target:VerificationTargetSchema,target_digest:z.string(),evidence_policy:z.enum(["reuse_snapshot","refresh_sources"]),private_note:z.string(),
 state:z.enum(["queued","reading","checked","blocked","unknown"]),source_map:z.array(z.object({originSourceId:z.string().uuid(),sourceId:z.string().uuid()}).strict()),
 model_intent_id:z.string().uuid().nullable(),evidence_revision:z.number().int().nullable(),context_manifest:z.unknown(),result:z.unknown(),output_claim_id:z.string().uuid().nullable()});
export const verificationDigest=counterevidenceDigest;
export const requestedVerificationDigest=(parentRunId:string,request:RequestedVerificationRequest)=>createHash("sha256").update(JSON.stringify({parentRunId,...RequestedVerificationRequestSchema.parse(request)})).digest("hex");
function reject(message:string,statusCode:number):never{throw Object.assign(new Error(message),{statusCode});}
export async function captureVerificationTarget(db:Queryable,args:{accountId:string;parentRunId:string;reportId:string;reportVersion:number;claimId:string}){
 const versions=await runModelVersions(db,args.parentRunId);
 const report=(await db.query("SELECT id FROM reports WHERE id=$1 AND run_id=$2 AND account_id=$3 AND version=$4 AND redacted_at IS NULL AND $5=ANY(claim_ids)",[args.reportId,args.parentRunId,args.accountId,args.reportVersion,args.claimId])).rows[0];
 if(!report)throw new VerificationTargetError("verification_report_or_claim_unavailable",409);
 const parent=await getRun(db,args.parentRunId);if(!parent||parent.account_id!==args.accountId)throw new VerificationTargetError("verification_parent_unavailable",404);
 const previous=(await db.query("SELECT id FROM requested_verifications WHERE run_id=$1 AND account_id=$2 AND output_claim_id=$3",[parent.id,args.accountId,args.claimId])).rows[0];
 if(previous){
  // Bound recursive proof restoration, including malformed/cyclic lineage, before entering it.
  const lineage=await db.query(`WITH RECURSIVE lineage AS (
   SELECT run_id,parent_run_id,1 AS depth,ARRAY[run_id] AS path,false AS cycle FROM requested_verifications WHERE run_id=$1 AND account_id=$2
   UNION ALL SELECT v.run_id,v.parent_run_id,l.depth+1,l.path||v.run_id,v.run_id=ANY(l.path) FROM requested_verifications v JOIN lineage l ON v.run_id=l.parent_run_id
   WHERE v.account_id=$2 AND l.depth<8 AND NOT l.cycle
  ) SELECT MAX(depth)::int AS depth,BOOL_OR(cycle) AS cycle FROM lineage`,[parent.id,args.accountId]);
  if(lineage.rows[0]?.cycle)throw new VerificationTargetError("verification_lineage_cycle",409);
  if(lineage.rows[0]?.depth>=8)throw new VerificationTargetError("verification_lineage_limit",409);
  const {restoreVerificationCheck}=await import("./verification-proof.js");
  const checked=await restoreVerificationCheck(db,{runId:parent.id,accountId:args.accountId,briefRevision:parent.brief_revision});
  if(checked.value.outcome!=="supported_in_inspected_evidence")throw new VerificationTargetError("verification_target_provenance_unavailable",409);
  const revision=(await db.query("SELECT id,text,text_digest,scope FROM claim_revisions WHERE claim_id=$1 AND run_id=$2 AND account_id=$3 ORDER BY revision DESC LIMIT 1",[args.claimId,parent.id,args.accountId])).rows[0];
  const assertion={...checked.saved.target.assertion,evidence:checked.value.check.evidence};
  if(!revision||revision.text!==assertion.text||revision.text_digest!==createHash("sha256").update(assertion.text).digest("hex")||revision.scope.requestedVerificationId!==checked.saved.id||verificationDigest(revision.scope.semanticScope)!==verificationDigest(assertion.scope))throw new VerificationTargetError("verification_target_provenance_unavailable",409);
  const sources=(await db.query(`SELECT DISTINCT s.id,s.canonical_locator AS locator,s.title,COALESCE(s.publisher,'') AS publisher,COALESCE(s.origin_cluster,'') AS "originCluster"
   FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id JOIN sources s ON s.id=v.source_id
   WHERE p.account_id=$1 AND p.run_id=$2 AND p.id=ANY($3::uuid[]) ORDER BY s.id`,[args.accountId,parent.id,checked.context.passages.map(p=>p.id)])).rows;
  return parseVerificationTarget({assertion,task:checked.context.task,parentTaskId:checked.saved.target.parentTaskId,
   extractionIntentId:checked.saved.target.extractionIntentId,supportIntentId:checked.intentId,parentBriefRevision:parent.brief_revision,claimRevisionId:revision.id,
   passages:checked.context.passages.map(p=>({id:p.id,digest:p.digest})),sources});
 }
 const row=(await db.query(`SELECT e.claim_revision_id,e.extraction_intent_id,e.claim_key,e.task_id,s.model_intent_id FROM extracted_assertions e
  JOIN scoped_support_results s ON s.claim_revision_id=e.claim_revision_id AND s.extraction_intent_id=e.extraction_intent_id AND s.claim_key=e.claim_key
  WHERE e.claim_id=$1 AND e.account_id=$2 AND e.run_id=$3 AND s.account_id=$2 AND s.run_id=$3
  AND s.brief_revision=$4 AND s.evidence_revision=$5 ORDER BY s.model_intent_id LIMIT 1`,[args.claimId,args.accountId,args.parentRunId,parent.brief_revision,parent.evidence_revision])).rows[0];
 if(!row)throw new VerificationTargetError("verification_target_provenance_unavailable",409);
 const supportArgs={runId:parent.id,accountId:args.accountId,briefRevision:parent.brief_revision,taskId:row.task_id,extractionIntentId:row.extraction_intent_id};
 const basis=await loadSupportContext(db,supportArgs,versions);
 const checked=await persistScopedSupport(db,{...supportArgs,...basis,modelIntentId:row.model_intent_id},versions,true);
 if(!checked.some(c=>c.decision==="supported"&&c.claimId===args.claimId&&c.claimRevisionId===row.claim_revision_id))throw new VerificationTargetError("verification_target_provenance_unavailable",409);
 const sources=(await db.query(`SELECT DISTINCT s.id,s.canonical_locator AS locator,s.title,COALESCE(s.publisher,'') AS publisher,COALESCE(s.origin_cluster,'') AS "originCluster"
  FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id JOIN sources s ON s.id=v.source_id
  WHERE p.account_id=$1 AND p.run_id=$2 AND p.id=ANY($3::uuid[]) ORDER BY s.id`,[args.accountId,parent.id,basis.context.passages.map(p=>p.id)])).rows;
 return parseVerificationTarget({assertion:basis.context.assertions.find(a=>a.key===row.claim_key),task:basis.context.task,parentTaskId:row.task_id,
  extractionIntentId:row.extraction_intent_id,supportIntentId:row.model_intent_id,parentBriefRevision:parent.brief_revision,claimRevisionId:row.claim_revision_id,
  passages:basis.context.passages.map(p=>({id:p.id,digest:p.digest})),sources});
}
export async function loadVerification(db:Queryable,args:{runId:string;accountId:string;briefRevision:number}){
 const required=(await db.query("SELECT verification_required_revision FROM runs WHERE id=$1 AND account_id=$2",[args.runId,args.accountId])).rows[0];
 const row=(await db.query("SELECT * FROM requested_verifications WHERE run_id=$1 AND account_id=$2 AND brief_revision=$3",[args.runId,args.accountId,args.briefRevision])).rows[0];
 if(required?.verification_required_revision!==args.briefRevision||!row)throw new VerificationTargetError("required_verification_target_missing");
 const target=parseVerificationTarget(row.target);
 if(verificationDigest(target)!==row.target_digest)throw new VerificationTargetError("verification_target_digest_changed");
 const parsed=VerificationRowSchema.safeParse({...row,target});
 if(!parsed.success)throw new VerificationTargetError("verification_target_record_invalid");
 let original;
 try{original=await captureVerificationTarget(db,{accountId:args.accountId,parentRunId:row.parent_run_id,reportId:row.report_id,reportVersion:row.report_version,claimId:row.claim_id});}
 catch(error){if(error instanceof EvidenceSelectionProofError)throw new VerificationTargetError("verification_original_target_changed");throw error;}
 if(verificationDigest(original)!==row.target_digest)throw new VerificationTargetError("verification_original_target_changed");
 return parsed.data;
}
export async function admitRequestedVerification(pool:pg.Pool,config:AppConfig,accountId:string,parentRunId:string,raw:RequestedVerificationRequest){
 const request=RequestedVerificationRequestSchema.parse(raw),key=request.idempotencyKey;
 const digest=requestedVerificationDigest(parentRunId,request);
 return withTx(pool,async db=>{
  await lockActiveAccount(db,accountId);
  if((await db.query("SELECT 1 FROM admission_withdrawals WHERE account_id=$1 AND key_hash=$2",[accountId,admissionKeyHash(key)])).rowCount)reject("idempotency_withdrawn",409);
  const parent=await getRun(db,parentRunId,{forUpdate:true});
  if(!parent||parent.account_id!==accountId||parent.route_mode!=="controlled-research")reject("verification_parent_unavailable",404);
  if((await db.query("SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='run' AND object_id=$2 AND reason='source_deletion'",[accountId,parentRunId])).rowCount)reject("verification_parent_unavailable",409);
  const consent=await currentConsent(db,accountId);
  if(!consent||consent.revoked||consent.policyVersion!==CONSENT_POLICY_VERSION)reject("consent_required",403);
  const existing=await findRunByIdempotency(db,accountId,key);
  if(existing){if(existing.parent_run_id!==parentRunId||(await db.query("SELECT request_digest FROM runs WHERE id=$1",[existing.id])).rows[0]?.request_digest!==digest)reject("idempotency_conflict",409);const saved=await loadVerification(db,{runId:existing.id,accountId,briefRevision:existing.brief_revision});if(saved.request_digest!==digest)reject("idempotency_conflict",409);
   return {runId:existing.id,parentRunId,briefRevision:existing.brief_revision,reused:true,verificationId:saved.id as string,reopenedDiscovery:false as const,evidencePolicy:request.evidencePolicy};}
  if(!config.liveRouteEnabled||!config.structuredModelEnabled||!config.openRouterApiKey||config.openRouterModel!==STRUCTURED_MODEL_POLICY.model||config.liveSpendCapMicro<=0||(config.liveKeySpendCapMicro??0)<=0)reject("verification_route_unavailable",403);
  const target=await captureVerificationTarget(db,{accountId,parentRunId,reportId:request.reportId,reportVersion:request.reportVersion,claimId:request.claimId});
  if(request.evidencePolicy==="refresh_sources"&&target.sources.some(s=>!s.locator.startsWith("attachment://"))&&!config.liveRetrievalEnabled)reject("verification_source_refresh_unavailable",403);
  const old=await getBrief(db,parent.brief_id);
  const attachments=target.sources.filter(s=>s.locator.startsWith("attachment://")).map(s=>s.locator.slice(13));
  for(const id of attachments)if(!(await db.query("SELECT 1 FROM attachments WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL",[id,accountId])).rowCount)reject("attachment_unavailable",409);
  await db.query("SELECT id FROM conversations WHERE id=$1 AND account_id=$2 FOR UPDATE",[parent.conversation_id,accountId]);
  const revision=(await db.query("SELECT COALESCE(MAX(revision),0)::int+1 AS revision FROM research_briefs WHERE conversation_id=$1",[parent.conversation_id])).rows[0].revision as number;
  const brief={...old,id:crypto.randomUUID(),revision,attachmentIds:attachments},runId=crypto.randomUUID(),id=crypto.randomUUID();
  await insertBrief(db,brief,accountId);
  await insertRun(db,{id:runId,accountId,conversationId:parent.conversation_id,briefId:brief.id,parentRunId,routeMode:"controlled-research",briefRevision:revision,consentEpoch:consent.epoch,idempotencyKey:key,budgetMicro:DEFAULT_RUN_BUDGET_MICRO});
  await reserveAllowance(db,accountId,runId,DEFAULT_RUN_BUDGET_MICRO);
  if(request.evidencePolicy==="reuse_snapshot")await inheritRunEvidence(db,{runId,parentRunId,accountId});
  await db.query("UPDATE runs SET verification_required_revision=$2,request_digest=$3 WHERE id=$1",[runId,revision,digest]);
  await db.query(`INSERT INTO requested_verifications(id,account_id,run_id,parent_run_id,report_id,report_version,claim_id,claim_revision_id,brief_revision,request_digest,target,target_digest,evidence_policy,private_note)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[id,accountId,runId,parentRunId,request.reportId,request.reportVersion,request.claimId,target.claimRevisionId,revision,digest,JSON.stringify(target),verificationDigest(target),request.evidencePolicy,request.note]);
  await emitEvent(db,{runId,accountId,type:"verification_requested",phase:"preparing",summary:"The selected claim will be checked against its selected sources. No candidate discovery is scheduled.",payload:{verificationId:id,evidencePolicy:request.evidencePolicy,reopenedDiscovery:false}});
  return {runId,parentRunId,briefRevision:revision,reused:false,verificationId:id,reopenedDiscovery:false as const,evidencePolicy:request.evidencePolicy};
 });
}

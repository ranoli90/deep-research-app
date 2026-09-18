import {runModelVersions} from "./run-model-policy.js";
import { z } from "zod";
import { ResearchModelOutputs,type CanonicalReport } from "@deep/contracts";
import { resolveScopedSupport,requestedVerificationOutcome,UNRESOLVED_SECTION,type StoredClaim } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { getRun,getBrief } from "./runs.js";
import { loadVerification,verificationDigest } from "./requested-verification.js";
import { MODEL_CONTEXT_MAX_PASSAGES,ModelContextSchema,ModelReceiptSchema } from "../ports/model.js";
import { modelInputManifest,loadModelOperation,validateOwnedModelContext } from "./model-operations.js";
import { MODEL_PROMPT_VERSION } from "../ports/model-policy.js";
import { RESEARCH_MODEL_SCHEMA_VERSION } from "@deep/contracts";

export async function verificationContext(db:Queryable,args:{runId:string;accountId:string;briefRevision:number}){
 const saved=await loadVerification(db,args),run=(await getRun(db,args.runId))!,brief=await getBrief(db,run.brief_id);
 const ids=saved.target.passages.map(p=>p.id);
 let refreshedSourceIds:string[]=[];
 if(saved.evidence_policy==="refresh_sources"){
  const mapped=z.array(z.object({originSourceId:z.string().uuid(),sourceId:z.string().uuid()}).strict()).parse(saved.source_map);
  const web=saved.target.sources.filter(s=>!s.locator.startsWith("attachment://"));
  if(mapped.length!==web.length||new Set(mapped.map(s=>s.originSourceId)).size!==web.length)throw new Error("verification_refresh_basis_missing");
  for(const source of saved.target.sources){
   const match=mapped.find(s=>s.originSourceId===source.id);
   const selected=(await db.query(`SELECT s.id,v.access_level FROM sources s JOIN source_versions v ON v.source_id=s.id
    JOIN extraction_receipts e ON e.source_version_id=v.id AND e.run_id=$2 AND e.account_id=$3
    WHERE s.run_id=$2 AND s.account_id=$3 AND s.canonical_locator=$1 AND ($4::uuid IS NULL OR s.id=$4)
    AND ($5::boolean OR EXISTS(SELECT 1 FROM source_read_operations op WHERE op.run_id=$2 AND op.account_id=$3
      AND op.source_id=s.id AND op.source_version_id=v.id AND op.state='finished'))`,
    [source.locator,args.runId,args.accountId,match?.sourceId??null,source.locator.startsWith("attachment://")])).rows;
   if(selected.length!==1||!["partial-text","full-text"].includes(selected[0].access_level))throw new Error("verification_evidence_unavailable");
   refreshedSourceIds.push(selected[0].id);
  }
 }

 const rows=(await db.query(`SELECT p.id,p.source_version_id AS version,p.content_hash AS digest,p.exact_text AS text,
  v.access_level AS access,s.id AS source,s.title FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id
  JOIN sources s ON s.id=v.source_id WHERE p.run_id=$1 AND p.account_id=$2 AND v.account_id=$2 AND s.account_id=$2
  AND (($3='reuse_snapshot' AND p.id=ANY($4::uuid[])) OR ($3='refresh_sources' AND s.id=ANY($5::uuid[]))) ORDER BY p.id`,[args.runId,args.accountId,saved.evidence_policy,ids,refreshedSourceIds])).rows;
 if(!rows.length||rows.length>MODEL_CONTEXT_MAX_PASSAGES||(saved.evidence_policy==="reuse_snapshot"&&(rows.length!==ids.length||rows.some(p=>saved.target.passages.find(x=>x.id===p.id)?.digest!==p.digest))))throw new Error("verification_evidence_unavailable");
 const context=ModelContextSchema.parse({question:brief.originalQuestion,task:saved.target.task,
  passages:rows.map(p=>({id:p.id,sourceVersionId:p.version,digest:p.digest,text:p.text,accessLevel:p.access})),
  sources:[...new Map(rows.map(p=>[p.source,{handle:p.source,title:p.title}])).values()],assertions:[saved.target.assertion],approvedClaimKeys:[],draft:null});
 await validateOwnedModelContext(db,{...args,evidenceRevision:run.evidence_revision,context});
 return {saved,context,evidenceRevision:run.evidence_revision};
}
export async function restoreVerificationCheck(db:Queryable,args:{runId:string;accountId:string;briefRevision:number},intentId?:string){
 const basis=await verificationContext(db,args),id=intentId??basis.saved.model_intent_id;
 if(!id)throw new Error("required_verification_result_missing");
 const execution=(await db.query(`SELECT request_digest FROM model_operation_results WHERE intent_id=$1 AND run_id=$2 AND account_id=$3
  AND operation='assess_support' AND brief_revision=$4 AND evidence_revision=$5 AND schema_version=$6 AND prompt_version=$7 AND policy_id=$8`,
  [id,args.runId,args.accountId,args.briefRevision,basis.evidenceRevision,RESEARCH_MODEL_SCHEMA_VERSION,MODEL_PROMPT_VERSION,(await runModelVersions(db,args.runId)).policyId])).rows[0];
 if(!execution)throw new Error("required_verification_result_missing");
 const result=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs.assess_support,receipt:ModelReceiptSchema}).strict().parse(
  await loadModelOperation(db,id,args.runId,args.accountId,execution.request_digest,basis.context));
 if(result.receipt.actualMicro===null)throw new Error("verification_cost_unknown");
 const check=resolveScopedSupport({assertions:basis.context.assertions,passages:basis.context.passages,proposal:result.output})[0]!;
 const outcome=requestedVerificationOutcome(check),value={version:"requested-verification-result.v1",outcome,check};
 if(!intentId&&(basis.saved.state!=="checked"||basis.saved.evidence_revision!==basis.evidenceRevision||verificationDigest(basis.saved.context_manifest)!==verificationDigest(modelInputManifest(basis.context))||verificationDigest(basis.saved.result)!==verificationDigest(value)))throw new Error("required_verification_result_changed");
 return {...basis,intentId:id as string,value};
}
export async function verificationReportContent(db:Queryable,args:{runId:string;accountId:string;briefRevision:number}){
 const restored=await restoreVerificationCheck(db,args),{saved,value}=restored;
 const supported=value.outcome==="supported_in_inspected_evidence";
 const passageIds=[...new Set(value.check.evidence.map(e=>e.passageId))].sort();
 const claims:StoredClaim[]=supported?[{id:saved.output_claim_id as string,text:saved.target.assertion.text,type:"external-fact",supportStatus:"direct",passageIds}]:[];
 if(supported&&!saved.output_claim_id)throw new Error("verification_output_claim_missing");
 const labels={supported_in_inspected_evidence:"Supported within the inspected evidence and stated scope.",contradicted_in_inspected_evidence:"The inspected evidence contradicts the selected claim.",qualification_needed:"The selected claim needs qualification within the inspected evidence.",unresolved:"The inspected evidence did not resolve the selected claim."};
 const limitations=[`Selected claim (quoted for review): ${saved.target.assertion.text}`,labels[value.outcome],
  saved.evidence_policy==="reuse_snapshot"?"This check reassessed the saved source versions; it did not check for newer sources.":"This check reread the selected known sources; it did not discover additional sources.",
  "Scoped model assessment and deterministic evidence checks are fallible; this is not independent human adjudication."];
 const inspectedPassageIds=[...new Set([...passageIds,...value.check.counterEvidence.map(e=>e.passageId)])].sort();
 const blocks=[{id:"answer",kind:supported?"text" as const:"caveat" as const,text:supported?saved.target.assertion.text:UNRESOLVED_SECTION,
  claimIds:claims.map(c=>c.id),citationIds:supported?passageIds:inspectedPassageIds}];
 return {...restored,claims,blocks,limitations,outcome:"completed_with_limitations" as const};
}
export async function verificationPublicationClaims(db:Queryable,args:{runId:string;accountId:string;briefRevision:number;claims:StoredClaim[]}){
 const managed=(await db.query("SELECT verification_required_revision,EXISTS(SELECT 1 FROM requested_verifications WHERE run_id=r.id AND account_id=r.account_id) AS has_request FROM runs r WHERE id=$1 AND account_id=$2",[args.runId,args.accountId])).rows[0];
 const approved=new Map<string,{claimId:string;text:string;passageIds:string[]}>(),rejected=new Set<string>();
 if(!managed||managed.verification_required_revision===null&&!managed.has_request)return {approved,rejected};
 const content=await verificationReportContent(db,args);
 for(const supplied of args.claims){const expected=content.claims.find(c=>c.id===supplied.id);
  if(!expected||supplied.text!==expected.text||supplied.derivation||verificationDigest([...new Set(supplied.passageIds)].sort())!==verificationDigest(expected.passageIds))rejected.add(supplied.id);
  else approved.set(supplied.id,{claimId:expected.id,text:expected.text,passageIds:expected.passageIds});}
 return {approved,rejected};
}
export async function verificationReportMatches(db:Queryable,accountId:string,report:CanonicalReport):Promise<boolean|null>{
 const marker=(await db.query("SELECT verification_required_revision,EXISTS(SELECT 1 FROM requested_verifications WHERE run_id=r.id AND account_id=r.account_id) AS has_request FROM runs r WHERE id=$1 AND account_id=$2",[report.runId,accountId])).rows[0];
 if(!marker||marker.verification_required_revision===null&&!marker.has_request)return null;
 if(marker.verification_required_revision!==report.basis.briefRevision)return false;
 const content=await verificationReportContent(db,{runId:report.runId,accountId,briefRevision:report.basis.briefRevision});
 return report.basis.evidenceRevision===content.evidenceRevision&&report.outcome===content.outcome&&verificationDigest(report.blocks)===verificationDigest(content.blocks)&&
  verificationDigest(report.claimIds)===verificationDigest(content.claims.map(c=>c.id))&&verificationDigest(report.limitations)===verificationDigest(content.limitations);
}

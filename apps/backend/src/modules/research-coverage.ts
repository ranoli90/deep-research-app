import { z } from "zod";
import { RESEARCH_MODEL_SCHEMA_VERSION,ResearchModelOutputs } from "@deep/contracts";
import { RESEARCH_COVERAGE_VERSION,SCOPED_SUPPORT_VERSION,resolveResearchCoverage } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { ModelReceiptSchema } from "../ports/model.js";
import { loadModelOperation } from "./model-operations.js";
import { loadSupportContext,persistScopedSupport,type SupportArgs } from "./scoped-support.js";
import type { TaskModelVersions } from "./research-tasks.js";
export type CoverageArgs=SupportArgs&{supportIntentId:string};

export async function loadCoverageContext(db:Queryable,args:CoverageArgs,versions:TaskModelVersions) {
  const basis=await loadSupportContext(db,args,versions);
  const checks=await persistScopedSupport(db,{...args,...basis,modelIntentId:args.supportIntentId},versions,true);
  return {...basis,context:{...basis.context,approvedClaimKeys:checks.filter((c)=>c.decision==="supported").map((c)=>c.claimKey)},checks};
}

/** Fenced transaction; saved review and support are restored before deterministic closure. */
export async function persistResearchCoverage(db:Queryable,args:CoverageArgs&{modelIntentId:string},versions:TaskModelVersions,requireStored=false) {
  const basis=await loadCoverageContext(db,args,versions);
  const row=(await db.query(`SELECT request_digest FROM model_operation_results WHERE intent_id=$1 AND run_id=$2 AND account_id=$3
    AND operation='review_coverage' AND brief_revision=$4 AND evidence_revision=$5 AND schema_version=$6 AND prompt_version=$7 AND policy_id=$8`,
    [args.modelIntentId,args.runId,args.accountId,args.briefRevision,basis.evidenceRevision,RESEARCH_MODEL_SCHEMA_VERSION,versions.promptVersion,versions.policyId])).rows[0];
  if(!row)throw new Error("coverage_owner_or_basis_mismatch");
  const raw=await loadModelOperation(db,args.modelIntentId,args.runId,args.accountId,row.request_digest,basis.context);
  const parsed=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs.review_coverage,receipt:ModelReceiptSchema}).strict().safeParse(raw);
  if(!parsed.success||!basis.context.task)throw new Error("invalid_coverage_execution");
  const result=resolveResearchCoverage({...basis.context,task:basis.context.task,checks:basis.checks,proposal:parsed.data.output});
  const values=[args.modelIntentId,RESEARCH_COVERAGE_VERSION,args.extractionIntentId,args.supportIntentId,args.accountId,args.runId,args.taskId,args.briefRevision,basis.evidenceRevision,SCOPED_SUPPORT_VERSION,basis.checks.map((c)=>c.claimRevisionId),JSON.stringify(result)];
  if(!requireStored)await db.query(`INSERT INTO research_coverage(model_intent_id,checker_version,extraction_intent_id,support_intent_id,account_id,run_id,task_id,brief_revision,evidence_revision,support_checker_version,claim_revision_ids,result)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,values);
  const exact=await db.query(`SELECT model_intent_id FROM research_coverage WHERE model_intent_id=$1 AND checker_version=$2 AND extraction_intent_id=$3
    AND support_intent_id=$4 AND account_id=$5 AND run_id=$6 AND task_id=$7 AND brief_revision=$8 AND evidence_revision=$9
    AND support_checker_version=$10 AND claim_revision_ids=$11::uuid[] AND result=$12::jsonb`,values);
  if(exact.rowCount!==1)throw new Error("stored_coverage_mismatch");
  return result;
}

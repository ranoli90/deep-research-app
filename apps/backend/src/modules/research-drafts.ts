import { CALCULATED_REPORT_PROMPT_VERSION } from "../ports/model-policy.js";
import { CALCULATED_REPORT_SCHEMA_VERSION, RESEARCH_MODEL_SCHEMA_VERSION } from "@deep/contracts";
import type { Queryable } from "../platform/db.js";
import { loadWriterSourceContext,restoreWriterDraft,type SupportArgs } from "./scoped-support.js";
import type { TaskModelVersions } from "./research-tasks.js";

/** Fenced, immutable lineage; the saved writer result is reloaded rather than supplied by the caller. */
export async function recordResearchDraft(db:Queryable,args:SupportArgs & {sourceSupportIntentId:string;writerIntentId:string;calculationPlanIntentId?:string},versions:TaskModelVersions) {
  const basis=await loadWriterSourceContext(db,args,versions);
  const writer=(await db.query(`SELECT intent_id FROM model_operation_results WHERE intent_id=$1 AND operation=$9
    AND run_id=$2 AND account_id=$3 AND brief_revision=$4 AND evidence_revision=$5 AND schema_version=$6 AND prompt_version=$7 AND policy_id=$8`,
    [args.writerIntentId,args.runId,args.accountId,args.briefRevision,basis.evidenceRevision,args.calculationPlanIntentId?CALCULATED_REPORT_SCHEMA_VERSION:RESEARCH_MODEL_SCHEMA_VERSION,args.calculationPlanIntentId?CALCULATED_REPORT_PROMPT_VERSION:versions.promptVersion,versions.policyId,args.calculationPlanIntentId?"write_calculated_report":"write_report"])).rows[0];
  if(!writer)throw new Error("writer_result_owner_or_basis_mismatch");
  await db.query(`INSERT INTO research_drafts(writer_intent_id,source_extraction_intent_id,source_support_intent_id,account_id,run_id,task_id,brief_revision,evidence_revision,calculation_plan_intent_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(writer_intent_id) DO NOTHING`,
    [args.writerIntentId,args.extractionIntentId,args.sourceSupportIntentId,args.accountId,args.runId,args.taskId,args.briefRevision,basis.evidenceRevision,args.calculationPlanIntentId??null]);
  const exact=await db.query(`SELECT writer_intent_id FROM research_drafts WHERE writer_intent_id=$1 AND source_extraction_intent_id=$2
    AND source_support_intent_id=$3 AND account_id=$4 AND run_id=$5 AND task_id=$6 AND brief_revision=$7 AND evidence_revision=$8 AND calculation_plan_intent_id IS NOT DISTINCT FROM $9::uuid`,
    [args.writerIntentId,args.extractionIntentId,args.sourceSupportIntentId,args.accountId,args.runId,args.taskId,args.briefRevision,basis.evidenceRevision,args.calculationPlanIntentId??null]);
  if(exact.rowCount!==1)throw new Error("writer_lineage_mismatch");
  return restoreWriterDraft(db,{...args,extractionIntentId:args.writerIntentId},versions);
}

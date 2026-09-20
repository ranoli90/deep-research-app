import { draftComposition, parseDraftComposition, type ResearchDraftComposition } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { loadWriterSourceContext,restoreWriterDraft,type SupportArgs } from "./scoped-support.js";
import type { TaskModelVersions } from "./research-tasks.js";

function compositionPrefix(shorter: ResearchDraftComposition, longer: ResearchDraftComposition): boolean {
  if (shorter.planVersion !== longer.planVersion || shorter.planDigest !== longer.planDigest) return false;
  if (shorter.sections.length > longer.sections.length) return false;
  return shorter.sections.every((section, index) => JSON.stringify(section) === JSON.stringify(longer.sections[index]));
}

function compositionProgress(stored: ResearchDraftComposition | null, next: ResearchDraftComposition): "insert" | "extend" | "keep" {
  if (!stored) return "insert";
  if (JSON.stringify(stored) === JSON.stringify(next)) return "keep";
  if (compositionPrefix(stored, next)) return "extend";
  if (compositionPrefix(next, stored)) return "keep";
  throw new Error("writer_composition_mismatch");
}

async function ownedWriterResult(db:Queryable,args:SupportArgs & {sourceSupportIntentId:string;writerIntentId:string;calculationPlanIntentId?:string},versions:TaskModelVersions) {
  const basis=await loadWriterSourceContext(db,args,versions);
  const operation=args.calculationPlanIntentId?"write_calculated_report":"write_report";
  const writer=(await db.query(`SELECT intent_id FROM model_operation_results WHERE intent_id=$1 AND operation=$5
    AND run_id=$2 AND account_id=$3 AND brief_revision=$4 AND evidence_revision=$6`,
    [args.writerIntentId,args.runId,args.accountId,args.briefRevision,operation,basis.evidenceRevision])).rows[0];
  if(!writer)throw new Error("writer_result_owner_or_basis_mismatch");
  return basis;
}

/** Persist completed section records after each section boundary so restore does not wait for the last call. */
export async function persistResearchDraftComposition(db:Queryable,args:SupportArgs & {sourceSupportIntentId:string;writerIntentId:string;calculationPlanIntentId?:string;composition:ResearchDraftComposition},versions:TaskModelVersions) {
  const basis=await ownedWriterResult(db,args,versions);
  const composition=draftComposition(args.composition);
  if(!composition.sections.some((section)=>section.intentId===args.writerIntentId)) throw new Error("writer_composition_mismatch");
  const lineage=[args.writerIntentId,args.extractionIntentId,args.sourceSupportIntentId,args.accountId,args.runId,args.taskId,args.briefRevision,basis.evidenceRevision,args.calculationPlanIntentId??null] as const;
  await db.query(`INSERT INTO research_drafts(writer_intent_id,source_extraction_intent_id,source_support_intent_id,account_id,run_id,task_id,brief_revision,evidence_revision,calculation_plan_intent_id,composition)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(writer_intent_id) DO NOTHING`,
    [...lineage,JSON.stringify(composition)]);
  const existing=await db.query(`SELECT writer_intent_id,source_extraction_intent_id,source_support_intent_id,account_id,run_id,task_id,brief_revision,evidence_revision,calculation_plan_intent_id,composition
    FROM research_drafts WHERE writer_intent_id=$1 FOR UPDATE`,[args.writerIntentId]);
  if(existing.rowCount!==1)throw new Error("writer_lineage_unavailable");
  const row=existing.rows[0]!;
  if(row.source_extraction_intent_id!==args.extractionIntentId || row.source_support_intent_id!==args.sourceSupportIntentId
    || row.account_id!==args.accountId || row.run_id!==args.runId || row.task_id!==args.taskId
    || Number(row.brief_revision)!==args.briefRevision || Number(row.evidence_revision)!==basis.evidenceRevision
    || (row.calculation_plan_intent_id??null)!==(args.calculationPlanIntentId??null)) throw new Error("writer_lineage_mismatch");
  const stored=row.composition==null?null:parseDraftComposition(row.composition);
  const progress=compositionProgress(stored,composition);
  if(progress==="keep") return;
  await db.query(`UPDATE research_drafts SET composition=$2::jsonb WHERE writer_intent_id=$1`,
    [args.writerIntentId,JSON.stringify(composition)]);
}

/** Fenced, immutable lineage; the saved writer result is reloaded rather than supplied by the caller. */
export async function recordResearchDraft(db:Queryable,args:SupportArgs & {sourceSupportIntentId:string;writerIntentId:string;calculationPlanIntentId?:string;composition?:ResearchDraftComposition},versions:TaskModelVersions) {
  const basis=await ownedWriterResult(db,args,versions);
  const composition=args.composition?draftComposition(args.composition):null;
  if(composition && !composition.sections.some((section)=>section.intentId===args.writerIntentId)) throw new Error("writer_composition_mismatch");
  if(composition) await persistResearchDraftComposition(db,{...args,composition},versions);
  else {
    await db.query(`INSERT INTO research_drafts(writer_intent_id,source_extraction_intent_id,source_support_intent_id,account_id,run_id,task_id,brief_revision,evidence_revision,calculation_plan_intent_id,composition)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(writer_intent_id) DO NOTHING`,
      [args.writerIntentId,args.extractionIntentId,args.sourceSupportIntentId,args.accountId,args.runId,args.taskId,args.briefRevision,basis.evidenceRevision,args.calculationPlanIntentId??null,null]);
  }
  const exact=await db.query(`SELECT writer_intent_id,composition FROM research_drafts WHERE writer_intent_id=$1 AND source_extraction_intent_id=$2
    AND source_support_intent_id=$3 AND account_id=$4 AND run_id=$5 AND task_id=$6 AND brief_revision=$7 AND evidence_revision=$8 AND calculation_plan_intent_id IS NOT DISTINCT FROM $9::uuid FOR UPDATE`,
    [args.writerIntentId,args.extractionIntentId,args.sourceSupportIntentId,args.accountId,args.runId,args.taskId,args.briefRevision,basis.evidenceRevision,args.calculationPlanIntentId??null]);
  if(exact.rowCount!==1)throw new Error("writer_lineage_mismatch");
  const stored=exact.rows[0]?.composition==null?null:parseDraftComposition(exact.rows[0].composition);
  if(composition) {
    const progress=compositionProgress(stored,composition);
    if(progress!=="keep") throw new Error("writer_composition_mismatch");
  } else if(stored!==null) throw new Error("writer_composition_mismatch");
  return restoreWriterDraft(db,{...args,extractionIntentId:args.writerIntentId},versions);
}

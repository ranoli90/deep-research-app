import { applySelectionInventorySupport } from "./selection-inventory-support.js";
import { EvidenceSelectionContextSchema } from "../ports/evidence-selection.js";
import { calculationWriterContext } from "./calculation-plans.js";
import { CALCULATED_REPORT_PROMPT_VERSION, modelPolicy } from "../ports/model-policy.js";
import { persistScopeComparison } from "./scope-comparisons.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { CALCULATED_REPORT_SCHEMA_VERSION, RESEARCH_MODEL_SCHEMA_VERSION, ResearchModelOutputs } from "@deep/contracts";
import { canonicalSectionContexts, parseDraftComposition, projectScopeComparison, draftStatements, planHierarchicalWrite, resolveScopedSupport, SCOPED_SUPPORT_VERSION, stitchSectionDrafts, validateModelBindings, type ScopedSupportResult } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { MODEL_CONTEXT_MAX_PASSAGES, ModelReceiptSchema, type ModelContext } from "../ports/model.js";
import { loadModelOperation, modelInputManifest, validateOwnedModelContext } from "./model-operations.js";
import { loadAssertionEvidence } from "./assertion-evidence.js";
import { loadResearchTask, type TaskModelVersions } from "./research-tasks.js";

export type CheckedAssertion=ScopedSupportResult & {claimId:string;claimRevisionId:string};
export type SupportContext={context:ModelContext;evidenceRevision:number;premiseRevisionIds?:Record<string,string[]>;claimType?:"inference"};
export type SupportArgs={runId:string;accountId:string;briefRevision:number;taskId:string;extractionIntentId:string};
const Manifest = z.object({version:z.enum(["model-input.v1","model-input.v2","model-input.v3","model-input.v4","model-input.v5","model-input.v6","model-input.v7","model-input.v8"]),evidenceSelection:EvidenceSelectionContextSchema.optional(),passages:z.array(z.object({id:z.string().uuid()})).min(1).max(MODEL_CONTEXT_MAX_PASSAGES)});
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textDigest=(value:string)=>createHash("sha256").update(value).digest("hex");
/** Accepted failover keeps its own policy id; restore must not require the run's primary policy. */
function recordedPolicyId(policyId:unknown):string { return modelPolicy(policyId).id; }

/** Restore only the exact owned extraction basis, not client-supplied assertions. */
export async function loadSupportContext(db:Queryable,args:SupportArgs,versions:TaskModelVersions):Promise<SupportContext> {
  const row=(await db.query(`SELECT * FROM model_operation_results WHERE intent_id=$1 AND run_id=$2 AND account_id=$3
    AND operation IN ('extract_assertions','write_report','write_calculated_report') AND brief_revision=$4 AND ((schema_version=$5 AND prompt_version=$6 AND operation!='write_calculated_report') OR (schema_version=$7 AND prompt_version=$8 AND operation='write_calculated_report'))`,
    [args.extractionIntentId,args.runId,args.accountId,args.briefRevision,RESEARCH_MODEL_SCHEMA_VERSION,versions.promptVersion,CALCULATED_REPORT_SCHEMA_VERSION,CALCULATED_REPORT_PROMPT_VERSION])).rows[0];
  if (!row) throw new Error("support_extraction_owner_or_version_mismatch");
  recordedPolicyId(row.policy_id);
  if(row.operation==="write_report"||row.operation==="write_calculated_report") return loadWriterAssertionContext(db,args,versions);
  const manifest=Manifest.safeParse(row.input_manifest);
  if (!manifest.success) throw new Error("support_extraction_manifest_unavailable");
  const basis=await loadAssertionEvidence(db,{...args,passageIds:manifest.data.passages.map((p)=>p.id),selectionId:manifest.data.evidenceSelection?.id},versions);
  if (basis.kind==="blocked") throw new Error(basis.blocked);
  // Newer unread sources must not invalidate an already-checked extract; a lower run revision is corrupt.
  if (basis.evidenceRevision<row.evidence_revision) throw new Error("support_extraction_basis_changed");
  const saved=await loadModelOperation(db,args.extractionIntentId,args.runId,args.accountId,row.request_digest,basis.context);
  const parsed=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs.extract_assertions,receipt:ModelReceiptSchema}).strict().safeParse(saved);
  if (!parsed.success || validateModelBindings("extract_assertions",parsed.data.output,basis.context).length) throw new Error("invalid_extraction_for_support");
  if (!parsed.data.output.assertions.length) throw new Error("no_assertions_to_check");
  const context={...basis.context,assertions:parsed.data.output.assertions};
  await validateOwnedModelContext(db,{...args,evidenceRevision:row.evidence_revision,context,historical:true});
  return {context,evidenceRevision:row.evidence_revision};
}

/** Fenced transaction. A model verdict is recorded alongside independently executed checks. */
export async function persistScopedSupport(db:Queryable,args:SupportArgs & {modelIntentId:string;evidenceRevision:number;context:ModelContext},versions:TaskModelVersions,requireStored=false):Promise<CheckedAssertion[]> {
  const basis=await loadSupportContext(db,args,versions);
  if (basis.evidenceRevision!==args.evidenceRevision || digest(basis.context)!==digest(args.context)) throw new Error("stale_support_context");
  const task=await loadResearchTask(db,args.runId,args.accountId,args.briefRevision,versions);
  if (!task || task.id!==args.taskId) throw new Error("support_task_mismatch");
  const model=(await db.query(`SELECT request_digest, policy_id FROM model_operation_results WHERE intent_id=$1 AND run_id=$2 AND account_id=$3
    AND operation='assess_support' AND brief_revision=$4 AND evidence_revision=$5 AND schema_version=$6 AND prompt_version=$7`,
    [args.modelIntentId,args.runId,args.accountId,args.briefRevision,args.evidenceRevision,RESEARCH_MODEL_SCHEMA_VERSION,versions.promptVersion])).rows[0];
  if (!model) throw new Error("missing_support_execution");
  const raw=await loadModelOperation(db,args.modelIntentId,args.runId,args.accountId,model.request_digest,basis.context,{
    operation:"assess_support",schemaVersion:RESEARCH_MODEL_SCHEMA_VERSION,promptVersion:versions.promptVersion,policyId:recordedPolicyId(model.policy_id)});
  const parsed=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs.assess_support,receipt:ModelReceiptSchema}).strict().safeParse(raw);
  if (!parsed.success) throw new Error("invalid_support_execution");
  const outcomes=resolveScopedSupport({assertions:basis.context.assertions,passages:basis.context.passages,proposal:parsed.data.output});
  const evidenceDigest=digest(modelInputManifest(basis.context).passages);
  const saved:CheckedAssertion[]=[];
  for (const outcome of outcomes) {
    const claim=basis.context.assertions.find((c)=>c.key===outcome.claimKey)!;
    const scope={...(basis.premiseRevisionIds?{premiseClaimRevisionIds:basis.premiseRevisionIds[claim.key],dependencyCompleteness:"partial"}:{}),taskId:task.id,semanticScope:claim.scope,quantities:claim.quantities,
      criterionIds:claim.criterionKeys.map((key)=>task.criterionIds[key]),
      evidence:claim.evidence.map((e)=>({...e,sourceVersionId:basis.context.passages.find((p)=>p.id===e.passageId)!.sourceVersionId,
        digest:basis.context.passages.find((p)=>p.id===e.passageId)!.digest}))};
    const scopeDigest=digest(scope);
    const existing=(await db.query(`SELECT e.claim_id,e.claim_revision_id,
      (e.account_id=$3 AND e.run_id=$4 AND e.task_id=$5 AND c.account_id=$3 AND c.run_id=$4 AND c.text=$6
       AND r.account_id=$3 AND r.run_id=$4 AND r.claim_id=c.id AND r.text=$6 AND r.text_digest=$7 AND r.scope=$8::jsonb) AS valid
      FROM extracted_assertions e JOIN claims c ON c.id=e.claim_id JOIN claim_revisions r ON r.id=e.claim_revision_id
      WHERE e.extraction_intent_id=$1 AND e.claim_key=$2`,
      [args.extractionIntentId,claim.key,args.accountId,args.runId,task.id,claim.text,textDigest(claim.text),JSON.stringify(scope)])).rows[0];
    if (requireStored && !existing) throw new Error("missing_stored_assertion_revision");
    if (existing && !existing.valid) throw new Error("stored_assertion_revision_mismatch");
    const claimId=existing?.claim_id??crypto.randomUUID(), revisionId=existing?.claim_revision_id??crypto.randomUUID();
    if (!existing) {
      await db.query("INSERT INTO claims(id,run_id,account_id,text,type,support_status) VALUES($1,$2,$3,$4,$5,'unverified')",[claimId,args.runId,args.accountId,claim.text,basis.claimType??"external-fact"]);
      await db.query("INSERT INTO claim_revisions(id,claim_id,account_id,run_id,revision,text,text_digest,scope) VALUES($1,$2,$3,$4,1,$5,$6,$7)",[revisionId,claimId,args.accountId,args.runId,claim.text,textDigest(claim.text),JSON.stringify(scope)]);
      await db.query("INSERT INTO extracted_assertions(extraction_intent_id,claim_key,account_id,run_id,task_id,claim_id,claim_revision_id) VALUES($1,$2,$3,$4,$5,$6,$7)",[args.extractionIntentId,claim.key,args.accountId,args.runId,task.id,claimId,revisionId]);
    }
    const prior=(await db.query(`SELECT (extraction_intent_id=$3 AND claim_revision_id=$4 AND account_id=$5 AND run_id=$6 AND task_id=$7
      AND brief_revision=$8 AND evidence_revision=$9 AND evidence_digest=$10 AND scope_digest=$11 AND checker_version=$12
      AND decision=$13 AND result=$14::jsonb) AS valid FROM scoped_support_results WHERE model_intent_id=$1 AND claim_key=$2 AND checker_version=$12`,
      [args.modelIntentId,claim.key,args.extractionIntentId,revisionId,args.accountId,args.runId,task.id,args.briefRevision,args.evidenceRevision,evidenceDigest,scopeDigest,SCOPED_SUPPORT_VERSION,outcome.decision,JSON.stringify(outcome)])).rows[0];
    if (requireStored && !prior) throw new Error("missing_stored_support_result");
    if (prior && !prior.valid) throw new Error("stored_support_result_mismatch");
    if (!prior) await db.query(`INSERT INTO scoped_support_results(model_intent_id,extraction_intent_id,claim_key,claim_revision_id,account_id,run_id,task_id,brief_revision,evidence_revision,evidence_digest,scope_digest,checker_version,decision,result)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [args.modelIntentId,args.extractionIntentId,claim.key,revisionId,args.accountId,args.runId,task.id,args.briefRevision,args.evidenceRevision,evidenceDigest,scopeDigest,SCOPED_SUPPORT_VERSION,outcome.decision,JSON.stringify(outcome)]);
    saved.push({claimId,claimRevisionId:revisionId,...outcome});
  }
  return applySelectionInventorySupport(db,{...args,context:basis.context,checked:saved},requireStored);
}


/** A writer may only start from independently revalidated source assertions, never another draft. */
export async function loadWriterSourceContext(db:Queryable,args:SupportArgs & {sourceSupportIntentId:string;calculationPlanIntentId?:string;prepareCalculations?:boolean},versions:TaskModelVersions):Promise<SupportContext & {approved:CheckedAssertion[]}> {
  const source=await db.query("SELECT intent_id FROM model_operation_results WHERE intent_id=$1 AND operation='extract_assertions' AND run_id=$2 AND account_id=$3",[args.extractionIntentId,args.runId,args.accountId]);
  if(source.rowCount!==1)throw new Error("writer_source_must_be_extraction");
  const basis=await loadSupportContext(db,args,versions);
  const checks=await persistScopedSupport(db,{...args,...basis,modelIntentId:args.sourceSupportIntentId},versions,true);
  const approved=checks.filter((c)=>c.decision==="supported");
  if(!approved.length)throw new Error("writer_has_no_supported_premises");
  const savedComparison=await db.query("SELECT id FROM scope_comparisons WHERE run_id=$1 AND account_id=$2 AND extraction_intent_id=$3 AND support_intent_id=$4",[args.runId,args.accountId,args.extractionIntentId,args.sourceSupportIntentId]);
  let scopeComparison;
  if(savedComparison.rowCount) {
    const compared=await persistScopeComparison(db,{...args,supportIntentId:args.sourceSupportIntentId,
      action:{type:"compare_scopes",claimKeys:basis.context.assertions.map(a=>a.key)}},versions,true);
    if(compared.kind!=="comparison")throw new Error(compared.reason);
    scopeComparison=compared.writerContextVersion==="scope-comparison-context.v1"?projectScopeComparison(compared.result,basis.context.assertions):compared.result;
  }
  if(args.calculationPlanIntentId) {
    const binding=await db.query("SELECT 1 FROM calculation_plans WHERE model_intent_id=$1 AND account_id=$2 AND run_id=$3 AND task_id=$4 AND extraction_intent_id=$5 AND support_intent_id=$6",[args.calculationPlanIntentId,args.accountId,args.runId,args.taskId,args.extractionIntentId,args.sourceSupportIntentId]);
    if(binding.rowCount!==1)throw new Error("writer_calculation_plan_binding_mismatch");
  }
  const calculations=args.calculationPlanIntentId?await calculationWriterContext(db,{...args,planIntentId:args.calculationPlanIntentId},args.prepareCalculations):undefined;
  return {...basis,context:{...basis.context,approvedClaimKeys:approved.map((c)=>c.claimKey),...(scopeComparison?{scopeComparison}:{}),...(calculations?{calculations}:{})},approved};
}

/** Durable one-level lineage prevents a draft from citing itself or expanding authority. */
export async function restoreWriterDraft(db:Queryable,args:SupportArgs,versions:TaskModelVersions) {
  const row=(await db.query(`SELECT * FROM research_drafts WHERE writer_intent_id=$1 AND run_id=$2 AND account_id=$3 AND task_id=$4 AND brief_revision=$5`,
    [args.extractionIntentId,args.runId,args.accountId,args.taskId,args.briefRevision])).rows[0];
  if(!row)throw new Error("writer_lineage_unavailable");
  const basis=await loadWriterSourceContext(db,{...args,extractionIntentId:row.source_extraction_intent_id,sourceSupportIntentId:row.source_support_intent_id,calculationPlanIntentId:row.calculation_plan_intent_id??undefined},versions);
  if(basis.evidenceRevision!==row.evidence_revision)throw new Error("writer_basis_changed");
  const calculated=Boolean(row.calculation_plan_intent_id),operation=calculated?"write_calculated_report":"write_report";
  const composition=row.composition==null?null:parseDraftComposition(row.composition);
  if(composition){
    const outline=planHierarchicalWrite({task:basis.context.task,approvedClaimKeys:basis.context.approvedClaimKeys,assertions:basis.context.assertions});
    const contexts=canonicalSectionContexts(basis.context,outline);
    if(outline.version!==composition.planVersion || outline.sections.length!==composition.sections.length || contexts.length!==composition.sections.length)
      throw new Error("writer_composition_mismatch");
    const drafts=[];
    for(let i=0;i<composition.sections.length;i++){
      const recorded=composition.sections[i]!;
      const planned=outline.sections[i]!;
      if(recorded.questionKey!==planned.questionKey || recorded.heading!==planned.heading || JSON.stringify(recorded.claimKeys)!==JSON.stringify(planned.claimKeys))
        throw new Error("writer_composition_mismatch");
      const current=contexts[i]!;
      const legacy={...current,sectionWrite:undefined};
      const currentDigest=digest(modelInputManifest(current));
      const legacyDigest=digest(modelInputManifest(legacy));
      const sectionContext=recorded.inputDigest===currentDigest?current:recorded.inputDigest===legacyDigest?legacy:null;
      if(!sectionContext) throw new Error("writer_composition_mismatch");
      const model=(await db.query("SELECT request_digest, policy_id FROM model_operation_results WHERE intent_id=$1 AND run_id=$2 AND account_id=$3 AND operation=$4 AND evidence_revision=$5",
        [recorded.intentId,args.runId,args.accountId,operation,row.evidence_revision])).rows[0];
      if(!model)throw new Error("writer_result_unavailable");
      const raw=await loadModelOperation(db,recorded.intentId,args.runId,args.accountId,model.request_digest,sectionContext,{
        operation,schemaVersion:RESEARCH_MODEL_SCHEMA_VERSION,promptVersion:versions.promptVersion,policyId:recordedPolicyId(model.policy_id)});
      const parsed=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs.write_report,receipt:ModelReceiptSchema}).strict().safeParse(raw);
      if(!parsed.success||validateModelBindings("write_report",parsed.data.output,sectionContext).length)throw new Error("invalid_writer_result");
      drafts.push(parsed.data.output);
    }
    const draft=stitchSectionDrafts(drafts);
    if(validateModelBindings("write_report",draft,basis.context).length)throw new Error("invalid_writer_result");
    return {basis,draft,calculationKeys:[] as string[]};
  }
  const model=(await db.query("SELECT request_digest, policy_id FROM model_operation_results WHERE intent_id=$1 AND run_id=$2 AND account_id=$3 AND operation=$4",[args.extractionIntentId,args.runId,args.accountId,operation])).rows[0];
  if(!model)throw new Error("writer_result_unavailable");
  const schemaVersion=calculated?CALCULATED_REPORT_SCHEMA_VERSION:RESEARCH_MODEL_SCHEMA_VERSION;
  const promptVersion=calculated?CALCULATED_REPORT_PROMPT_VERSION:versions.promptVersion;
  const raw=await loadModelOperation(db,args.extractionIntentId,args.runId,args.accountId,model.request_digest,basis.context,{
    operation,schemaVersion,promptVersion,policyId:recordedPolicyId(model.policy_id)});
  const parsed=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs[operation],receipt:ModelReceiptSchema}).strict().safeParse(raw);
  if(!parsed.success||validateModelBindings(operation,parsed.data.output,basis.context).length)throw new Error("invalid_writer_result");
  const {calculationKeys=[],...draft}=parsed.data.output as typeof parsed.data.output & {calculationKeys?:string[]};
  return {basis,draft,calculationKeys};
}
async function loadWriterAssertionContext(db:Queryable,args:SupportArgs,versions:TaskModelVersions):Promise<SupportContext> {
  const {basis,draft}=await restoreWriterDraft(db,args,versions);
  const statements=draftStatements(draft,basis.context.assertions,basis.context.approvedClaimKeys);
  const targets=statements.flatMap((s)=>s.assertion?[s.assertion]:[]);
  return {context:{...basis.context,assertions:targets,approvedClaimKeys:[],draft,scopeComparison:undefined,calculations:undefined},evidenceRevision:basis.evidenceRevision,claimType:"inference",
    premiseRevisionIds:Object.fromEntries(statements.filter((s)=>s.assertion).map((s)=>[s.key,s.premiseKeys.map((key)=>basis.approved.find((a)=>a.claimKey===key)!.claimRevisionId)]))};
}

import { createHash } from "node:crypto";
import { z } from "zod";
import { RESEARCH_MODEL_SCHEMA_VERSION, ResearchModelOutputs } from "@deep/contracts";
import { draftStatements, resolveScopedSupport, SCOPED_SUPPORT_VERSION, validateModelBindings, type ScopedSupportResult } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { ModelReceiptSchema, type ModelContext } from "../ports/model.js";
import { loadModelOperation, modelInputManifest, validateOwnedModelContext } from "./model-operations.js";
import { loadAssertionEvidence } from "./assertion-evidence.js";
import { loadResearchTask, type TaskModelVersions } from "./research-tasks.js";

export type CheckedAssertion=ScopedSupportResult & {claimId:string;claimRevisionId:string};
export type SupportContext={context:ModelContext;evidenceRevision:number;premiseRevisionIds?:Record<string,string[]>;claimType?:"inference"};
export type SupportArgs={runId:string;accountId:string;briefRevision:number;taskId:string;extractionIntentId:string};
const Manifest = z.object({version:z.literal("model-input.v1"),passages:z.array(z.object({id:z.string().uuid()})).min(1).max(24)});
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textDigest=(value:string)=>createHash("sha256").update(value).digest("hex");

/** Restore only the exact owned extraction basis, not client-supplied assertions. */
export async function loadSupportContext(db:Queryable,args:SupportArgs,versions:TaskModelVersions):Promise<SupportContext> {
  const row=(await db.query(`SELECT * FROM model_operation_results WHERE intent_id=$1 AND run_id=$2 AND account_id=$3
    AND operation IN ('extract_assertions','write_report') AND brief_revision=$4 AND schema_version=$5 AND prompt_version=$6 AND policy_id=$7`,
    [args.extractionIntentId,args.runId,args.accountId,args.briefRevision,RESEARCH_MODEL_SCHEMA_VERSION,versions.promptVersion,versions.policyId])).rows[0];
  if (!row) throw new Error("support_extraction_owner_or_version_mismatch");
  if(row.operation==="write_report") return loadWriterAssertionContext(db,args,versions);
  const manifest=Manifest.safeParse(row.input_manifest);
  if (!manifest.success) throw new Error("support_extraction_manifest_unavailable");
  const basis=await loadAssertionEvidence(db,{...args,passageIds:manifest.data.passages.map((p)=>p.id)},versions);
  if (basis.kind==="blocked") throw new Error(basis.blocked);
  if (basis.evidenceRevision!==row.evidence_revision) throw new Error("support_extraction_basis_changed");
  const saved=await loadModelOperation(db,args.extractionIntentId,args.runId,args.accountId,row.request_digest,basis.context);
  const parsed=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs.extract_assertions,receipt:ModelReceiptSchema}).strict().safeParse(saved);
  if (!parsed.success || validateModelBindings("extract_assertions",parsed.data.output,basis.context).length) throw new Error("invalid_extraction_for_support");
  if (!parsed.data.output.assertions.length) throw new Error("no_assertions_to_check");
  const context={...basis.context,assertions:parsed.data.output.assertions};
  await validateOwnedModelContext(db,{...args,evidenceRevision:basis.evidenceRevision,context});
  return {context,evidenceRevision:basis.evidenceRevision};
}

/** Fenced transaction. A model verdict is recorded alongside independently executed checks. */
export async function persistScopedSupport(db:Queryable,args:SupportArgs & {modelIntentId:string;evidenceRevision:number;context:ModelContext},versions:TaskModelVersions,requireStored=false):Promise<CheckedAssertion[]> {
  const basis=await loadSupportContext(db,args,versions);
  if (basis.evidenceRevision!==args.evidenceRevision || digest(basis.context)!==digest(args.context)) throw new Error("stale_support_context");
  const task=await loadResearchTask(db,args.runId,args.accountId,args.briefRevision,versions);
  if (!task || task.id!==args.taskId) throw new Error("support_task_mismatch");
  const model=(await db.query(`SELECT request_digest FROM model_operation_results WHERE intent_id=$1 AND run_id=$2 AND account_id=$3
    AND operation='assess_support' AND brief_revision=$4 AND evidence_revision=$5 AND schema_version=$6 AND prompt_version=$7 AND policy_id=$8`,
    [args.modelIntentId,args.runId,args.accountId,args.briefRevision,args.evidenceRevision,RESEARCH_MODEL_SCHEMA_VERSION,versions.promptVersion,versions.policyId])).rows[0];
  if (!model) throw new Error("missing_support_execution");
  const raw=await loadModelOperation(db,args.modelIntentId,args.runId,args.accountId,model.request_digest,basis.context);
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
  return saved;
}


/** A writer may only start from independently revalidated source assertions, never another draft. */
export async function loadWriterSourceContext(db:Queryable,args:SupportArgs & {sourceSupportIntentId:string},versions:TaskModelVersions):Promise<SupportContext & {approved:CheckedAssertion[]}> {
  const source=await db.query("SELECT intent_id FROM model_operation_results WHERE intent_id=$1 AND operation='extract_assertions' AND run_id=$2 AND account_id=$3",[args.extractionIntentId,args.runId,args.accountId]);
  if(source.rowCount!==1)throw new Error("writer_source_must_be_extraction");
  const basis=await loadSupportContext(db,args,versions);
  const checks=await persistScopedSupport(db,{...args,...basis,modelIntentId:args.sourceSupportIntentId},versions,true);
  const approved=checks.filter((c)=>c.decision==="supported");
  if(!approved.length)throw new Error("writer_has_no_supported_premises");
  return {...basis,context:{...basis.context,approvedClaimKeys:approved.map((c)=>c.claimKey)},approved};
}

/** Durable one-level lineage prevents a draft from citing itself or expanding authority. */
export async function restoreWriterDraft(db:Queryable,args:SupportArgs,versions:TaskModelVersions) {
  const row=(await db.query(`SELECT * FROM research_drafts WHERE writer_intent_id=$1 AND run_id=$2 AND account_id=$3 AND task_id=$4 AND brief_revision=$5`,
    [args.extractionIntentId,args.runId,args.accountId,args.taskId,args.briefRevision])).rows[0];
  if(!row)throw new Error("writer_lineage_unavailable");
  const basis=await loadWriterSourceContext(db,{...args,extractionIntentId:row.source_extraction_intent_id,sourceSupportIntentId:row.source_support_intent_id},versions);
  if(basis.evidenceRevision!==row.evidence_revision)throw new Error("writer_basis_changed");
  const model=(await db.query("SELECT request_digest FROM model_operation_results WHERE intent_id=$1 AND operation='write_report' AND schema_version=$2 AND prompt_version=$3 AND policy_id=$4",[args.extractionIntentId,RESEARCH_MODEL_SCHEMA_VERSION,versions.promptVersion,versions.policyId])).rows[0];
  if(!model)throw new Error("writer_result_unavailable");
  const raw=await loadModelOperation(db,args.extractionIntentId,args.runId,args.accountId,model.request_digest,basis.context);
  const parsed=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs.write_report,receipt:ModelReceiptSchema}).strict().safeParse(raw);
  if(!parsed.success||validateModelBindings("write_report",parsed.data.output,basis.context).length)throw new Error("invalid_writer_result");
  return {basis,draft:parsed.data.output};
}
async function loadWriterAssertionContext(db:Queryable,args:SupportArgs,versions:TaskModelVersions):Promise<SupportContext> {
  const {basis,draft}=await restoreWriterDraft(db,args,versions);
  const statements=draftStatements(draft,basis.context.assertions,basis.context.approvedClaimKeys);
  const targets=statements.flatMap((s)=>s.assertion?[s.assertion]:[]);
  return {context:{...basis.context,assertions:targets,approvedClaimKeys:[],draft},evidenceRevision:basis.evidenceRevision,claimType:"inference",
    premiseRevisionIds:Object.fromEntries(statements.filter((s)=>s.assertion).map((s)=>[s.key,s.premiseKeys.map((key)=>basis.approved.find((a)=>a.claimKey===key)!.claimRevisionId)]))};
}

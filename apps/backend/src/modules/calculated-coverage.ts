import { z } from "zod";
import { CALCULATED_REPORT_SCHEMA_VERSION,ResearchModelOutputs,type ResearchModelOutput,type CanonicalReport } from "@deep/contracts";
import { limitedCoverageDisclosed,resolveResearchCoverage,validateModelBindings } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import type { TaskModelVersions } from "./research-tasks.js";
import type { SupportArgs } from "./scoped-support.js";
import { CALCULATED_REPORT_PROMPT_VERSION, modelPolicy } from "../ports/model-policy.js";
import { ModelReceiptSchema } from "../ports/model.js";
import { loadModelOperation } from "./model-operations.js";
import { assembleCalculatedDraft } from "./calculated-draft.js";
export const CALCULATED_COVERAGE_VERSION="calculated-coverage.v1";
type Args=SupportArgs&{supportIntentId:string;modelIntentId:string};

export async function persistCalculatedCoverage(db:Queryable,args:Args,versions:TaskModelVersions,requireStored=false) {
 const basis=await assembleCalculatedDraft(db,args,versions);
 const row=(await db.query(`SELECT request_digest, policy_id FROM model_operation_results WHERE intent_id=$1 AND run_id=$2 AND account_id=$3
  AND brief_revision=$4 AND evidence_revision=$5`,[args.modelIntentId,args.runId,args.accountId,args.briefRevision,basis.evidenceRevision])).rows[0];
 if(!row||!basis.context.task)throw new Error("calculated_coverage_owner_or_basis_mismatch");
 const raw=await loadModelOperation(db,args.modelIntentId,args.runId,args.accountId,row.request_digest,basis.context,{operation:"review_calculated_coverage",schemaVersion:CALCULATED_REPORT_SCHEMA_VERSION,promptVersion:CALCULATED_REPORT_PROMPT_VERSION,policyId:modelPolicy(row.policy_id).id});
 const proposal=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs.review_calculated_coverage,receipt:ModelReceiptSchema}).strict().parse(raw).output;
 if(validateModelBindings("review_calculated_coverage",proposal,basis.context).length)throw new Error("invalid_calculated_coverage_bindings");
 const entries=basis.context.calculations.entries;
 // These are internal coverage nodes backed by arithmetic proofs, not extracted source assertions.
 const nodes:ResearchModelOutput<"extract_assertions">["assertions"]=entries.map((entry,index)=>({key:`math_${index}`,candidateKey:null,
  criterionKeys:entry.criterionKeys,text:entry.text??"Unresolved arithmetic",scope:entry.scope,quantities:[],
  evidence:entry.result.inputs.flatMap(i=>i.evidence)}));
 if(nodes.some(n=>basis.context.assertions.some(a=>a.key===n.key)))throw new Error("calculation_coverage_key_collision");
 const normalized={...proposal,questions:proposal.questions.map(({calculationKeys,...q})=>({...q,
  assertionKeys:[...q.assertionKeys,...calculationKeys.map(k=>`math_${entries.findIndex(e=>e.key===k)}`)]}))};
 const coverage=resolveResearchCoverage({question:basis.context.question,task:basis.context.task,assertions:[...basis.context.assertions,...nodes],
  checks:[...basis.checks,...entries.map((e,i)=>({claimKey:`math_${i}`,decision:e.selected&&e.result.status==="computed"?"supported" as const:"insufficient" as const}))],proposal:normalized});
 for(const question of coverage.questions) {
  const offered=proposal.questions.find(q=>q.questionKey===question.questionKey)!;
  const required=entries.filter(e=>e.questionKeys.includes(question.questionKey));
  if(question.status==="supported"&&required.length&&!required.some(e=>e.selected&&e.result.status==="computed"&&offered.calculationKeys.includes(e.key))) {
   question.status="unresolved_at_limit";question.failedChecks.push("required_arithmetic_not_covered");
  }
  if(question.status==="supported"&&offered.calculationKeys.some(k=>!entries.find(e=>e.key===k)!.questionKeys.includes(question.questionKey))) {
   question.status="unresolved_at_limit";question.failedChecks.push("unrelated_calculation");
  }
 }
 coverage.unresolvedCriterionKeys=basis.context.task.criteria.filter(c=>
  !basis.context.task!.questions.some(q=>q.criterionKeys.includes(c.key))||
  basis.context.task!.questions.some(q=>q.criterionKeys.includes(c.key)&&coverage.questions.find(r=>r.questionKey===q.key)!.status!=="supported")).map(c=>c.key);
 coverage.complete=coverage.complete&&coverage.questions.every(q=>q.status==="supported")&&!coverage.unresolvedCriterionKeys.length&&!basis.compiled.unresolved.length;
 const result={...coverage,version:CALCULATED_COVERAGE_VERSION};
 const values=[args.modelIntentId,args.accountId,args.runId,args.taskId,args.extractionIntentId,args.supportIntentId,args.briefRevision,basis.evidenceRevision,CALCULATED_COVERAGE_VERSION,JSON.stringify(result),JSON.stringify(basis.compiled)];
 if(!requireStored)await db.query(`INSERT INTO calculated_report_coverage(model_intent_id,account_id,run_id,task_id,writer_intent_id,support_intent_id,brief_revision,evidence_revision,checker_version,result,compiled)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,values);
 const exact=await db.query(`SELECT 1 FROM calculated_report_coverage WHERE model_intent_id=$1 AND account_id=$2 AND run_id=$3 AND task_id=$4 AND writer_intent_id=$5 AND support_intent_id=$6
  AND brief_revision=$7 AND evidence_revision=$8 AND checker_version=$9 AND result=$10::jsonb AND compiled=$11::jsonb`,values);
 if(exact.rowCount!==1)throw new Error("stored_calculated_coverage_mismatch");
 return {coverage:result,basis};
}
export async function calculatedCompletionCovered(db:Queryable,accountId:string,report:CanonicalReport,versions:TaskModelVersions) {
 const rows=(await db.query(`SELECT * FROM calculated_report_coverage WHERE account_id=$1 AND run_id=$2 AND brief_revision=$3 AND evidence_revision=$4 AND checker_version=$5`,[accountId,report.runId,report.basis.briefRevision,report.basis.evidenceRevision,CALCULATED_COVERAGE_VERSION])).rows;
 for(const row of rows) {
  const {coverage,basis}=await persistCalculatedCoverage(db,{accountId,runId:report.runId,briefRevision:report.basis.briefRevision,taskId:row.task_id,
   extractionIntentId:row.writer_intent_id,supportIntentId:row.support_intent_id,modelIntentId:row.model_intent_id},versions,true);
  const compiledMatch=JSON.stringify(basis.compiled.blocks)===JSON.stringify(report.blocks)&&JSON.stringify(basis.compiled.claims.map(c=>c.id))===JSON.stringify(report.claimIds);
  if(coverage.complete&&compiledMatch)return true;
  if(report.outcome==="completed_with_limitations"&&compiledMatch&&basis.context.task&&limitedCoverageDisclosed(report.limitations,coverage,basis.context.task))return true;
 }
 return false;
}

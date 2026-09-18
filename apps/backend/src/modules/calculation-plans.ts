import {runModelVersions} from "./run-model-policy.js";
import { z } from "zod";
import { CALCULATION_PLANNING_SCHEMA_VERSION,ResearchModelOutputs } from "@deep/contracts";
import { validateModelBindings } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { CALCULATION_PLANNING_PROMPT_VERSION,MODEL_PROMPT_VERSION } from "../ports/model-policy.js";
import { ModelReceiptSchema,type ModelContext } from "../ports/model.js";
import { loadModelOperation } from "./model-operations.js";
import { loadSupportContext,persistScopedSupport,type SupportArgs } from "./scoped-support.js";
import { persistEvidenceCalculation } from "./evidence-calculations.js";
import { prepareCalculationClaim } from "./calculation-publication.js";
export async function restoreCalculationPlan(db:Queryable,args:SupportArgs&{supportIntentId:string;planIntentId:string},requireStored=true) {
 const versions=await runModelVersions(db,args.runId);
 const basis=await loadSupportContext(db,args,versions);
 const checks=await persistScopedSupport(db,{...args,...basis,modelIntentId:args.supportIntentId},versions,true);
 const context={...basis.context,approvedClaimKeys:checks.filter(c=>c.decision==="supported").map(c=>c.claimKey).sort()};
 const metadata={operation:"plan_calculations" as const,schemaVersion:CALCULATION_PLANNING_SCHEMA_VERSION,promptVersion:CALCULATION_PLANNING_PROMPT_VERSION,policyId:versions.policyId};
 const row=(await db.query("SELECT request_digest FROM model_operation_results WHERE intent_id=$1 AND account_id=$2 AND run_id=$3 AND brief_revision=$4 AND evidence_revision=$5",[args.planIntentId,args.accountId,args.runId,args.briefRevision,basis.evidenceRevision])).rows[0];
 if(!row)throw new Error("calculation_plan_owner_or_basis_mismatch");
 const raw=await loadModelOperation(db,args.planIntentId,args.runId,args.accountId,row.request_digest,context,metadata);
 const plan=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs.plan_calculations,receipt:ModelReceiptSchema}).strict().parse(raw).output;
 if(validateModelBindings("plan_calculations",plan,context).length)throw new Error("invalid_calculation_plan_bindings");
 const executions=[];
 for(const item of plan.calculations) {
  const result=await persistEvidenceCalculation(db,{...args,action:item.action},versions,requireStored);
  if(result.kind!=="calculation")throw new Error("invalid_executable_calculation_plan");
  executions.push({...item,calculationId:result.id,result:result.result});
 }
 const values=[args.planIntentId,args.accountId,args.runId,args.taskId,args.extractionIntentId,args.supportIntentId,args.briefRevision,basis.evidenceRevision,executions.map(e=>e.calculationId)];
 if(!requireStored)await db.query(`INSERT INTO calculation_plans(model_intent_id,account_id,run_id,task_id,extraction_intent_id,support_intent_id,brief_revision,evidence_revision,calculation_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,values);
 const exact=await db.query(`SELECT 1 FROM calculation_plans WHERE model_intent_id=$1 AND account_id=$2 AND run_id=$3 AND task_id=$4 AND extraction_intent_id=$5 AND support_intent_id=$6 AND brief_revision=$7 AND evidence_revision=$8 AND calculation_ids=$9::uuid[]`,values);
 if(exact.rowCount!==1)throw new Error("stored_calculation_plan_mismatch");
 return {basis,plan,executions};
}
export async function calculationWriterContext(db:Queryable,args:{accountId:string;runId:string;briefRevision:number;planIntentId:string},prepare=false):Promise<NonNullable<ModelContext["calculations"]>> {
 const row=(await db.query("SELECT * FROM calculation_plans WHERE model_intent_id=$1 AND account_id=$2 AND run_id=$3 AND brief_revision=$4",[args.planIntentId,args.accountId,args.runId,args.briefRevision])).rows[0];
 if(!row)throw new Error("calculation_plan_unavailable");
 const restored=await restoreCalculationPlan(db,{...args,taskId:row.task_id,extractionIntentId:row.extraction_intent_id,supportIntentId:row.support_intent_id});
 const entries=[];
 for(const item of restored.executions) {
  const premises=item.action.inputs.map(ref=>restored.basis.context.assertions.find(a=>a.key===ref.claimKey)!);
  const scope={...premises[0]!.scope};
  for(const field of Object.keys(scope) as (keyof typeof scope)[])if(premises.some(p=>p.scope[field]!==scope[field]))scope[field]=null;
  const criterionKeys=premises[0]!.criterionKeys.filter(k=>premises.every(p=>p.criterionKeys.includes(k)));
  const claim=await prepareCalculationClaim(db,{...args,evidenceRevision:row.evidence_revision,calculationId:item.calculationId},!prepare);
  entries.push({key:item.key,questionKeys:item.questionKeys,calculationId:item.calculationId,claimId:claim.kind==="claim"?claim.claim.id:null,
   claimRevisionId:claim.kind==="claim"?claim.revisionId:null,text:claim.kind==="claim"?claim.claim.text:null,result:item.result,scope,criterionKeys,selected:false});
 }
 return {planIntentId:args.planIntentId,entries};
}

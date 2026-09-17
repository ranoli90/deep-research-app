import type pg from "pg";
import { validateModelBindings } from "@deep/research-core";
import type { AppConfig } from "../platform/config.js";
import { loadSupportContext,persistScopedSupport,type SupportArgs } from "../modules/scoped-support.js";
import type { FencedSession } from "./fenced-session.js";
import { TASK_MODEL_VERSIONS } from "./research-task.js";
import { performModelOperation } from "./model-gateway.js";
import { persistEvidenceCalculation } from "../modules/evidence-calculations.js";

/** Proposals never carry numeric values or server authority. Execution revalidates under the fence. */
export async function executeCalculationPlanning(pool:pg.Pool,config:AppConfig,session:FencedSession,args:SupportArgs&{fence:number;supportIntentId:string}) {
 const basis=await session.write(async db=>{
  const basis=await loadSupportContext(db,args,TASK_MODEL_VERSIONS);
  const checks=await persistScopedSupport(db,{...args,...basis,modelIntentId:args.supportIntentId},TASK_MODEL_VERSIONS,true);
  return {...basis,context:{...basis.context,approvedClaimKeys:checks.filter(c=>c.decision==="supported").map(c=>c.claimKey).sort()}};
 });
 if(!basis.context.assertions.some(a=>a.quantities.length&&basis.context.approvedClaimKeys.includes(a.key)))
  return {kind:"not_applicable" as const,reason:"no_supported_quantities"};
 // A new plan must not change an already-admitted writer's inputs or trigger extra work on replay.
 const prior=await session.write(db=>db.query(`SELECT a.kind FROM run_actions a WHERE a.run_id=$1 AND a.brief_revision=$2
  AND a.kind IN ('write_report','plan_calculations')`,[args.runId,args.briefRevision]));
 if(prior.rows.some(r=>r.kind==="write_report")&&!prior.rows.some(r=>r.kind==="plan_calculations"))
  return {kind:"not_applicable" as const,reason:"legacy_writer_context_preserved"};
 const proposal=await performModelOperation(pool,config,session,{...args,...basis,operation:"plan_calculations"});
 if(proposal.kind!=="result")return proposal;
 if(proposal.result.status!=="succeeded")return {kind:"blocked" as const,reason:`calculation_plan_${proposal.result.status}`};
 const plan=proposal.result.output;
 return session.write(async db=>{
  const current=await loadSupportContext(db,args,TASK_MODEL_VERSIONS);
  const checks=await persistScopedSupport(db,{...args,...current,modelIntentId:args.supportIntentId},TASK_MODEL_VERSIONS,true);
  const context={...current.context,approvedClaimKeys:checks.filter(c=>c.decision==="supported").map(c=>c.claimKey).sort()};
  if(current.evidenceRevision!==basis.evidenceRevision||JSON.stringify(context)!==JSON.stringify(basis.context)||validateModelBindings("plan_calculations",plan,context).length)
   throw new Error("stale_calculation_plan");
  const executions=[];
  for(const item of plan.calculations) {
   const execution=await persistEvidenceCalculation(db,{...args,action:item.action},TASK_MODEL_VERSIONS);
   if(execution.kind!=="calculation")throw new Error("invalid_executable_calculation_plan");
   executions.push({key:item.key,questionKeys:item.questionKeys,calculationId:execution.id,result:execution.result});
  }
  return {kind:"calculations" as const,intentId:proposal.intentId,reused:proposal.reused,executions,
   unresolvedQuestionKeys:plan.unresolvedQuestionKeys,reason:plan.reason};
 });
}

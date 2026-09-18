import { createHash } from "node:crypto";
import { DEFAULT_RUN_BUDGET_MICRO } from "@deep/contracts";
import type { RegisteredPlan,FrozenSource } from "./authorization.js";
export type Step={id:string;taskId:string;repeat:number;arm:"A1"|"B";kind:"original"|"correction"|"full_rerun";question:string;parentStepId?:string;idempotencyKey:string;sources?:FrozenSource[];unavailableReason?:string};
export type Exposure={confirmedMicro:number;heldMicro:number;unknownIntents:number};
export type ExecutionReceipt={runId:string;briefRevision:number;lifecycle:string;outcome:string|null;reportId:string|null;executionError?:"worker_execution_unconfirmed";cost:Exposure;trace:unknown};
export type Driver={exposure():Promise<Exposure>;admit(step:Step,parent?:ExecutionReceipt):Promise<{runId:string}>;execute(runId:string):Promise<ExecutionReceipt>};
export type Journal=(record:Record<string,unknown>)=>Promise<void>;
export function stepKey(approvalId:string,stepId:string){const h=createHash("sha256").update(`matched-evaluation:${approvalId}:${stepId}`).digest("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
export function stepsFor(plan:RegisteredPlan):Step[]{
 const steps:Step[]=[];for(const task of plan.tasks)for(let repeat=1;repeat<=task.repetitions;repeat++){
  const prefix=`${task.id}:${repeat}`,order:Step["arm"][]=(task.index+(repeat===2?1:0))%2?["B","A1"]:["A1","B"];
  for(const arm of order)steps.push({id:`${prefix}:${arm}:original`,taskId:task.id,repeat,arm,kind:"original",question:task.question,idempotencyKey:""});
  steps.push({id:`${prefix}:B:correction`,taskId:task.id,repeat,arm:"B",kind:"correction",question:task.correctedQuestion,parentStepId:`${prefix}:B:original`,idempotencyKey:""});
  steps.push({id:`${prefix}:A1:full_rerun`,taskId:task.id,repeat,arm:"A1",kind:"full_rerun",question:task.correctedQuestion,idempotencyKey:""});
 }return steps.map(step=>({...step,sources:plan.tasks.find(t=>t.id===step.taskId)?.sources,unavailableReason:plan.tasks.find(t=>t.id===step.taskId)?.unavailableReason,idempotencyKey:stepKey(plan.authorization.approvalId,step.id)}));
}
/** Sequential generation only. No scoring/gold, hidden retries, missing-denominator removal or hold settlement. */
export async function runMatched(plan:RegisteredPlan,driver:Driver,journal:Journal){
 const steps=stepsFor(plan),completed=new Map<string,ExecutionReceipt>();let halted:string|null=null;
 await journal({event:"plan",authorization:plan.authorization,protocolHash:plan.protocolHash,freezeHash:plan.freezeHash,tasksHash:plan.tasksHash,sourcesHash:plan.sourcesHash,unselectedTaskIds:plan.unselectedTaskIds,steps,semanticScores:null,adjudication:null});

 for(const step of steps){
  if(!halted&&Date.now()>=Date.parse(plan.authorization.expiresAt))halted="approval_expired";
  const parent=step.parentStepId?completed.get(step.parentStepId):undefined;
  if(halted){await journal({event:"unrun",stepId:step.id,reason:halted});continue;}
  if(step.unavailableReason){await journal({event:"unrun",stepId:step.id,reason:step.unavailableReason});continue;}
  if(step.parentStepId&&(!parent?.reportId||parent.lifecycle!=="terminal")){await journal({event:"unrun",stepId:step.id,reason:"parent_report_unavailable"});continue;}
  let exposure:Exposure;
  try{exposure=await driver.exposure();}catch{halted="exposure_unavailable";await journal({event:"unrun",stepId:step.id,reason:halted});continue;}
  if(![exposure.confirmedMicro,exposure.heldMicro,exposure.unknownIntents].every(n=>Number.isSafeInteger(n)&&n>=0)){halted="invalid_exposure_receipt";await journal({event:"unrun",stepId:step.id,reason:halted});continue;}
  if(exposure.heldMicro||exposure.unknownIntents)halted="prior_unknown_exposure";
  else if(exposure.confirmedMicro+DEFAULT_RUN_BUDGET_MICRO>plan.authorization.budgetMicro)halted="budget_unrun";
  if(halted){await journal({event:"unrun",stepId:step.id,reason:halted,exposure});continue;}
  const startedAt=new Date().toISOString(),started=performance.now();await journal({event:"attempt",step,startedAt,exposure});
  // Exposure and durable journaling can outlast approval. Check at the admission boundary,
  // with no intervening await; an already admitted run still completes and retains its receipt.
  if(Date.now()>=Date.parse(plan.authorization.expiresAt)){halted="approval_expired";await journal({event:"unrun",stepId:step.id,reason:halted});continue;}
  let runId:string|null=null;
  try{
   ({runId}=await driver.admit(step,parent));await journal({event:"admitted",stepId:step.id,runId});
   const receipt=await driver.execute(runId);
   await journal({event:"result",stepId:step.id,startedAt,finishedAt:new Date().toISOString(),wallMs:performance.now()-started,receipt});
   completed.set(step.id,receipt);
   if(receipt.executionError||receipt.cost.heldMicro||receipt.cost.unknownIntents||receipt.lifecycle!=="terminal")halted="unknown_or_incomplete_run";
  }catch{await journal({event:"failed",stepId:step.id,runId,startedAt,finishedAt:new Date().toISOString(),wallMs:performance.now()-started,reason:"execution_or_receipt_unconfirmed"});halted="execution_or_receipt_unconfirmed";}
 }
 await journal({event:"finished",expectedSteps:steps.length,recordedResults:completed.size,halted,semanticScores:null,adjudication:null});return {expectedSteps:steps.length,recordedResults:completed.size,halted};
}

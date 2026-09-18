import { createHash } from "node:crypto";
import { EvidenceCalculationActionSchema,EvidenceCalculationResultSchema,EVIDENCE_CALCULATION_VERSION } from "@deep/contracts";
import { calculateEvidence,SCOPED_SUPPORT_VERSION } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { loadSupportContext,persistScopedSupport,type SupportArgs } from "./scoped-support.js";
import { modelInputManifest } from "./model-operations.js";
import type { TaskModelVersions } from "./research-tasks.js";
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type CalculationArgs=SupportArgs&{supportIntentId:string;action:unknown};
/** Fenced caller; derive from current owned support, never client numbers or a saved verdict alone. */
export async function persistEvidenceCalculation(db:Queryable,args:CalculationArgs,versions:TaskModelVersions,requireStored=false) {
 const parsed=EvidenceCalculationActionSchema.safeParse(args.action);
 if(!parsed.success)return {kind:"blocked" as const,reason:"invalid_calculation_action"};
 const action=parsed.data;
 const basis=await loadSupportContext(db,args,versions);
 const checks=await persistScopedSupport(db,{...args,...basis,modelIntentId:args.supportIntentId},versions,true);
 const selected=action.inputs.map(ref=>{
  const checked=checks.find(c=>c.claimKey===ref.claimKey);
  if(!checked)throw new Error("calculation_target_unavailable");
  return {claimKey:ref.claimKey,quantityIndex:ref.quantityIndex,claimRevisionId:checked.claimRevisionId,decision:checked.decision};
 });
 const result=calculateEvidence(action,basis.context.assertions,new Set(checks.filter(c=>c.decision==="supported").map(c=>c.claimKey)));
 const revisions=[...new Set(selected.map(s=>s.claimRevisionId))];
 const inputDigest=digest({action,taskId:args.taskId,briefRevision:args.briefRevision,evidenceRevision:basis.evidenceRevision,
  evidence:modelInputManifest(basis.context),claims:selected,supportCheckerVersion:SCOPED_SUPPORT_VERSION});
 const prior=(await db.query(`SELECT * FROM evidence_calculations WHERE run_id=$1 AND extraction_intent_id=$2 AND support_intent_id=$3
  AND calculator_version=$4 AND input_digest=$5`,[args.runId,args.extractionIntentId,args.supportIntentId,EVIDENCE_CALCULATION_VERSION,inputDigest])).rows[0];
 if(prior) {
  const saved=EvidenceCalculationResultSchema.safeParse(prior.result);
  if(prior.account_id!==args.accountId||prior.task_id!==args.taskId||prior.brief_revision!==args.briefRevision||prior.evidence_revision!==basis.evidenceRevision||
   prior.support_checker_version!==SCOPED_SUPPORT_VERSION||JSON.stringify(prior.claim_revision_ids)!==JSON.stringify(revisions)||
   JSON.stringify(EvidenceCalculationActionSchema.parse(prior.action))!==JSON.stringify(action)||!saved.success||JSON.stringify(saved.data)!==JSON.stringify(result))throw new Error("stored_calculation_mismatch");
  return {kind:"calculation" as const,id:prior.id as string,result,reused:true};
 }
 if(requireStored)throw new Error("missing_stored_calculation");
 const id=crypto.randomUUID();
 await db.query(`INSERT INTO evidence_calculations(id,account_id,run_id,task_id,extraction_intent_id,support_intent_id,brief_revision,evidence_revision,
  calculator_version,support_checker_version,input_digest,claim_revision_ids,action,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
  [id,args.accountId,args.runId,args.taskId,args.extractionIntentId,args.supportIntentId,args.briefRevision,basis.evidenceRevision,EVIDENCE_CALCULATION_VERSION,SCOPED_SUPPORT_VERSION,inputDigest,revisions,JSON.stringify(action),JSON.stringify(result)]);
 return {kind:"calculation" as const,id,result,reused:false};
}

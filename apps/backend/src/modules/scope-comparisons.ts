import { createHash } from "node:crypto";
import { CompareScopesActionSchema,SCOPE_COMPARISON_VERSION,ScopeComparisonResultSchema } from "@deep/contracts";
import { compareAssertionScopes,SCOPED_SUPPORT_VERSION } from "@deep/research-core";
import { loadSupportContext,persistScopedSupport,type SupportArgs } from "./scoped-support.js";
import { modelInputManifest } from "./model-operations.js";
import type { Queryable } from "../platform/db.js";
import type { TaskModelVersions } from "./research-tasks.js";
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type ComparisonArgs=SupportArgs&{supportIntentId:string;action:unknown};
/** Called inside a fenced transaction; restoration never repairs missing or corrupt results. */
export async function persistScopeComparison(db:Queryable,args:ComparisonArgs,versions:TaskModelVersions,requireStored=false) {
 const parsed=CompareScopesActionSchema.safeParse(args.action);
 if(!parsed.success)return {kind:"blocked" as const,reason:"invalid_scope_comparison_action"};
 const action={...parsed.data,claimKeys:[...parsed.data.claimKeys].sort()};

  const basis=await loadSupportContext(db,args,versions);
  const checks=await persistScopedSupport(db,{...args,...basis,modelIntentId:args.supportIntentId},versions,true);
  const selected=action.claimKeys.map(key=>{
   const check=checks.find(c=>c.claimKey===key);
   if(!check)throw new Error("comparison_target_unavailable");
   return {key,claimRevisionId:check.claimRevisionId,decision:check.decision};
  });
  // Include rejected/unknown assertions for scope inspection; comparison never promotes their support.
  const result=compareAssertionScopes(action,basis.context.assertions);
  const inputDigest=digest({action,taskId:args.taskId,briefRevision:args.briefRevision,evidenceRevision:basis.evidenceRevision,
   evidence:modelInputManifest(basis.context),claims:selected,supportCheckerVersion:SCOPED_SUPPORT_VERSION});
  const prior=(await db.query(`SELECT * FROM scope_comparisons WHERE run_id=$1 AND extraction_intent_id=$2
    AND support_intent_id=$3 AND checker_version=$4 AND input_digest=$5`,[args.runId,args.extractionIntentId,args.supportIntentId,SCOPE_COMPARISON_VERSION,inputDigest])).rows[0];
  const revisions=selected.map(c=>c.claimRevisionId);
  if(prior) {
   const saved=ScopeComparisonResultSchema.safeParse(prior.result);
   if(prior.account_id!==args.accountId||prior.task_id!==args.taskId||prior.brief_revision!==args.briefRevision||
    prior.evidence_revision!==basis.evidenceRevision||prior.support_checker_version!==SCOPED_SUPPORT_VERSION||
    JSON.stringify(prior.claim_revision_ids)!==JSON.stringify(revisions)||!saved.success||JSON.stringify(saved.data)!==JSON.stringify(result))throw new Error("stored_scope_comparison_mismatch");
   return {kind:"comparison" as const,id:prior.id as string,result,reused:true};
  }
  if(requireStored)throw new Error("missing_stored_scope_comparison");
  // Adding comparison context must not turn an older unknown writer call into a new paid identity.
  const unknownWriter=await db.query(`SELECT i.id FROM run_actions a JOIN provider_intents i ON i.action_id=a.id
    LEFT JOIN model_operation_results m ON m.intent_id=i.id
    WHERE a.run_id=$1 AND a.brief_revision=$2 AND a.kind='write_report'
      AND (i.confirmed_micro IS NULL OR m.intent_id IS NULL OR m.result->>'status'='outcome_unknown') LIMIT 1`,[args.runId,args.briefRevision]);
  if(unknownWriter.rowCount)return {kind:"blocked" as const,reason:"comparison_upgrade_requires_reconciled_writer"};
  const id=crypto.randomUUID();
  await db.query(`INSERT INTO scope_comparisons(id,account_id,run_id,task_id,extraction_intent_id,support_intent_id,brief_revision,evidence_revision,
   checker_version,support_checker_version,input_digest,claim_revision_ids,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
   [id,args.accountId,args.runId,args.taskId,args.extractionIntentId,args.supportIntentId,args.briefRevision,basis.evidenceRevision,SCOPE_COMPARISON_VERSION,SCOPED_SUPPORT_VERSION,inputDigest,revisions,JSON.stringify(result)]);
  return {kind:"comparison" as const,id,result,reused:false};

}

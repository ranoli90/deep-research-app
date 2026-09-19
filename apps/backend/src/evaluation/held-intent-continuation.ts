import type { Queryable } from "../platform/db.js";
import { ModelReceiptSchema } from "../ports/model.js";
import { modelPolicy } from "../ports/model-policy.js";
import { ResearchModelOutputs } from "@deep/contracts";
import { evaluationQuestionDigest,sha256,type Authorization } from "./authorization.js";
/** Read-only evidence validation. This never settles/releases/resends a provider action. */
export async function preservedHeldExposure(db:Queryable,grant:Authorization,providerKeyScope:string) {
 const continuation=grant.heldIntentContinuation;
 if(!continuation)return {};
 let held=0;const seen=new Set<string>();
 for(const expected of continuation.intents){
  if(seen.has(expected.intentId))throw Error("duplicate_held_intent");seen.add(expected.intentId);
  const row=(await db.query(`SELECT p.*,r.account_id,r.lifecycle,r.model_policy_id,b.original_question,
   m.policy_id,m.operation,m.result->>'status' AS result_status,(m.result->'receipt'=p.receipt) AS receipt_matches
   FROM provider_intents p JOIN runs r ON r.id=p.run_id JOIN accounts owner ON owner.id=r.account_id AND owner.deleted_at IS NULL
   JOIN research_briefs b ON b.id=r.brief_id AND b.account_id=r.account_id AND b.revision=r.brief_revision
   JOIN run_actions a ON a.id=p.action_id AND a.run_id=r.id AND a.brief_revision=r.brief_revision
   AND a.request_digest=p.request_digest
   JOIN model_operation_results m ON m.intent_id=p.id AND m.run_id=p.run_id AND m.request_digest=p.request_digest
   AND m.account_id=r.account_id AND m.brief_revision=r.brief_revision AND m.evidence_revision=r.evidence_revision
   AND m.operation=a.kind AND a.logical_key='model:'||m.operation||':'||p.request_digest WHERE p.id=$1`,[expected.intentId])).rows[0];
  const receipt=ModelReceiptSchema.safeParse(row?.receipt);
  if(!row||row.account_id!==grant.accountId||row.scope_key!==grant.budgetScope||row.provider_key_scope!==providerKeyScope||row.run_id!==expected.runId||row.lifecycle!=="terminal"||row.state!=="outcome-unknown"||row.confirmed_micro!==null||row.request_digest!==expected.requestDigest||row.model_policy_id!==expected.policyId||row.policy_id!==expected.policyId||row.result_status!=="outcome_unknown"||row.receipt_matches!==true||!Object.hasOwn(ResearchModelOutputs,row.operation)||!receipt.success||receipt.data.actualMicro!==null||receipt.data.rawCost!==null||sha256(JSON.stringify(row.receipt))!==expected.receiptDigest||evaluationQuestionDigest(row.original_question)!==expected.questionDigest||Number(row.reserved_max_micro)!==expected.reservedMicro)throw Error("held_intent_snapshot_mismatch");
  const policy=modelPolicy(expected.policyId);
  const legacyRoute=`openrouter:${policy.model}:${row.operation}`;
  const policyRoute=`openrouter:${policy.model}:${policy.id}:${row.operation}`;
  if((row.route!==legacyRoute&&row.route!==policyRoute)||receipt.data.requestedModel!==policy.model)throw Error("held_intent_route_mismatch");
  held+=expected.reservedMicro;
 }
 if(!Number.isSafeInteger(held)||held>=grant.budgetMicro)throw Error("held_intent_budget_unavailable");
 return {preservedHeldMicro:held,preservedUnknownIntents:seen.size};
}

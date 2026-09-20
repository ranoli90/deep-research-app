import type { ResearchModelOperation } from "@deep/contracts";
import type { Queryable } from "../platform/db.js";
import { capabilitiesFor, operationClassFor, resolveOperationRoute, PRODUCTION_PORTFOLIO_V1 } from "../model-governor/index.js";
import { modelPolicy } from "../ports/model-policy.js";

/** Runtime admission is deliberately single-model Beta. A retired/missing capability
 * cannot silently become a cheaper processor or rewrite a historical request. */
export async function persistOperationRoute(db: Queryable, args: {
 runId: string; accountId: string; logicalDigest: string; attemptIndex: number;
 operation: ResearchModelOperation; policyId: string; requestDigest: string; reserveMicro: number;
}): Promise<void> {
 const prior = (await db.query(`SELECT policy_id,request_digest,reserve_micro FROM model_operation_routes
 WHERE run_id=$1 AND logical_digest=$2 AND attempt_index=$3`, [args.runId,args.logicalDigest,args.attemptIndex])).rows[0];
 if (prior) {
  if (prior.policy_id !== args.policyId || prior.request_digest !== args.requestDigest || Number(prior.reserve_micro) !== args.reserveMicro)
   throw new Error("model_operation_route_conflict");
  return;
 }
 // Restoring an already-issued historical attempt must never be a fresh admission.
 if ((await db.query("SELECT 1 FROM provider_intents WHERE run_id=$1 AND request_digest=$2", [args.runId,args.requestDigest])).rowCount) return;
 const cap = capabilitiesFor(args.policyId);
 if (!cap.available || !cap.structuredOutput || cap.dataCollection !== "deny") throw new Error("model_route_unavailable");
 const policy = modelPolicy(args.policyId);
 const row=(await db.query(`SELECT r.budget_micro-COALESCE((SELECT SUM(COALESCE(i.confirmed_micro,
 CASE WHEN i.state IN ('issued','outcome-unknown') THEN i.reserved_max_micro ELSE 0 END)) FROM provider_intents i WHERE i.run_id=r.id),0) AS remaining
 FROM runs r WHERE r.id=$1 AND r.account_id=$2`,[args.runId,args.accountId])).rows[0];
 const decision=resolveOperationRoute({ portfolio: { ...PRODUCTION_PORTFOLIO_V1, candidates:[cap] },
 operation: args.operation, operationClass: operationClassFor(args.operation), privacy:{zdrRequired:policy.provider==="azure",dataCollection:"deny"},
 structuredOutputRequired:true, remainingBudgetMicro:Number(row?.remaining ?? 0),attemptReserveMicro:args.reserveMicro });
 if(!decision.admitted || decision.policyId!==policy.id) throw new Error(decision.reason);
 await assertModelRouteHealthy(db, policy.id);
 await db.query(`INSERT INTO model_operation_routes(run_id,account_id,logical_digest,attempt_index,operation,policy_id,request_digest,reserve_micro,reason)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [args.runId,args.accountId,args.logicalDigest,args.attemptIndex,args.operation,policy.id,args.requestDigest,args.reserveMicro,
 `single_model_beta:${operationClassFor(args.operation)}:privacy_structured_context_admitted`]);
}
export async function assertModelRouteHealthy(db: Queryable, policyId: string): Promise<void> {
 const row=(await db.query("SELECT state FROM model_route_health WHERE policy_id=$1 FOR SHARE",[policyId])).rows[0];
 if(row?.state!=="healthy") throw new Error("model_route_unavailable");
}
export async function recordModelRouteOutcome(db: Queryable, policyId: string, reason?: string): Promise<void> {
 // A proven processor mismatch is a security failure: open the circuit immediately.
 // Financially unknown timeouts do not authorize a retry or auto-release any hold.
 if(reason!=="provider_route_mismatch") return;
 await db.query("UPDATE model_route_health SET state='retired',reason='provider_route_mismatch',updated_at=now() WHERE policy_id=$1",[policyId]);
}

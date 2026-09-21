import { assertModelRouteHealthy } from "./model-operation-routing.js";
import { createHash } from "node:crypto";
import { LIVE_CALL_RESERVE_MICRO } from "@deep/contracts";
import type { Queryable } from "../platform/db.js";
import type { AppConfig } from "../platform/config.js";
import type pg from "pg";
import { withTx } from "../platform/db.js";
import { getRun } from "./runs.js";
import { currentConsent } from "./access.js";
import { guestExecutionAllowed } from "./guest-execution-control.js";
import { operationClassFor, reserveOperationBudget } from "../model-governor/index.js";

/** Run remaining after confirmed spend plus issued/unknown holds. Never trust a lagging spent_micro snapshot. */
export async function runRemainingBudgetMicro(db: Queryable, args: { runId: string; accountId: string }): Promise<number> {
  const row = (await db.query<{ budget_micro: string; used_micro: string }>(
    `SELECT r.budget_micro::text AS budget_micro,
      COALESCE((SELECT SUM(CASE
        WHEN i.confirmed_micro IS NOT NULL THEN i.confirmed_micro
        WHEN i.state IN ('issued','outcome-unknown') THEN i.reserved_max_micro
        ELSE 0 END)
        FROM provider_intents i WHERE i.run_id=r.id),0)::text AS used_micro
     FROM runs r WHERE r.id=$1 AND r.account_id=$2`,
    [args.runId, args.accountId],
  )).rows[0];
  if (!row) throw new Error("run_owner_mismatch");
  return Math.max(0, Number(row.budget_micro) - Number(row.used_micro));
}

/** Sum confirmed spend plus unresolved HOLD. Known-zero failures are not unknown liabilities. */
export async function liveSpendUsedMicro(db: Queryable, scope = "project"): Promise<number> {
  const res = await db.query<{ used: string }>(
    `SELECT COALESCE(SUM(
       CASE
         WHEN confirmed_micro IS NOT NULL THEN confirmed_micro
         WHEN state IN ('issued', 'outcome-unknown') THEN reserved_max_micro
         ELSE 0
       END
     ), 0)::text AS used
     FROM provider_intents
     WHERE route LIKE 'openrouter:%' AND scope_key = $1`, [scope],
  );
  return Number(res.rows[0]?.used ?? 0);
}

export function canIssueLiveCall(args: {
  capMicro: number;
  usedMicro: number;
  estimatedMicro?: number;
}): { ok: boolean; remainingMicro: number; reason?: string } {
  const estimated = args.estimatedMicro ?? LIVE_CALL_RESERVE_MICRO;
  if (![args.capMicro, args.usedMicro, estimated].every((v) => Number.isSafeInteger(v) && v >= 0)) {
    return { ok: false, remainingMicro: 0, reason: "invalid_live_budget" };
  }
  const remaining = args.capMicro - args.usedMicro;
  if (args.capMicro <= 0) return { ok: false, remainingMicro: remaining, reason: "live_spend_cap_zero" };
  if (remaining < estimated) return { ok: false, remainingMicro: remaining, reason: "live_spend_cap_exhausted" };
  return { ok: true, remainingMicro: remaining };
}

export async function assertLiveCallAllowed(db: Queryable, config: AppConfig, estimatedMicro = LIVE_CALL_RESERVE_MICRO) {
  if ((await db.query(`SELECT 1 FROM provider_intents WHERE route LIKE 'openrouter:%'
    AND scope_key=$1 AND confirmed_micro > reserved_max_micro LIMIT 1`, [config.liveBudgetScope ?? "project"])).rowCount)
    throw new Error("provider_overrun_requires_review");
  const used = await liveSpendUsedMicro(db, config.liveBudgetScope);
  const gate = canIssueLiveCall({ capMicro: config.liveSpendCapMicro, usedMicro: used, estimatedMicro });
  if (!gate.ok) {
    const err = Object.assign(new Error(gate.reason ?? "live_spend_blocked"), { code: gate.reason, remainingMicro: gate.remainingMicro, usedMicro: used });
    throw err;
  }
  return { usedMicro: used, remainingMicro: gate.remainingMicro };
}

/** One logical action, one issued attempt until its outcome is reconciled. */
export async function reserveLiveAttempt(pool: pg.Pool, config: AppConfig, args: {
  runId: string; fence: number; briefRevision: number; evidenceRevision?: number; requiredConsentPolicy?: string; logicalKey: string;
  kind: string; route: string; requestDigest: string; reserveMicro: number; modelPolicyId?: string; maxRunRouteAttempts?: number; historical?: boolean;
}): Promise<{ intentId: string; issue: boolean }> {
  return withTx(pool, async (db) => {
    const identity = await getRun(db, args.runId);
    if (!identity) throw new Error("missing_run");
    const account = await db.query("SELECT deleted_at FROM accounts WHERE id = $1 FOR UPDATE", [identity.account_id]);
    const run = await getRun(db, args.runId, { forUpdate: true });
    const consent = await currentConsent(db, identity.account_id);
    const lease = await db.query("SELECT fence FROM run_leases WHERE run_id = $1 AND expires_at > clock_timestamp()", [args.runId]);
    if (!run || account.rows[0]?.deleted_at || !consent || consent.revoked || consent.epoch !== run.consent_epoch ||
        (args.requiredConsentPolicy !== undefined && consent.policyVersion !== args.requiredConsentPolicy) ||
        run.lifecycle !== "running" || run.cancellation_epoch !== 0 || run.worker_lease_fence !== args.fence ||
        run.brief_revision !== args.briefRevision || (args.evidenceRevision !== undefined && (args.historical ? run.evidence_revision < args.evidenceRevision : run.evidence_revision !== args.evidenceRevision)) || Number(lease.rows[0]?.fence) !== args.fence) {
      throw new Error("stale_or_unauthorized_attempt");
    }
    if (!await guestExecutionAllowed(db, args.runId, identity.account_id)) throw new Error("stale_or_unauthorized_attempt");
    const prior = await db.query<{ id: string; request_digest: string }>(`SELECT i.id, a.request_digest
      FROM run_actions a JOIN provider_intents i ON i.action_id = a.id
      WHERE a.run_id = $1 AND a.logical_key = $2`, [args.runId, args.logicalKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_digest !== args.requestDigest) throw new Error("logical_action_conflict");
      return { intentId: prior.rows[0].id, issue: false };
    }
    if (args.modelPolicyId) {
      await assertModelRouteHealthy(db, args.modelPolicyId);
      const route = await db.query("SELECT 1 FROM model_operation_routes WHERE run_id=$1 AND policy_id=$2 AND request_digest=$3 AND reserve_micro=$4", [args.runId,args.modelPolicyId,args.requestDigest,args.reserveMicro]);
      if (!route.rowCount) throw new Error("model_operation_route_required");
    }
    if(args.maxRunRouteAttempts!==undefined) {
      if(!Number.isSafeInteger(args.maxRunRouteAttempts)||args.maxRunRouteAttempts<1)throw new Error("invalid_route_attempt_limit");
      const count=await db.query("SELECT count(*)::integer AS count FROM provider_intents WHERE run_id=$1 AND route=$2",[args.runId,args.route]);
      if(count.rows[0].count>=args.maxRunRouteAttempts)throw new Error("route_attempt_limit");
    }
    const allowance = await db.query<{ amount_micro: string }>(
      "SELECT amount_micro FROM reservations WHERE run_id = $1 AND account_id = $2 AND state = 'reserved' FOR UPDATE",
      [args.runId, run.account_id]);
    const reservation = allowance.rows[0];
    if (!reservation || allowance.rows.length !== 1) throw new Error("missing_active_run_allowance");
    const costs = await db.query<{ used: string }>(`SELECT COALESCE(SUM(
       CASE
         WHEN confirmed_micro IS NOT NULL THEN confirmed_micro
         WHEN state IN ('issued', 'outcome-unknown') THEN reserved_max_micro
         ELSE 0
       END
     ), 0)::text AS used
      FROM provider_intents WHERE run_id = $1 AND route LIKE 'openrouter:%'`, [args.runId]);
    const used = Number(costs.rows[0]?.used ?? 0);
    const runCap = Math.min(run.budget_micro, Number(reservation.amount_micro));
    if (!canIssueLiveCall({ capMicro: runCap, usedMicro: used, estimatedMicro: args.reserveMicro }).ok) {
      throw new Error("run_spend_cap_exhausted");
    }
    const leftover = reserveOperationBudget({
      hierarchy: {
        accountRemainingMicro: Math.max(0, config.liveSpendCapMicro - await liveSpendUsedMicro(db, config.liveBudgetScope)),
        runRemainingMicro: Math.max(0, runCap - used),
        reservedVerificationMicro: 0,
        reservedWritingMicro: 0,
      },
      operationClass: operationClassFor(args.kind),
      attemptReserveMicro: args.reserveMicro,
      runBudgetMicro: run.budget_micro,
    });
    if (!leftover.ok) throw new Error(leftover.reason);
    if (!config.openRouterApiKey?.trim()) throw new Error("missing_provider_key");
    const keyScope = createHash("sha256").update(`openrouter:${config.openRouterApiKey.trim()}`).digest("hex");
    // Unbound legacy receipt mutations take this lock exclusively because they affect every key.
    await db.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('provider-budget-legacy', 0))");
    // Key lock precedes project lock for every issuer, including different accounts/projects.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`provider-key-budget:${keyScope}`]);
    if ((await db.query(`SELECT 1 FROM provider_intents WHERE route LIKE 'openrouter:%'
      AND (provider_key_scope=$1 OR provider_key_scope IS NULL) AND confirmed_micro > reserved_max_micro LIMIT 1`, [keyScope])).rowCount)
      throw new Error("provider_overrun_requires_review");
    const keyCosts = await db.query<{ used: string }>(`SELECT COALESCE(SUM(
       CASE
         WHEN confirmed_micro IS NOT NULL THEN confirmed_micro
         WHEN state IN ('issued', 'outcome-unknown') THEN reserved_max_micro
         ELSE 0
       END
     ), 0)::text AS used
      FROM provider_intents WHERE route LIKE 'openrouter:%' AND (provider_key_scope = $1 OR provider_key_scope IS NULL)`, [keyScope]);
    if (!canIssueLiveCall({ capMicro: config.liveKeySpendCapMicro ?? 0, usedMicro: Number(keyCosts.rows[0]?.used ?? 0), estimatedMicro: args.reserveMicro }).ok) {
      throw new Error("provider_key_cap_exhausted");
    }
    const scope = config.liveBudgetScope ?? "project";
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`provider-budget:${scope}`]);
    await assertLiveCallAllowed(db, config, args.reserveMicro);
    // Budget locks can wait beyond the lease checked above. Account/run rows
    // remain locked, but time still advances: revalidate at the issuance boundary.
    const currentLease = await db.query("SELECT 1 FROM run_leases WHERE run_id = $1 AND fence = $2 AND expires_at > clock_timestamp()", [args.runId, args.fence]);
    if (currentLease.rowCount !== 1 || !await guestExecutionAllowed(db, args.runId, identity.account_id))
      throw new Error("stale_or_unauthorized_attempt");
    const actionId = crypto.randomUUID();
    const intentId = crypto.randomUUID();
    await db.query(`INSERT INTO run_actions (id, run_id, brief_revision, logical_key, kind, request_digest)
      VALUES ($1,$2,$3,$4,$5,$6)`, [actionId, args.runId, args.briefRevision, args.logicalKey, args.kind, args.requestDigest]);
    await db.query(`INSERT INTO provider_intents (id, run_id, correlation_id, route, request_digest, reserved_max_micro, state, action_id, scope_key, provider_key_scope)
      VALUES ($1,$2,$8,$3,$4,$5,'issued',$6,$7,$9)`, [intentId, args.runId, args.route, args.requestDigest, args.reserveMicro, actionId, scope, intentId, keyScope]);
    // INSERTs can themselves block. Roll back the entire action/intent if the
    // lease expired during that wait; no caller may dispatch from this attempt.
    const finalLease = await db.query("SELECT 1 FROM run_leases WHERE run_id = $1 AND fence = $2 AND expires_at > clock_timestamp()", [args.runId, args.fence]);
    if (finalLease.rowCount !== 1 || !await guestExecutionAllowed(db, args.runId, identity.account_id))
      throw new Error("stale_or_unauthorized_attempt");
    return { intentId, issue: true };
  });
}

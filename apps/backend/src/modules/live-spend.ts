import { LIVE_CALL_RESERVE_MICRO } from "@deep/contracts";
import type { Queryable } from "../platform/db.js";
import type { AppConfig } from "../platform/config.js";
import type pg from "pg";
import { withTx } from "../platform/db.js";
import { getRun } from "./runs.js";
import { currentConsent } from "./access.js";

/** Sum issued/confirmed/unknown live-provider reservations. Unknown is not treated as zero. */
export async function liveSpendUsedMicro(db: Queryable, scope = "project"): Promise<number> {
  const res = await db.query<{ used: string }>(
    `SELECT COALESCE(SUM(
       CASE
         WHEN confirmed_micro IS NOT NULL THEN confirmed_micro
         WHEN state IN ('issued', 'confirmed', 'outcome-unknown', 'failed') THEN reserved_max_micro
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
  runId: string; fence: number; briefRevision: number; logicalKey: string;
  kind: string; route: string; requestDigest: string; reserveMicro: number;
}): Promise<{ intentId: string; issue: boolean }> {
  return withTx(pool, async (db) => {
    const identity = await getRun(db, args.runId);
    if (!identity) throw new Error("missing_run");
    const account = await db.query("SELECT deleted_at FROM accounts WHERE id = $1 FOR UPDATE", [identity.account_id]);
    const run = await getRun(db, args.runId, { forUpdate: true });
    const consent = await currentConsent(db, identity.account_id);
    const lease = await db.query("SELECT fence FROM run_leases WHERE run_id = $1 AND expires_at > now()", [args.runId]);
    if (!run || account.rows[0]?.deleted_at || !consent || consent.revoked || consent.epoch !== run.consent_epoch ||
        run.lifecycle !== "running" || run.cancellation_epoch !== 0 || run.worker_lease_fence !== args.fence ||
        run.brief_revision !== args.briefRevision || Number(lease.rows[0]?.fence) !== args.fence) {
      throw new Error("stale_or_unauthorized_attempt");
    }
    const prior = await db.query<{ id: string; request_digest: string }>(`SELECT i.id, a.request_digest
      FROM run_actions a JOIN provider_intents i ON i.action_id = a.id
      WHERE a.run_id = $1 AND a.logical_key = $2`, [args.runId, args.logicalKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_digest !== args.requestDigest) throw new Error("logical_action_conflict");
      return { intentId: prior.rows[0].id, issue: false };
    }
    const allowance = await db.query<{ amount_micro: string }>(
      "SELECT amount_micro FROM reservations WHERE run_id = $1 AND account_id = $2 AND state = 'reserved' FOR UPDATE",
      [args.runId, run.account_id]);
    const reservation = allowance.rows[0];
    if (!reservation || allowance.rows.length !== 1) throw new Error("missing_active_run_allowance");
    const costs = await db.query<{ used: string }>(`SELECT COALESCE(SUM(COALESCE(confirmed_micro, reserved_max_micro)), 0)::text AS used
      FROM provider_intents WHERE run_id = $1 AND route LIKE 'openrouter:%'`, [args.runId]);
    const used = Number(costs.rows[0]?.used ?? 0);
    const runCap = Math.min(run.budget_micro, Number(reservation.amount_micro));
    if (!canIssueLiveCall({ capMicro: runCap, usedMicro: used, estimatedMicro: args.reserveMicro }).ok) {
      throw new Error("run_spend_cap_exhausted");
    }
    const scope = config.liveBudgetScope ?? "project";
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`provider-budget:${scope}`]);
    await assertLiveCallAllowed(db, config, args.reserveMicro);
    const actionId = crypto.randomUUID();
    const intentId = crypto.randomUUID();
    await db.query(`INSERT INTO run_actions (id, run_id, brief_revision, logical_key, kind, request_digest)
      VALUES ($1,$2,$3,$4,$5,$6)`, [actionId, args.runId, args.briefRevision, args.logicalKey, args.kind, args.requestDigest]);
    await db.query(`INSERT INTO provider_intents (id, run_id, correlation_id, route, request_digest, reserved_max_micro, state, action_id, scope_key)
      VALUES ($1,$2,$8,$3,$4,$5,'issued',$6,$7)`, [intentId, args.runId, args.route, args.requestDigest, args.reserveMicro, actionId, scope, intentId]);
    return { intentId, issue: true };
  });
}

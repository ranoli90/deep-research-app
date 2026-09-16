import { LIVE_CALL_RESERVE_MICRO } from "@deep/contracts";
import type { Queryable } from "../platform/db.js";
import type { AppConfig } from "../platform/config.js";

/** Sum issued/confirmed/unknown live-provider reservations. Unknown is not treated as zero. */
export async function liveSpendUsedMicro(db: Queryable): Promise<number> {
  const res = await db.query<{ used: string }>(
    `SELECT COALESCE(SUM(
       CASE
         WHEN confirmed_micro IS NOT NULL THEN confirmed_micro
         WHEN state IN ('issued', 'outcome-unknown') THEN reserved_max_micro
         ELSE 0
       END
     ), 0)::text AS used
     FROM provider_intents
     WHERE route LIKE 'openrouter:%'`,
  );
  return Number(res.rows[0]?.used ?? 0);
}

export function canIssueLiveCall(args: {
  capMicro: number;
  usedMicro: number;
  estimatedMicro?: number;
}): { ok: boolean; remainingMicro: number; reason?: string } {
  const estimated = args.estimatedMicro ?? LIVE_CALL_RESERVE_MICRO;
  const remaining = args.capMicro - args.usedMicro;
  if (args.capMicro <= 0) return { ok: false, remainingMicro: remaining, reason: "live_spend_cap_zero" };
  if (remaining < estimated) return { ok: false, remainingMicro: remaining, reason: "live_spend_cap_exhausted" };
  return { ok: true, remainingMicro: remaining };
}

export async function assertLiveCallAllowed(db: Queryable, config: AppConfig, estimatedMicro = LIVE_CALL_RESERVE_MICRO) {
  const used = await liveSpendUsedMicro(db);
  const gate = canIssueLiveCall({ capMicro: config.liveSpendCapMicro, usedMicro: used, estimatedMicro });
  if (!gate.ok) {
    const err = Object.assign(new Error(gate.reason ?? "live_spend_blocked"), { code: gate.reason, remainingMicro: gate.remainingMicro, usedMicro: used });
    throw err;
  }
  return { usedMicro: used, remainingMicro: gate.remainingMicro };
}

import type pg from "pg";
import { withTx } from "./db.js";

/**
 * Staging-only activation of the server-owned new-member trial (R03/R02).
 *
 * The migration default is default-deny (`enabled=false`, `killed=true`,
 * expired). This helper is the ONLY code path that enables the policy, it is
 * explicitly gated on `ENABLE_STAGING_TRIAL=1`, and it never changes the
 * migration default. The credited amount still comes only from the policy row:
 * no caller amount is trusted, and production stays default-deny unless an
 * operator runs this against a staging database on purpose.
 *
 * The window is 48h from first activation. Re-running while the policy is
 * already active never extends the window or rewrites the row, so activation
 * is idempotent. The policy row's `created_at` records the activation time.
 */
export const STAGING_TRIAL_POLICY_ID = "norrow-new-member-trial.v1";
export const STAGING_TRIAL_AMOUNT_MICRO = 100_000;
export const STAGING_TRIAL_EXPOSURE_CAP_MICRO = 500_000;
export const STAGING_TRIAL_WINDOW_MS = 48 * 60 * 60 * 1000;

export type StagingTrialActivation = {
  policyId: string;
  /** True only when this call performed the inactive-to-active transition. */
  activated: boolean;
  /** True when the policy was already active and was left untouched. */
  reused: boolean;
  amountMicro: number;
  exposureCapMicro: number;
  /** Activation time: the policy row's created_at for the active generation. */
  activatedAt: string;
  expiresAt: string;
};

/** The explicit staging gate. Anything other than the exact "1" refuses. */
export function stagingTrialActivationAuthorized(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_STAGING_TRIAL === "1";
}

/**
 * Idempotently enable the staging trial policy row. Refuses (before any query)
 * unless the explicit gate is set. The global ledger is deliberately NOT reset:
 * prior reservations/settlements keep the approved exposure cap honest.
 */
export async function activateStagingTrial(
  pool: pg.Pool,
  options: { env?: NodeJS.ProcessEnv; now?: Date } = {},
): Promise<StagingTrialActivation> {
  const env = options.env ?? process.env;
  if (!stagingTrialActivationAuthorized(env)) {
    throw new Error(
      "Refusing to enable the new-member trial: set ENABLE_STAGING_TRIAL=1 explicitly. " +
        "This command is staging-only; production stays default-deny.",
    );
  }
  const now = options.now ?? new Date();
  return withTx(pool, async (db) => {
    const row = (await db.query<{
      enabled: boolean; killed: boolean; expires_at: Date; created_at: Date;
      amount_micro: string; exposure_cap_micro: string;
    }>(
      "SELECT enabled,killed,expires_at,created_at,amount_micro,exposure_cap_micro FROM new_member_trial_policies WHERE id=$1 FOR UPDATE",
      [STAGING_TRIAL_POLICY_ID],
    )).rows[0];
    if (!row) throw new Error("Trial policy row is missing; run pnpm db:migrate first.");
    const wasActive = row.enabled && !row.killed && row.expires_at.getTime() > now.getTime();
    const valuesMatch = Number(row.amount_micro) === STAGING_TRIAL_AMOUNT_MICRO &&
      Number(row.exposure_cap_micro) === STAGING_TRIAL_EXPOSURE_CAP_MICRO;
    // Re-running while the policy already holds the exact staging values is a
    // true no-op: the 48h window is never extended.
    if (wasActive && valuesMatch) {
      return {
        policyId: STAGING_TRIAL_POLICY_ID, activated: false, reused: true,
        amountMicro: Number(row.amount_micro), exposureCapMicro: Number(row.exposure_cap_micro),
        activatedAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
      };
    }
    // Inactive/expired: activate now with a fresh 48h window. Active but with
    // drifted values: converge to the staging values without extending the
    // existing window or activation time.
    const activatedAt = wasActive ? row.created_at : now;
    const expiresAt = wasActive ? row.expires_at : new Date(now.getTime() + STAGING_TRIAL_WINDOW_MS);
    await db.query(
      `UPDATE new_member_trial_policies SET enabled=true,killed=false,amount_micro=$2,
       exposure_cap_micro=$3,expires_at=$4,created_at=$5 WHERE id=$1`,
      [STAGING_TRIAL_POLICY_ID, STAGING_TRIAL_AMOUNT_MICRO, STAGING_TRIAL_EXPOSURE_CAP_MICRO, expiresAt, activatedAt],
    );
    return {
      policyId: STAGING_TRIAL_POLICY_ID, activated: !wasActive, reused: false,
      amountMicro: STAGING_TRIAL_AMOUNT_MICRO, exposureCapMicro: STAGING_TRIAL_EXPOSURE_CAP_MICRO,
      activatedAt: activatedAt.toISOString(), expiresAt: expiresAt.toISOString(),
    };
  });
}

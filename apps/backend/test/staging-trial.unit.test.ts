import { describe, expect, it } from "vitest";
import type pg from "pg";
import {
  STAGING_TRIAL_AMOUNT_MICRO,
  STAGING_TRIAL_EXPOSURE_CAP_MICRO,
  STAGING_TRIAL_POLICY_ID,
  STAGING_TRIAL_WINDOW_MS,
  activateStagingTrial,
  stagingTrialActivationAuthorized,
} from "../src/platform/staging-trial.js";

const now = new Date("2026-09-22T00:00:00.000Z");

function fakePool(rows: Array<Record<string, unknown>>, onQuery?: (sql: string) => void) {
  const calls: string[] = [];
  const client = {
    query: async (sql: string) => {
      calls.push(sql);
      onQuery?.(sql);
      if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK")) return { rows: [] };
      if (sql.includes("SELECT enabled,killed")) return { rows };
      return { rows: [] };
    },
    release: () => undefined,
  };
  return { pool: { connect: async () => client } as unknown as pg.Pool, calls };
}

describe("staging new-member trial activation", () => {
  it("refuses without the exact explicit gate and never touches the database", async () => {
    expect(stagingTrialActivationAuthorized({})).toBe(false);
    expect(stagingTrialActivationAuthorized({ ENABLE_STAGING_TRIAL: "0" })).toBe(false);
    expect(stagingTrialActivationAuthorized({ ENABLE_STAGING_TRIAL: "true" })).toBe(false);
    expect(stagingTrialActivationAuthorized({ ENABLE_STAGING_TRIAL: "1" })).toBe(true);
    const pool = { connect: () => { throw new Error("database must not be touched"); } } as unknown as pg.Pool;
    await expect(activateStagingTrial(pool, { env: {} })).rejects.toThrow("ENABLE_STAGING_TRIAL=1");
    await expect(activateStagingTrial(pool, { env: { ENABLE_STAGING_TRIAL: "0" } })).rejects.toThrow(
      "ENABLE_STAGING_TRIAL=1",
    );
  });

  it("activates the policy with the exact staging values and a 48h window", async () => {
    const { pool, calls } = fakePool([
      { enabled: false, killed: true, expires_at: new Date(0), created_at: new Date(0), amount_micro: "100000", exposure_cap_micro: "0" },
    ]);
    const result = await activateStagingTrial(pool, { env: { ENABLE_STAGING_TRIAL: "1" }, now });
    expect(result).toEqual({
      policyId: STAGING_TRIAL_POLICY_ID, activated: true, reused: false,
      amountMicro: STAGING_TRIAL_AMOUNT_MICRO, exposureCapMicro: STAGING_TRIAL_EXPOSURE_CAP_MICRO,
      activatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + STAGING_TRIAL_WINDOW_MS).toISOString(),
    });
    const update = calls.find((sql) => sql.includes("UPDATE new_member_trial_policies"));
    expect(update).toBeDefined();
    expect(update).toContain("enabled=true");
    expect(update).toContain("killed=false");
  });

  it("is idempotent: an already active policy is reused and never rewritten", async () => {
    const activeExpiry = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const { pool, calls } = fakePool([
      { enabled: true, killed: false, expires_at: activeExpiry, created_at: now, amount_micro: "100000", exposure_cap_micro: "500000" },
    ]);
    const result = await activateStagingTrial(pool, { env: { ENABLE_STAGING_TRIAL: "1" }, now });
    expect(result).toMatchObject({
      activated: false, reused: true, amountMicro: STAGING_TRIAL_AMOUNT_MICRO,
      exposureCapMicro: STAGING_TRIAL_EXPOSURE_CAP_MICRO, expiresAt: activeExpiry.toISOString(),
    });
    expect(calls.some((sql) => sql.includes("UPDATE new_member_trial_policies"))).toBe(false);
  });

  it("re-activates an expired policy without resetting the global ledger", async () => {
    const { pool, calls } = fakePool([
      { enabled: true, killed: false, expires_at: new Date(now.getTime() - 1000), created_at: new Date(0), amount_micro: "100000", exposure_cap_micro: "500000" },
    ]);
    const result = await activateStagingTrial(pool, { env: { ENABLE_STAGING_TRIAL: "1" }, now });
    expect(result.activated).toBe(true);
    expect(calls.some((sql) => sql.includes("new_member_trial_ledgers"))).toBe(false);
  });

  it("converges an active policy with drifted values without extending its window", async () => {
    const activeExpiry = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const { pool, calls } = fakePool([
      { enabled: true, killed: false, expires_at: activeExpiry, created_at: now, amount_micro: "999", exposure_cap_micro: "1" },
    ]);
    const result = await activateStagingTrial(pool, { env: { ENABLE_STAGING_TRIAL: "1" }, now });
    expect(result).toMatchObject({
      activated: false, reused: false,
      amountMicro: STAGING_TRIAL_AMOUNT_MICRO, exposureCapMicro: STAGING_TRIAL_EXPOSURE_CAP_MICRO,
      activatedAt: now.toISOString(), expiresAt: activeExpiry.toISOString(),
    });
    expect(calls.some((sql) => sql.includes("UPDATE new_member_trial_policies"))).toBe(true);
  });
});

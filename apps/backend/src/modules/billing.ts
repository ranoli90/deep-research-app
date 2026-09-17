import type { Queryable } from "../platform/db.js";

export async function reserveAllowance(
  db: Queryable,
  accountId: string,
  runId: string,
  amountMicro: number,
): Promise<{ reservationId: string }> {
  if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0) throw new Error("invalid_allowance_reservation");
  const row = await db.query<{ limit_micro: string; settled_micro: string; reserved_micro: string }>(
    `SELECT limit_micro, settled_micro, reserved_micro FROM allowance_accounts WHERE account_id = $1 FOR UPDATE`,
    [accountId],
  );
  const a = row.rows[0];
  if (!a) throw Object.assign(new Error("no allowance account"), { code: "allowance_exhausted" });
  const remaining = Number(a.limit_micro) - Number(a.settled_micro) - Number(a.reserved_micro);
  if (remaining < amountMicro) {
    throw Object.assign(new Error("allowance exhausted"), { code: "allowance_exhausted" });
  }
  await db.query(
    `UPDATE allowance_accounts SET reserved_micro = reserved_micro + $2 WHERE account_id = $1`,
    [accountId, amountMicro],
  );
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO reservations (id, account_id, run_id, amount_micro, state) VALUES ($1,$2,$3,$4,'reserved')`,
    [id, accountId, runId, amountMicro],
  );
  return { reservationId: id };
}

export async function settleRun(db: Queryable, accountId: string, runId: string, spentMicro: number): Promise<void> {
  // Caller owns the transaction. Match admission lock ordering before touching money.
  await db.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [accountId]);
  const run = await db.query<{ account_id: string; route_mode: string }>(
    "SELECT account_id, route_mode FROM runs WHERE id = $1 FOR UPDATE", [runId]);
  if (run.rows[0]?.account_id !== accountId) throw new Error("settlement_owner_mismatch");
  const res = await db.query<{ id: string; amount_micro: string; state: string }>(
    `SELECT id, amount_micro, state FROM reservations WHERE run_id = $1 AND account_id = $2 AND state = 'reserved' FOR UPDATE`,
    [runId, accountId],
  );
  if (res.rows.length > 1) throw new Error("duplicate_run_reservation");
  const r = res.rows[0];
  if (!r) return;
  let settle = spentMicro;
  if (run.rows[0].route_mode === "controlled-research") {
    const receipts = await db.query<{ confirmed: string; unknown: number }>(`SELECT
      COALESCE(SUM(confirmed_micro), 0)::text AS confirmed,
      COUNT(*) FILTER (WHERE confirmed_micro IS NULL)::int AS unknown
      FROM provider_intents WHERE run_id = $1 AND route LIKE 'openrouter:%'`, [runId]);
    // Hold the entire admitted allowance conservatively until every external outcome is known.
    // A retry of settlement after reconciliation releases it exactly once.
    const receipt = receipts.rows[0];
    if (!receipt) throw new Error("missing_receipt_aggregate");
    if (receipt.unknown > 0) return;
    settle = Number(receipt.confirmed);
  }
  const reserved = Number(r.amount_micro);
  if (![reserved, settle].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error("invalid_settlement_cost");
  // Actual provider overruns must be visible; never clamp receipts to the estimate.
  const account = await db.query(`UPDATE allowance_accounts
     SET reserved_micro = reserved_micro - $2, settled_micro = settled_micro + $3
     WHERE account_id = $1 AND reserved_micro >= $2`, [accountId, reserved, settle]);
  if (account.rowCount !== 1) throw new Error("allowance_accounting_invariant");
  await db.query(`UPDATE reservations SET state = 'settled' WHERE id = $1`, [r.id]);
  if (run.rows[0].route_mode === "controlled-research") {
    await db.query("UPDATE runs SET spent_micro = $2 WHERE id = $1", [runId, settle]);
  }
}

export async function recordIntent(
  db: Queryable,
  runId: string,
  args: { correlationId: string; route: string; digest: string; reserved: number; state: string },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO provider_intents (id, run_id, correlation_id, route, request_digest, reserved_max_micro, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, runId, args.correlationId, args.route, args.digest, args.reserved, args.state],
  );
  return id;
}

/** Confirmed usage must not rewrite the historical estimate. */
export async function reconcileIntent(db: Queryable, intentId: string, confirmedMicro: number): Promise<void> {
  await updateIntentState(db, intentId, "confirmed", confirmedMicro);
}

/** After issuance, settle the intent without clearing the reservation on unknown/failed. */
export async function updateIntentState(
  db: Queryable,
  intentId: string,
  state: string,
  confirmedMicro?: number,
): Promise<void> {
  if (confirmedMicro != null) {
    if (!Number.isSafeInteger(confirmedMicro) || confirmedMicro < 0) throw new Error("invalid_provider_cost");
    const result = await db.query(`UPDATE provider_intents SET state = $2, confirmed_micro = $3 WHERE id = $1
      AND (confirmed_micro IS NULL OR confirmed_micro = $3)`, [
      intentId,
      state,
      confirmedMicro,
    ]);
    if (result.rowCount !== 1) throw new Error("conflicting_or_missing_provider_receipt");
    return;
  }
  await db.query(`UPDATE provider_intents SET state = $2 WHERE id = $1 AND confirmed_micro IS NULL`, [intentId, state]);
}

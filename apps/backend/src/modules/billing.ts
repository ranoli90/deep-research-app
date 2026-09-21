import pg from "pg";
import { withTx, type Queryable } from "../platform/db.js";

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
  if (db instanceof pg.Pool) return withTx(db, (client) => settleRun(client, accountId, runId, spentMicro));
  // Match admission lock ordering before touching money.
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
  const sponsor = (await db.query<{ policy_id: string; amount_micro: string; state: "reserved" | "held" | "settled" }>(
    `SELECT policy_id,amount_micro,state FROM guest_sponsor_reservations
     WHERE run_id=$1 AND reservation_id=$2 FOR UPDATE`, [runId, r.id])).rows[0];
  if (sponsor && Number(sponsor.amount_micro) !== Number(r.amount_micro)) throw new Error("sponsor_reservation_mismatch");
  let settle = spentMicro;
  if (run.rows[0].route_mode === "controlled-research") {
    const receipts = await db.query<{ confirmed: string; unknown: number }>(`SELECT
      COALESCE(SUM(confirmed_micro), 0)::text AS confirmed,
      COUNT(*) FILTER (WHERE confirmed_micro IS NULL AND state IN ('issued', 'outcome-unknown'))::int AS unknown
      FROM provider_intents WHERE run_id = $1 AND route LIKE 'openrouter:%'`, [runId]);
    // Hold the entire admitted allowance conservatively until every external outcome is known.
    // A retry of settlement after reconciliation releases it exactly once.
    const receipt = receipts.rows[0];
    if (!receipt) throw new Error("missing_receipt_aggregate");
    if (receipt.unknown > 0) {
      if (sponsor?.state === "reserved") {
        const held = await db.query(`UPDATE guest_sponsor_ledgers SET reserved_micro=reserved_micro-$2,
          held_micro=held_micro+$2,updated_at=now() WHERE policy_id=$1 AND reserved_micro >= $2`,
          [sponsor.policy_id, Number(r.amount_micro)]);
        if (held.rowCount !== 1) throw new Error("sponsor_hold_invariant");
        await db.query(`UPDATE guest_sponsor_reservations SET state='held',updated_at=now()
          WHERE run_id=$1 AND state='reserved'`, [runId]);
      }
      return;
    }
    settle = Number(receipt.confirmed);
  }
  const reserved = Number(r.amount_micro);
  if (![reserved, settle].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error("invalid_settlement_cost");
  if (sponsor) {
    if (sponsor.state === "settled") throw new Error("sponsor_settlement_invariant");
    const bucket = sponsor.state === "held" ? "held_micro" : "reserved_micro";
    const ledger = await db.query(`UPDATE guest_sponsor_ledgers
      SET ${bucket}=${bucket}-$2,settled_micro=settled_micro+$3,updated_at=now()
      WHERE policy_id=$1 AND ${bucket} >= $2`, [sponsor.policy_id, reserved, settle]);
    if (ledger.rowCount !== 1) throw new Error("sponsor_settlement_invariant");
    await db.query(`UPDATE guest_sponsor_reservations SET state='settled',settled_micro=$2,updated_at=now()
      WHERE run_id=$1 AND state=$3`, [runId, settle, sponsor.state]);
  }
  // Actual provider overruns must be visible; never clamp receipts to the estimate.
  const account = await db.query(`UPDATE allowance_accounts
     SET reserved_micro = reserved_micro - $2, settled_micro = settled_micro + $3
     WHERE account_id = $1 AND reserved_micro >= $2`, [accountId, reserved, settle]);
  if (account.rowCount !== 1) throw new Error("allowance_accounting_invariant");
  await db.query(`UPDATE reservations SET state = 'settled', settled_micro = $2, settlement_basis = $3 WHERE id = $1`,
    [r.id, settle, run.rows[0].route_mode === "controlled-research" ? "provider_receipts_v1" : "fixture_tariff_v1"]);
  if (run.rows[0].route_mode === "controlled-research") {
    await db.query("UPDATE runs SET spent_micro = $2 WHERE id = $1", [runId, settle]);
  }
}

/** Remaining budget after confirmed spend and outstanding issued/unknown reserves. Failed-null receipts are not holds. */
export async function loadRunFinancialRemaining(db: Queryable, args: { runId: string; accountId: string }): Promise<number> {
  const row = await db.query<{ budget_micro: string; spent_micro: string; held_micro: string }>(
    `SELECT r.budget_micro, r.spent_micro,
       COALESCE((SELECT SUM(i.reserved_max_micro) FROM provider_intents i
         WHERE i.run_id=r.id AND i.confirmed_micro IS NULL AND i.state IN ('issued','outcome-unknown')),0) AS held_micro
     FROM runs r WHERE r.id=$1 AND r.account_id=$2`,
    [args.runId, args.accountId],
  );
  const financial = row.rows[0];
  if (!financial) throw new Error("run_financial_owner_mismatch");
  return Math.max(0, Number(financial.budget_micro) - Number(financial.spent_micro) - Number(financial.held_micro));
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
  if (db instanceof pg.Pool) return withTx(db, (client) => updateIntentState(client, intentId, state, confirmedMicro));
  if (!["issued", "confirmed", "outcome-unknown", "failed"].includes(state)) throw new Error("invalid_provider_state");
  if (confirmedMicro != null && state !== "confirmed" && !(state === "failed" && confirmedMicro === 0)) {
    throw new Error("invalid_provider_receipt_state");
  }
  const identity = await db.query<{ run_id: string; route: string; account_id: string | null; provider_key_scope: string | null; scope_key: string }>(`SELECT i.run_id, i.route, r.account_id, i.provider_key_scope, i.scope_key
    FROM provider_intents i LEFT JOIN runs r ON r.id = i.run_id WHERE i.id = $1`, [intentId]);
  const intent = identity.rows[0];
  if (!intent) throw new Error("conflicting_or_missing_provider_receipt");
  let deleted = false;
  let run: { lifecycle: string; route_mode: string } | undefined;
  if (intent.account_id) {
    const account = await db.query<{ deleted_at: Date | null }>("SELECT deleted_at FROM accounts WHERE id = $1 FOR UPDATE", [intent.account_id]);
    deleted = account.rows[0]?.deleted_at != null;
    run = (await db.query<{ lifecycle: string; route_mode: string }>("SELECT lifecycle, route_mode FROM runs WHERE id = $1 FOR UPDATE", [intent.run_id])).rows[0];
  }
  if (confirmedMicro != null) {
    if (!Number.isSafeInteger(confirmedMicro) || confirmedMicro < 0) throw new Error("invalid_provider_cost");
    if (intent.route.startsWith("openrouter:")) {
      // Legacy unbound receipts affect every key. Lock order matches issuance after account/run locks.
      await db.query(intent.provider_key_scope === null
        ? "SELECT pg_advisory_xact_lock(hashtextextended('provider-budget-legacy', 0))"
        : "SELECT pg_advisory_xact_lock_shared(hashtextextended('provider-budget-legacy', 0))");
      if (intent.provider_key_scope !== null) await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`provider-key-budget:${intent.provider_key_scope}`]);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`provider-budget:${intent.scope_key}`]);
    }
    const result = await db.query(`UPDATE provider_intents SET state = $2, confirmed_micro = $3 WHERE id = $1
      AND (confirmed_micro IS NULL OR confirmed_micro = $3)`, [intentId, state, confirmedMicro]);
    if (result.rowCount !== 1) throw new Error("conflicting_or_missing_provider_receipt");
    if (run?.route_mode === "controlled-research" && intent.route.startsWith("openrouter:")) {
      await db.query(`UPDATE runs SET spent_micro = (SELECT COALESCE(SUM(confirmed_micro),0)
        FROM provider_intents WHERE run_id = $1 AND route LIKE 'openrouter:%') WHERE id = $1`, [intent.run_id]);
      // Recording already-incurred cost grants no permission to process private data or resend a request.
      if (intent.account_id && (run.lifecycle === "terminal" || deleted)) await settleRun(db, intent.account_id, intent.run_id, 0);
    }
    return;
  }
  await db.query(`UPDATE provider_intents SET state = $2 WHERE id = $1 AND confirmed_micro IS NULL`, [intentId, state]);
}

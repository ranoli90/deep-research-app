import pg from "pg";
import { withTx } from "../platform/db.js";
import { FIXTURE_TARIFF_VERSION } from "@deep/contracts";
import type { Queryable } from "../platform/db.js";
import { getRun } from "./runs.js";

export type RunCost = {
  runId: string;
  accountId: string;
  routeMode: string;
  spentMicro: number;
  confirmedProviderMicro: number;
  heldProviderMicro: number;
  unknownProviderIntents: number;
  simulatedFixtureMicro: number;
  allowanceReconciled: boolean;
  costScope: "provider_receipts_only" | "fixture_simulation";
  reservationAmountMicro: number;
  reservationState: string | null;
  breakdown: { search: number; fetch: number; synthesize: number; other: number };
  /** Confirmed plus unresolved exposure for live routes; simulated tariff for fixture routes. */
  intentTotalMicro: number;
  /** Provider/run ledger consistency only; allowanceReconciled is a separate settlement check. */
  reconciled: boolean;
  tariffVersion: string | null;
  effectiveProcessor: string;
};

function bucket(route: string): keyof RunCost["breakdown"] {
  if (/search/i.test(route)) return "search";
  if (/fetch/i.test(route)) return "fetch";
  if (/synth/i.test(route)) return "synthesize";
  return "other";
}

function intentMicro(row: { reserved_max_micro: string; confirmed_micro: string | null; state: string }): number {
  if (row.confirmed_micro != null) return Number(row.confirmed_micro);
  if (row.state === "outcome-unknown" || row.state === "issued" || row.state === "confirmed") {
    return Number(row.reserved_max_micro);
  }
  return Number(row.reserved_max_micro);
}

export async function measureRunCost(db: Queryable, runId: string, accountId: string): Promise<RunCost | null> {
  if (db instanceof pg.Pool) return withTx(db, async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return measureRunCost(client, runId, accountId);
  });
  const run = await getRun(db, runId);
  if (!run || run.account_id !== accountId) return null;
  const intents = await db.query<{ route: string; reserved_max_micro: string; confirmed_micro: string | null; state: string }>(
    `SELECT route, reserved_max_micro::text, confirmed_micro::text, state FROM provider_intents WHERE run_id = $1`,
    [runId],
  );
  const breakdown = { search: 0, fetch: 0, synthesize: 0, other: 0 };
  const live = run.route_mode === "controlled-research";
  const selected = intents.rows.filter((row) => live ? row.route.startsWith("openrouter:") : row.route.startsWith("fixture:"));
  const provider = selected.filter((row) => row.route.startsWith("openrouter:"));
  const confirmedProviderMicro = provider.reduce((sum, row) => sum + Number(row.confirmed_micro ?? 0), 0);
  const unresolved = provider.filter((row) => row.confirmed_micro == null);
  const heldProviderMicro = unresolved.reduce((sum, row) => sum + Number(row.reserved_max_micro), 0);
  for (const row of selected) {
    breakdown[bucket(row.route)] += intentMicro(row);
  }
  const intentTotalMicro = breakdown.search + breakdown.fetch + breakdown.synthesize + breakdown.other;
  const resv = await db.query<{ amount_micro: string; state: string; settled_micro: string | null; settlement_basis: string | null }>(
    `SELECT amount_micro::text, state, settled_micro::text, settlement_basis FROM reservations WHERE run_id = $1`,
    [runId],
  );
  const reservation = resv.rows[0];
  return {
    runId,
    accountId,
    routeMode: run.route_mode,
    spentMicro: live ? confirmedProviderMicro : run.spent_micro,
    confirmedProviderMicro,
    heldProviderMicro,
    unknownProviderIntents: unresolved.length,
    simulatedFixtureMicro: live ? 0 : intentTotalMicro,
    allowanceReconciled: reservation?.state === "settled" && reservation.settled_micro != null && unresolved.length === 0 &&
      Number(reservation.settled_micro) === (live ? confirmedProviderMicro : run.spent_micro) &&
      reservation.settlement_basis === (live ? "provider_receipts_v1" : "fixture_tariff_v1"),
    costScope: live ? "provider_receipts_only" : "fixture_simulation",
    reservationAmountMicro: reservation ? Number(reservation.amount_micro) : 0,
    reservationState: reservation?.state ?? null,
    breakdown,
    intentTotalMicro,
    reconciled: unresolved.length === 0 && intentTotalMicro === run.spent_micro,
    tariffVersion: run.route_mode === "fixture" ? FIXTURE_TARIFF_VERSION : null,
    effectiveProcessor: run.route_mode === "fixture" ? "app-owned-fixture-catalog" : "openrouter",
  };
}

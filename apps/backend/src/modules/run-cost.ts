import { FIXTURE_TARIFF_VERSION } from "@deep/contracts";
import type { Queryable } from "../platform/db.js";
import { getRun } from "./runs.js";

export type RunCost = {
  runId: string;
  accountId: string;
  routeMode: string;
  spentMicro: number;
  reservationAmountMicro: number;
  reservationState: string | null;
  breakdown: { search: number; fetch: number; synthesize: number; other: number };
  intentTotalMicro: number;
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
  const run = await getRun(db, runId);
  if (!run || run.account_id !== accountId) return null;
  const intents = await db.query<{ route: string; reserved_max_micro: string; confirmed_micro: string | null; state: string }>(
    `SELECT route, reserved_max_micro::text, confirmed_micro::text, state FROM provider_intents WHERE run_id = $1`,
    [runId],
  );
  const breakdown = { search: 0, fetch: 0, synthesize: 0, other: 0 };
  for (const row of intents.rows) {
    breakdown[bucket(row.route)] += intentMicro(row);
  }
  const intentTotalMicro = breakdown.search + breakdown.fetch + breakdown.synthesize + breakdown.other;
  const resv = await db.query<{ amount_micro: string; state: string }>(
    `SELECT amount_micro::text, state FROM reservations WHERE run_id = $1`,
    [runId],
  );
  const reservation = resv.rows[0];
  return {
    runId,
    accountId,
    routeMode: run.route_mode,
    spentMicro: run.spent_micro,
    reservationAmountMicro: reservation ? Number(reservation.amount_micro) : 0,
    reservationState: reservation?.state ?? null,
    breakdown,
    intentTotalMicro,
    reconciled: intentTotalMicro === run.spent_micro,
    tariffVersion: run.route_mode === "fixture" ? FIXTURE_TARIFF_VERSION : null,
    effectiveProcessor: run.route_mode === "fixture" ? "app-owned-fixture-catalog" : "openrouter",
  };
}

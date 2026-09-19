import { createHash } from "node:crypto";
import type pg from "pg";
import { withTx, type Queryable } from "../platform/db.js";
import type { AppConfig } from "../platform/config.js";
import { GenerationReceiptSchema, type GenerationLookup } from "../ports/provider-receipt.js";
import { costToMicro } from "../ports/provider-cost.js";
import { STRUCTURED_MODEL_POLICY,modelPolicy } from "../ports/model-policy.js";
import { DISCOVERY_POLICY,DEEP_DISCOVERY_POLICY,AZURE_DISCOVERY_POLICY,AZURE_DEEP_DISCOVERY_POLICY,discoveryModelPolicy } from "../ports/search.js";
import { updateIntentState } from "./billing.js";

type Intent = { id: string; run_id: string; account_id: string; route: string; scope_key: string;
  provider_key_scope: string | null; model_policy_id:string; receipt: unknown; confirmed_micro: string | null };
function providerId(receipt: unknown): string | null {
  if (!receipt || typeof receipt !== "object" || !("providerId" in receipt)) return null;
  const value = receipt.providerId;
  return typeof value === "string" && value.length > 0 && value.length <= 300 && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
}
const keyScope = (key: string) => createHash("sha256").update(`openrouter:${key.trim()}`).digest("hex");
async function getIntent(db: Queryable, id: string): Promise<Intent | undefined> {
  return (await db.query<Intent>(`SELECT i.id,i.run_id,r.account_id,i.route,i.scope_key,i.provider_key_scope,i.receipt,r.model_policy_id,
    i.confirmed_micro::text FROM provider_intents i JOIN runs r ON r.id=i.run_id WHERE i.id=$1`, [id])).rows[0];
}
function lookupBasis(intent: Intent | undefined, config: AppConfig) {
  if (!intent || !config.openRouterApiKey?.trim() || intent.scope_key !== (config.liveBudgetScope ?? "project") ||
      intent.provider_key_scope !== keyScope(config.openRouterApiKey)) return null;
  // Unknown historical credential/route provenance requires operator evidence, never a guessed binding.
  if (!intent.route.startsWith(`openrouter:${STRUCTURED_MODEL_POLICY.model}:`)) return null;
  return providerId(intent.receipt);
}

/** Lookup runs outside locks; only financial settlement may proceed after cancellation/deletion. */
export async function reconcileProviderIntent(pool: pg.Pool, config: AppConfig, intentId: string,
  lookup: (args: { providerId: string; apiKey: string; signal: AbortSignal }) => Promise<GenerationLookup>, signal: AbortSignal) {
  const before = await getIntent(pool, intentId), id = lookupBasis(before, config);
  if (!before || !id) return { kind: "unavailable" as const, reason: "receipt_provenance_unavailable" };
  const result = await lookup({ providerId: id, apiKey: config.openRouterApiKey!, signal });
  if (result.kind !== "receipt") return result;
  const receipt = GenerationReceiptSchema.parse(result.receipt);
  const searchPolicy=[DISCOVERY_POLICY,DEEP_DISCOVERY_POLICY,AZURE_DISCOVERY_POLICY,AZURE_DEEP_DISCOVERY_POLICY].find(p=>before.route===`openrouter:${p.model}:${p.id}`);
  const policy = searchPolicy ? discoveryModelPolicy(searchPolicy.id) : modelPolicy(before.model_policy_id);
  if (receipt.providerId !== id || receipt.model !== STRUCTURED_MODEL_POLICY.model || receipt.provider !== policy.providerName ||
      costToMicro(receipt.rawCost) !== receipt.actualMicro) throw new Error("receipt_route_or_cost_mismatch");
  return withTx(pool, async db => {
    await db.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [before.account_id]);
    await db.query("SELECT id FROM runs WHERE id=$1 FOR UPDATE", [before.run_id]);
    const current = await getIntent(db, intentId);
    if (!current || current.run_id !== before.run_id || current.account_id !== before.account_id || lookupBasis(current, config) !== id)
      throw new Error("receipt_basis_changed");
    const existing = (await db.query<{ receipt: unknown }>("SELECT receipt FROM provider_receipt_reconciliations WHERE intent_id=$1", [intentId])).rows[0];
    if (existing) {
      const saved = GenerationReceiptSchema.parse(existing.receipt);
      if (saved.providerId !== id || saved.actualMicro !== receipt.actualMicro || saved.model !== receipt.model || saved.provider !== receipt.provider)
        throw new Error("conflicting_provider_reconciliation");
    } else {
      await db.query(`INSERT INTO provider_receipt_reconciliations(intent_id,provider_id,provider_key_scope,receipt)
        VALUES($1,$2,$3,$4)`, [intentId, id, current.provider_key_scope, JSON.stringify(receipt)]);
    }
    // Do not alter original model/search receipt or cached result: financial recovery is not semantic proof.
    await updateIntentState(db, intentId, "confirmed", receipt.actualMicro);
    return { kind: "reconciled" as const, intentId, actualMicro: receipt.actualMicro, reused: Boolean(existing) };
  });
}

function hasCostReceipt(raw: unknown, amount: number): boolean {
  if (!raw || typeof raw !== "object" || !("actualMicro" in raw) || !("rawCost" in raw)) return false;
  return raw.actualMicro === amount && costToMicro(raw.rawCost) === amount && providerId(raw) !== null;
}

/** Repair only demonstrable legacy estimate-as-confirmed rows, with known settlement amounts. */
export async function repairHistoricalAccounting(pool: pg.Pool, runId: string, accountId: string) {
  return withTx(pool, async db => {
    await db.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [accountId]);
    const run = (await db.query("SELECT account_id,lifecycle,route_mode FROM runs WHERE id=$1 FOR UPDATE", [runId])).rows[0];
    if (!run || run.account_id !== accountId) throw new Error("accounting_owner_mismatch");
    if (run.route_mode !== "controlled-research" || run.lifecycle !== "terminal") throw new Error("accounting_repair_requires_terminal_live_run");
    const intents = (await db.query(`SELECT i.id,i.state,i.confirmed_micro::text,i.reserved_max_micro::text,i.receipt,
      r.receipt AS recovered_receipt FROM provider_intents i LEFT JOIN provider_receipt_reconciliations r ON r.intent_id=i.id
      WHERE i.run_id=$1 AND i.route LIKE 'openrouter:%' ORDER BY i.id FOR UPDATE OF i`, [runId])).rows;
    if (intents.some(i => [i.reserved_max_micro, i.confirmed_micro].filter(v => v !== null)
      .some(v => !Number.isSafeInteger(Number(v)) || Number(v) < 0)))
      return { kind: "blocked" as const, reason: "historical_cost_out_of_range" };
    const unbacked = intents.filter(i => i.confirmed_micro !== null &&
      !hasCostReceipt(i.receipt, Number(i.confirmed_micro)) && !hasCostReceipt(i.recovered_receipt, Number(i.confirmed_micro)));
    if (!unbacked.length) return { kind: "unchanged" as const, repaired: 0 };
    if (unbacked.some(i => i.confirmed_micro !== i.reserved_max_micro))
      return { kind: "blocked" as const, reason: "historical_cost_basis_missing" };
    const reservations = (await db.query("SELECT * FROM reservations WHERE run_id=$1 AND account_id=$2 FOR UPDATE", [runId, accountId])).rows;
    if (reservations.length !== 1 || !["reserved", "settled"].includes(reservations[0].state))
      return { kind: "blocked" as const, reason: "historical_reservation_missing" };
    const reservation = reservations[0];
    if ([reservation.amount_micro, reservation.settled_micro].filter(v => v !== null)
      .some(v => !Number.isSafeInteger(Number(v)) || Number(v) < 0))
      return { kind: "blocked" as const, reason: "historical_cost_out_of_range" };
    if (reservation.state === "settled" && reservation.settled_micro === null)
      return { kind: "blocked" as const, reason: "historical_settlement_basis_missing" };
    // Restoring an undersized hold would release unresolved liability without a receipt.
    const remainingLiability = intents.reduce((sum, i) => sum + Number(i.confirmed_micro ?? i.reserved_max_micro), 0);
    if (!Number.isSafeInteger(remainingLiability) || Number(reservation.amount_micro) < remainingLiability ||
        (reservation.state === "settled" && Number(reservation.amount_micro) < Number(reservation.settled_micro)))
      return { kind: "blocked" as const, reason: "historical_hold_insufficient" };
    if (reservation.state === "settled") {
      const restored = await db.query(`UPDATE allowance_accounts SET settled_micro=settled_micro-$2,reserved_micro=reserved_micro+$3
        WHERE account_id=$1 AND settled_micro >= $2`, [accountId, reservation.settled_micro, reservation.amount_micro]);
      if (restored.rowCount !== 1) throw new Error("historical_allowance_invariant");
      await db.query("UPDATE reservations SET state='reserved',settled_micro=NULL,settlement_basis=NULL WHERE id=$1", [reservation.id]);
    }
    for (const intent of unbacked) {
      await db.query(`INSERT INTO provider_accounting_repairs(intent_id,previous_state,previous_confirmed_micro,reason)
        VALUES($1,$2,$3,'unbacked_estimate') ON CONFLICT DO NOTHING`, [intent.id, intent.state, intent.confirmed_micro]);
      await db.query("UPDATE provider_intents SET confirmed_micro=NULL,state='outcome-unknown' WHERE id=$1", [intent.id]);
    }
    await db.query(`UPDATE runs SET spent_micro=(SELECT COALESCE(SUM(confirmed_micro),0) FROM provider_intents
      WHERE run_id=$1 AND route LIKE 'openrouter:%') WHERE id=$1`, [runId]);
    return { kind: "repaired" as const, repaired: unbacked.length };
  });
}

import { loadConfig } from "../apps/backend/src/platform/config.js";
import { createPool } from "../apps/backend/src/platform/db.js";
import { reconcileProviderIntent, repairHistoricalAccounting } from "../apps/backend/src/modules/provider-reconciliation.js";
import { lookupGenerationReceipt } from "../apps/backend/src/adapters/model/generation-receipt.js";
import { measureRunCost } from "../apps/backend/src/modules/run-cost.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: reconcile-provider --intent UUID [--apply] | --repair-run UUID --account UUID [--apply]\nDefault inspects financial metadata only. --intent --apply performs one bounded provider metadata GET and settles only a validated receipt. --repair-run --apply restores demonstrable unbacked historical estimates to unknown holds; it never guesses missing settlement amounts. No completion/search is sent.");
} else {
  const flags = new Map<string, string>(); let apply = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === "--apply" && !apply) { apply = true; continue; }
    if (!["--intent", "--repair-run", "--account"].includes(flag) || flags.has(flag)) throw new Error("invalid_reconciliation_arguments");
    const value = args[++i];
    if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("invalid_reconciliation_id");
    flags.set(flag, value);
  }
  const intentId = flags.get("--intent"), runId = flags.get("--repair-run"), accountId = flags.get("--account");
  if (intentId ? Boolean(runId || accountId) : !runId || !accountId) throw new Error("choose_exactly_one_reconciliation_mode");
  const config = loadConfig(), pool = createPool(config.databaseUrl);
  try {
    let result: unknown;
    if (intentId) {
      result = apply ? await reconcileProviderIntent(pool, config, intentId, lookupGenerationReceipt, AbortSignal.timeout(15_000)) :
        (await pool.query("SELECT id,state,confirmed_micro,reserved_max_micro FROM provider_intents WHERE id=$1 AND scope_key=$2", [intentId, config.liveBudgetScope ?? "project"])).rows[0] ?? { kind: "unavailable" };
    } else result = apply ? await repairHistoricalAccounting(pool, runId!, accountId!) : await measureRunCost(pool, runId!, accountId!);
    console.log(JSON.stringify({ mode: apply ? "apply" : "inspect", result }));
  } finally { await pool.end(); }
}

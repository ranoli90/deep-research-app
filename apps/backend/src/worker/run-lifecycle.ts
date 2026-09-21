import type pg from "pg";
import type { AppConfig } from "../platform/config.js";
import { withTx, type Queryable } from "../platform/db.js";
import { consentAllowsProcessing } from "../modules/access.js";
import { settleRun } from "../modules/billing.js";
import { claimLease, finishOwnedCancellationIfIdle, getRun, markTerminal, emitEvent } from "../modules/runs.js";
import { fencedSession, LostWorkerLease } from "./fenced-session.js";
import { guestExecutionAllowed } from "../modules/guest-execution-control.js";
import type { ProcessOptions } from "./execution-options.js";

async function isDeleted(db: Queryable, accountId: string): Promise<boolean> {
  const res = await db.query<{ deleted_at: Date | null }>(`SELECT deleted_at FROM accounts WHERE id = $1`, [accountId]);
  return Boolean(res.rows[0]?.deleted_at);
}

export async function executeLeasedRun(pool: pg.Pool, config: AppConfig, runId: string, opts: ProcessOptions, work: (fence:number, session:ReturnType<typeof fencedSession>)=>Promise<void>): Promise<void> {
  const workerId = `${opts.workerId ?? config.workerId}:${crypto.randomUUID()}`;
  const peek = await getRun(pool, runId);
  if (!peek) return;
  const fence = await withTx(pool, async (c) => claimLease(c, runId, workerId, config.leaseMs));
  if (fence == null) return;
  const session = fencedSession(pool, { runId, accountId: peek.account_id, owner: workerId, fence,
    briefRevision: peek.brief_revision, leaseMs: config.leaseMs });
  let graceful = true;
  try {
    await work(fence, session);
  } catch (error) {
    if (!(error instanceof LostWorkerLease)) { graceful = false; throw error; }
  } finally {
    session.stop();
    if (graceful) await pool.query("UPDATE run_leases SET expires_at = now() WHERE run_id = $1 AND owner = $2 AND fence = $3", [runId, workerId, fence]);
    await finishOwnedCancellationIfIdle(pool, runId).catch(() => undefined);
  }
}

/** Shared cancellation, consent, deletion and fencing preflight; no controller policy. */
export async function prepareRunStep(pool:pg.Pool,runId:string,fence:number,session:ReturnType<typeof fencedSession>) {
    const run = await getRun(pool, runId);
    if (!run || run.worker_lease_fence !== fence || session.signal.aborted) return;
    const deleted = await isDeleted(pool, run.account_id);
    if (run.lifecycle === "terminal") return;

    if (run.lifecycle === "cancelling" || run.cancellation_epoch > 0) {
      await session.write(async (c) => {
        await markTerminal(c, runId, "cancelled");
        await settleRun(c, run.account_id, runId, run.spent_micro);
        await emitEvent(c, {
          runId,
          accountId: run.account_id,
          type: "cancelled",
          summary: "Run cancelled. No new work will be issued. Partial evidence is retained unless deleted.",
          phase: run.phase,
        });
      }, true);
      return;
    }

    if (deleted) {
      await session.write(async (c) => {
        await markTerminal(c, runId, "cancelled");
        await settleRun(c, run.account_id, runId, run.spent_micro);
        await emitEvent(c, {
          runId,
          accountId: run.account_id,
          type: "deleted",
          summary: "Account or content deleted; late work discarded.",
          phase: run.phase,
        });
      }, true);
      return;
    }

    if (!(await consentAllowsProcessing(pool, run.account_id))) {
      await session.write(async (c) => {
        await markTerminal(c, runId, "cancelled");
        await settleRun(c, run.account_id, runId, run.spent_micro);
        await emitEvent(c, {
          runId,
          accountId: run.account_id,
          type: "cancelled",
          summary: "Consent revoked; remaining processing is discarded.",
          phase: run.phase,
        });
      }, true);
      return;
    }

    if (!await guestExecutionAllowed(pool, runId, run.account_id)) {
      await session.write(async (c) => {
        await markTerminal(c, runId, "cancelled");
        await settleRun(c, run.account_id, runId, run.spent_micro);
      }, true);
      return;
    }

    return run;
}

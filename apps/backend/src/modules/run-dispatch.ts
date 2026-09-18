import type pg from "pg";
import type PgBoss from "pg-boss";
import { withTx } from "../platform/db.js";
import { enqueueRun } from "../adapters/queue.js";

/** Claim locally, commit, then contact the queue. A lost ack leaves a retryable row. */
export async function dispatchPendingRuns(pool: pg.Pool, boss: PgBoss, limit = 20, onlyRunId?: string): Promise<number> {
  const attemptId = crypto.randomUUID();
  const claimed = await withTx(pool, async (db) => db.query<{ run_id: string }>(`
    WITH pending AS (
      SELECT run_id FROM run_dispatch_outbox
      WHERE state <> 'dispatched' AND next_attempt_at <= now()
        AND ($3::uuid IS NULL OR run_id = $3)
        AND (lease_until IS NULL OR lease_until <= now())
      ORDER BY next_attempt_at, run_id FOR UPDATE SKIP LOCKED LIMIT $1
    )
    UPDATE run_dispatch_outbox d SET state = 'dispatching', attempt_id = $2,
      attempts = attempts + 1, lease_until = now() + interval '30 seconds'
    FROM pending WHERE d.run_id = pending.run_id RETURNING d.run_id`, [limit, attemptId, onlyRunId ?? null]));
  let dispatched = 0;
  for (const { run_id: runId } of claimed.rows) {
    try {
      await enqueueRun(boss, runId);
      const result = await pool.query(`UPDATE run_dispatch_outbox SET state = 'dispatched',
        dispatched_at = now(), lease_until = NULL WHERE run_id = $1 AND attempt_id = $2`, [runId, attemptId]);
      dispatched += result.rowCount ?? 0;
    } catch {
      // No request text/queue exception enters the outbox. Retry is durable.
      await pool.query(`UPDATE run_dispatch_outbox SET state = 'pending', lease_until = NULL,
        next_attempt_at = now() + interval '5 seconds' WHERE run_id = $1 AND attempt_id = $2`, [runId, attemptId]);
    }
  }
  return dispatched;
}

export async function tryDispatchRun(pool: pg.Pool, boss: PgBoss, runId: string): Promise<void> {
  try { await dispatchPendingRuns(pool, boss, 1, runId); }
  catch {
    // Acceptance is already committed. The durable dispatcher retries database outages.
    process.stderr.write(JSON.stringify({ level: "error", event: "run_dispatch_deferred", runId }) + "\n");
  }
}

import type pg from "pg";
import { withTx } from "../platform/db.js";
import { currentConsent } from "../modules/access.js";
import { getRun, renewLease } from "../modules/runs.js";
import { guestExecutionAllowed } from "../modules/guest-execution-control.js";

export class LostWorkerLease extends Error {
  constructor() { super("stale_worker"); }
}

export interface FencedSession {
  signal: AbortSignal;
  stop(): void;
  write<T>(fn: (db: pg.PoolClient) => Promise<T>, finishingRevoked?: boolean): Promise<T>;
}

/** Owns one attempt. Every content mutation runs after a fresh authoritative check. */
export function fencedSession(pool: pg.Pool, args: {
  runId: string; accountId: string; owner: string; fence: number; briefRevision: number; leaseMs: number;
}): FencedSession {
  const abort = new AbortController();
  let renewing = false;
  const timer = setInterval(async () => {
    if (renewing || abort.signal.aborted) return;
    renewing = true;
    try {
      if (!await renewLease(pool, args.runId, args.owner, args.fence, args.leaseMs)) abort.abort();
      const latest = await getRun(pool, args.runId);
      if (latest?.lifecycle === "cancelling" || !await guestExecutionAllowed(pool, args.runId, args.accountId)) abort.abort();
    } catch { abort.abort(); }
    finally { renewing = false; }
  }, Math.max(10, Math.floor(args.leaseMs / 3)));
  timer.unref();
  return {
    signal: abort.signal,
    stop() { clearInterval(timer); abort.abort(); },
    async write<T>(fn: (db: pg.PoolClient) => Promise<T>, finishingRevoked = false): Promise<T> {
      if (abort.signal.aborted) throw new LostWorkerLease();
      return withTx(pool, async (db) => {
        const account = await db.query("SELECT deleted_at FROM accounts WHERE id = $1 FOR UPDATE", [args.accountId]);
        const run = await getRun(db, args.runId, { forUpdate: true });
        const lease = await db.query("SELECT fence FROM run_leases WHERE run_id = $1 AND owner = $2 AND expires_at > clock_timestamp()", [args.runId, args.owner]);
        if (!run || !account.rows[0] || run.account_id !== args.accountId || run.lifecycle === "terminal" ||
            run.worker_lease_fence !== args.fence || Number(lease.rows[0]?.fence) !== args.fence ||
            run.brief_revision !== args.briefRevision) throw new LostWorkerLease();
        if (!finishingRevoked) {
          const consent = await currentConsent(db, args.accountId);
          if (account.rows[0].deleted_at || run.cancellation_epoch !== 0 || run.lifecycle === "cancelling" ||
              !consent || consent.revoked || consent.epoch !== run.consent_epoch ||
              !await guestExecutionAllowed(db, args.runId, args.accountId)) throw new LostWorkerLease();
        }
        // Lock waits and work inside this transaction can outlive the lease.
        // PostgreSQL now() is frozen at BEGIN and cannot authorize a current write.
        const assertCurrentLease = async () => {
          const current = await db.query("SELECT 1 FROM run_leases WHERE run_id = $1 AND owner = $2 AND fence = $3 AND expires_at > clock_timestamp()", [args.runId, args.owner, args.fence]);
          if (abort.signal.aborted || current.rowCount !== 1) throw new LostWorkerLease();
        };
        await assertCurrentLease();
        const result = await fn(db);
        await assertCurrentLease();
        if (!finishingRevoked && !await guestExecutionAllowed(db, args.runId, args.accountId)) throw new LostWorkerLease();
        return result;
      });
    },
  };
}

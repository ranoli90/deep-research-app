import { loadConfig } from "../platform/config.js";
import { assertSchemaCurrent, createPool } from "../platform/db.js";
import { createQueue, RESEARCH_QUEUE } from "../adapters/queue.js";
import type { processRun } from "./executor.js";
import { InjectedCrash } from "./execution-options.js";
import { logError, logInfo } from "../platform/log.js";
import { dispatchPendingRuns } from "../modules/run-dispatch.js";
import { drainFileDeletions } from "../modules/file-deletion.js";
import { repairPendingDeletions } from "../modules/access.js";

export type WorkerRuntime = { shutdown(timeoutMs?: number): Promise<{ drained: boolean }> };

/** Drain window honors the 30s max shutdown delay. */
export const WORKER_SHUTDOWN_TIMEOUT_MS = 30_000;

export function workerDrainTimeoutMs(): number {
  const raw = process.env.WORKER_DRAIN_TIMEOUT_MS ?? String(WORKER_SHUTDOWN_TIMEOUT_MS);
  if (!/^\d+$/.test(raw)) throw new Error("WORKER_DRAIN_TIMEOUT_MS must be an integer");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1000 || value > WORKER_SHUTDOWN_TIMEOUT_MS)
    throw new Error("WORKER_DRAIN_TIMEOUT_MS must be 1000–30000");
  return value;
}

/**
 * SIGTERM/SIGINT initiate drain without exiting: stop claiming new work, let
 * in-flight process() finish (known receipts settle, issued/unknown stay HOLD
 * durably in the DB), and report drained. Process exit stays with worker/main.
 */
export function installWorkerSignalHandlers(runtime: WorkerRuntime, timeoutMs = WORKER_SHUTDOWN_TIMEOUT_MS): () => void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > WORKER_SHUTDOWN_TIMEOUT_MS)
    throw new Error("worker_drain_timeout_invalid");
  let invoked = false;
  const initiate = (signal: "SIGTERM" | "SIGINT") => {
    if (invoked) return;
    invoked = true;
    logInfo("worker_draining", { signal, timeoutMs });
    void runtime.shutdown(timeoutMs).then(({ drained }) => {
      logInfo("worker_stopped", { signal, drained });
    }).catch(() => {
      logError("worker_shutdown_failed", { reason: "queue_or_database_unavailable" });
    });
  };
  const onTerm = () => initiate("SIGTERM");
  const onInt = () => initiate("SIGINT");
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onInt);
  return () => {
    process.removeListener("SIGTERM", onTerm);
    process.removeListener("SIGINT", onInt);
  };
}

export async function startWorker(process: typeof processRun, config = loadConfig()): Promise<WorkerRuntime> {
  const pool = createPool(config.databaseUrl);
  let boss: Awaited<ReturnType<typeof createQueue>> | undefined;
  try {
    // Fail-closed admission: runtime roles never migrate; the operator migrates separately.
    await assertSchemaCurrent(pool);
    boss = await createQueue(config.databaseUrl, { schemaSetup: false });
    await dispatchPendingRuns(pool, boss);
    await repairPendingDeletions(pool);
    await drainFileDeletions(pool, config.storageDir);
  } catch (error) {
    if (boss) await boss.stop({ graceful: false, timeout: 1000 }).catch(() => undefined);
    await pool.end();
    throw error;
  }

  const queue = boss;
  let stopping = false;
  let activeJobs = 0;
  let dispatching = false;
  const timer = setInterval(async () => {
    if (stopping || dispatching) return;
    dispatching = true;
    try {
      await repairPendingDeletions(pool);
      if (!stopping) await dispatchPendingRuns(pool, queue);
      if (!stopping) await drainFileDeletions(pool, config.storageDir);
    } catch {
      logError("run_dispatch_failed", { reason: "database_or_queue_unavailable" });
    } finally {
      dispatching = false;
    }
  }, 1000);
  timer.unref();

  try {
    await queue.work(RESEARCH_QUEUE, async (jobs) => {
      const list = Array.isArray(jobs) ? jobs : [jobs];
      // Jobs already fetched when shutdown begins remain owned by this worker.
      for (const job of list) {
        if (stopping) break;
        const runId = (job as { data?: { runId?: string } }).data?.runId;
        if (!runId) {
          logError("worker_job_missing_run", { job: String(job?.id) });
          continue;
        }
        activeJobs++;
        logInfo("worker_job", { runId, jobId: job.id });
        try {
          await process(pool, config, runId);
        } catch (err) {
          if (err instanceof InjectedCrash) {
            logInfo("injected_crash", { runId, at: err.at });
            throw err;
          }
          logError("worker_job_failed", { runId, err: String(err) });
          throw err;
        } finally {
          activeJobs--;
        }
      }
    });
  } catch (error) {
    clearInterval(timer);
    await queue.stop({ graceful: false, timeout: 1000 }).catch(() => undefined);
    await pool.end();
    throw error;
  }

  logInfo("worker_started", { workerId: config.workerId });
  let shutdownPromise: Promise<{ drained: boolean }> | undefined;
  let removeSignals: (() => void) | undefined;
  const runtime: WorkerRuntime = {
    shutdown(timeoutMs = WORKER_SHUTDOWN_TIMEOUT_MS) {
      if (shutdownPromise) return shutdownPromise;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > WORKER_SHUTDOWN_TIMEOUT_MS)
        throw new Error("worker_drain_timeout_invalid");
      stopping = true;
      clearInterval(timer);
      shutdownPromise = (async () => {
        // Single deadline from entry so offWork + queue.stop + in-flight wait
        // never exceed the drain window in total.
        const deadline = Date.now() + timeoutMs;
        const remaining = () => Math.max(0, deadline - Date.now());
        // Stop claiming new work; in-flight process() runs to completion so
        // issued/unknown provider outcomes are preserved durably (HOLD), never
        // settled as failed by shutdown itself.
        await queue.offWork(RESEARCH_QUEUE).catch(() => undefined);
        await queue.stop({ graceful: true, timeout: remaining() }).catch(() => undefined);
        while ((activeJobs !== 0 || dispatching) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const drained = activeJobs === 0 && !dispatching;
        if (drained) await pool.end();
        removeSignals?.();
        return { drained };
      })();
      return shutdownPromise;
    },
  };
  try {
    removeSignals = installWorkerSignalHandlers(runtime, workerDrainTimeoutMs());
  } catch {
    // Tests may set WORKER_DRAIN_TIMEOUT_MS outside 1–30s; runtime still starts
    // and shutdown(timeoutMs) validates per call. Signal auto-install is skipped.
    removeSignals = undefined;
  }
  return runtime;
}

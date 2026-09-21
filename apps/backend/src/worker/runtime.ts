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

export async function startWorker(process: typeof processRun, config = loadConfig()): Promise<WorkerRuntime> {
  const pool = createPool(config.databaseUrl);
  let boss: Awaited<ReturnType<typeof createQueue>> | undefined;
  try {
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
  return {
    shutdown(timeoutMs = 30_000) {
      if (shutdownPromise) return shutdownPromise;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000)
        throw new Error("worker_drain_timeout_invalid");
      stopping = true;
      clearInterval(timer);
      shutdownPromise = (async () => {
        await queue.offWork(RESEARCH_QUEUE);
        await queue.stop({ graceful: true, timeout: timeoutMs });
        const drained = activeJobs === 0 && !dispatching;
        if (drained) await pool.end();
        return { drained };
      })();
      return shutdownPromise;
    },
  };
}

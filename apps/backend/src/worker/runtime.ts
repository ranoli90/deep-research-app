import { loadConfig } from "../platform/config.js";
import { createPool, migrate } from "../platform/db.js";
import { createQueue, RESEARCH_QUEUE } from "../adapters/queue.js";
import type { processRun } from "./executor.js";
import { InjectedCrash } from "./execution-options.js";
import { logError, logInfo } from "../platform/log.js";
import { dispatchPendingRuns } from "../modules/run-dispatch.js";
import { drainFileDeletions } from "../modules/file-deletion.js";
import { repairPendingDeletions } from "../modules/access.js";

export async function startWorker(process:typeof processRun,config=loadConfig()) {
const pool = createPool(config.databaseUrl);
await migrate(pool);
const boss = await createQueue(config.databaseUrl);
await dispatchPendingRuns(pool, boss);
await repairPendingDeletions(pool);
await drainFileDeletions(pool, config.storageDir);
let dispatching = false;
setInterval(async () => {
  if (dispatching) return;
  dispatching = true;
  try { await repairPendingDeletions(pool); await dispatchPendingRuns(pool, boss); await drainFileDeletions(pool, config.storageDir); }
  catch { logError("run_dispatch_failed", { reason: "database_or_queue_unavailable" }); }
  finally { dispatching = false; }
}, 1000).unref();

await boss.work(RESEARCH_QUEUE, async (jobs) => {
  const list = Array.isArray(jobs) ? jobs : [jobs];
  for (const job of list) {
    const runId = (job as { data?: { runId?: string } }).data?.runId;
    if (!runId) {
      logError("worker_job_missing_run", { job: String(job?.id) });
      continue;
    }
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
    }
  }
});

logInfo("worker_started", { workerId: config.workerId });

}

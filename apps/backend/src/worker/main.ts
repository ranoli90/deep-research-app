import { loadConfig } from "../platform/config.js";
import { createPool, migrate } from "../platform/db.js";
import { createQueue, RESEARCH_QUEUE } from "../adapters/queue.js";
import { InjectedCrash, processRun } from "./executor.js";
import { logError, logInfo } from "../platform/log.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);
const boss = await createQueue(config.databaseUrl);

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
      await processRun(pool, config, runId);
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

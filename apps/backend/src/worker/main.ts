import { processRun } from "./executor.js";
import { startWorker } from "./runtime.js";
import { logError, logInfo } from "../platform/log.js";

const rawTimeout = process.env.WORKER_DRAIN_TIMEOUT_MS ?? "30000";
if (!/^\d+$/.test(rawTimeout)) throw new Error("WORKER_DRAIN_TIMEOUT_MS must be an integer");
const timeoutMs = Number(rawTimeout);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000)
  throw new Error("WORKER_DRAIN_TIMEOUT_MS must be 1000–300000");

const runtime = await startWorker(processRun);
let stopping = false;
function stop(signal: "SIGTERM" | "SIGINT") {
  if (stopping) return;
  stopping = true;
  logInfo("worker_draining", { signal, timeoutMs });
  const hardExit = setTimeout(() => {
    logError("worker_drain_timeout", { timeoutMs });
    process.exit(1);
  }, timeoutMs + 2000);
  void runtime.shutdown(timeoutMs).then(({ drained }) => {
    clearTimeout(hardExit);
    logInfo("worker_stopped", { drained });
    process.exit(drained ? 0 : 1);
  }).catch(() => {
    clearTimeout(hardExit);
    logError("worker_shutdown_failed", { reason: "queue_or_database_unavailable" });
    process.exit(1);
  });
}
process.once("SIGTERM", () => stop("SIGTERM"));
process.once("SIGINT", () => stop("SIGINT"));

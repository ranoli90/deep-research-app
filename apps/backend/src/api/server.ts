import { loadConfig } from "../platform/config.js";
import { assertSchemaCurrent, createPool } from "../platform/db.js";
import { createQueue } from "../adapters/queue.js";
import { buildApp } from "./app.js";
import { logError, logInfo } from "../platform/log.js";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import type pg from "pg";

/** Drain window honors the 30s max shutdown delay. */
export const API_SHUTDOWN_TIMEOUT_MS = 30_000;

export async function installApiShutdownHandlers(
  app: FastifyInstance,
  boss: PgBoss | undefined,
  pool: pg.Pool,
  timeoutMs = API_SHUTDOWN_TIMEOUT_MS,
): Promise<() => void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > API_SHUTDOWN_TIMEOUT_MS)
    throw new Error("api_drain_timeout_invalid");
  let shuttingDown = false;
  async function gracefulShutdown(signal: "SIGTERM" | "SIGINT"): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logInfo("api_draining", { signal, timeoutMs });
    const hardExit = setTimeout(() => {
      logError("api_drain_timeout", { timeoutMs });
      process.exit(1);
    }, timeoutMs);
    hardExit.unref();
    try {
      // Stop accepting new work first; in-flight requests drain via app.close().
      await app.close();
      if (boss) await boss.stop({ graceful: true, timeout: timeoutMs }).catch(() => undefined);
      await pool.end();
      clearTimeout(hardExit);
      logInfo("api_stopped", { signal, drained: true });
      process.exit(0);
    } catch {
      clearTimeout(hardExit);
      logError("api_shutdown_failed", { reason: "queue_or_database_unavailable" });
      process.exit(1);
    }
  }
  const onTerm = () => void gracefulShutdown("SIGTERM");
  const onInt = () => void gracefulShutdown("SIGINT");
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onInt);
  return () => {
    process.removeListener("SIGTERM", onTerm);
    process.removeListener("SIGINT", onInt);
  };
}

const config = loadConfig();
const pool = createPool(config.databaseUrl);
let boss: Awaited<ReturnType<typeof createQueue>> | undefined;
let app: FastifyInstance | undefined;
try {
  // Fail-closed admission: runtime roles never migrate; the operator migrates separately.
  await assertSchemaCurrent(pool);
  boss = await createQueue(config.databaseUrl, { schemaSetup: false });
  app = await buildApp({ pool, config, boss });
  await installApiShutdownHandlers(app, boss, pool);
  await app.listen({ host: config.apiHost, port: config.apiPort });
  logInfo("api_listen", { host: config.apiHost, port: config.apiPort });
} catch (error) {
  if (boss) await boss.stop({ graceful: false, timeout: 1000 }).catch(() => undefined);
  await pool.end();
  throw error;
}

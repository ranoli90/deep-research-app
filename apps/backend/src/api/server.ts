import { loadConfig } from "../platform/config.js";
import { assertSchemaCurrent, createPool } from "../platform/db.js";
import { createQueue } from "../adapters/queue.js";
import { buildApp } from "./app.js";
import { logInfo } from "../platform/log.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
let boss: Awaited<ReturnType<typeof createQueue>> | undefined;
try {
  await assertSchemaCurrent(pool);
  boss = await createQueue(config.databaseUrl, { schemaSetup: false });
  const app = await buildApp({ pool, config, boss });
  await app.listen({ host: config.apiHost, port: config.apiPort });
  logInfo("api_listen", { host: config.apiHost, port: config.apiPort });
} catch (error) {
  if (boss) await boss.stop({ graceful: false, timeout: 1000 }).catch(() => undefined);
  await pool.end();
  throw error;
}

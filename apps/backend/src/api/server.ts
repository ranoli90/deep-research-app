import { loadConfig } from "../platform/config.js";
import { assertSchemaCurrent, createPool } from "../platform/db.js";
import { createQueue } from "../adapters/queue.js";
import { buildApp } from "./app.js";
import { logInfo } from "../platform/log.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  await assertSchemaCurrent(pool);
  const boss = await createQueue(config.databaseUrl, { schemaSetup: false });
  const app = await buildApp({ pool, config, boss });
  await app.listen({ host: config.apiHost, port: config.apiPort });
  logInfo("api_listen", { host: config.apiHost, port: config.apiPort });
} catch (error) {
  await pool.end();
  throw error;
}

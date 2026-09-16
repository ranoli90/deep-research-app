import { loadConfig } from "../platform/config.js";
import { createPool, migrate } from "../platform/db.js";
import { createQueue } from "../adapters/queue.js";
import { buildApp } from "./app.js";
import { logInfo } from "../platform/log.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);
const boss = await createQueue(config.databaseUrl);
const app = await buildApp({ pool, config, boss });
await app.listen({ host: config.apiHost, port: config.apiPort });
logInfo("api_listen", { host: config.apiHost, port: config.apiPort });

import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { logInfo } from "./log.js";

const url = process.env.DATABASE_URL ?? loadConfig().databaseUrl;
const pool = createPool(url);
await migrate(pool);
logInfo("migrated", { database: url.replace(/:[^:@]+@/, ":***@") });
await pool.end();

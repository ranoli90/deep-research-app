import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { createDevSession, grantConsent } from "../modules/access.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);
const session = await createDevSession(pool, "demo@localhost");
await grantConsent(pool, session.accountId);
process.stdout.write(JSON.stringify({ accountId: session.accountId, token: session.token, labeled: "development-only" }) + "\n");
await pool.end();

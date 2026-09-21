import { createQueue } from "../adapters/queue.js";
import { assertSchemaCurrent, createPool, migrate } from "./db.js";
import { logInfo } from "./log.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for operator migration");
const pool = createPool(url);
try {
  await migrate(pool, async () => {
    const boss = await createQueue(url, { schemaSetup: true });
    await boss.stop({ graceful: true, timeout: 2000 });
  });
  const schema = await assertSchemaCurrent(pool);
  logInfo("migrated", schema);
} finally {
  await pool.end();
}

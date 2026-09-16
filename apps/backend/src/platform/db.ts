import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    application_name: "deep-research",
  });
}

export async function migrate(pool: pg.Pool): Promise<void> {
  const sqlPath = join(__dirname, "../../migrations/001_init.sql");
  const sql = readFileSync(sqlPath, "utf8");
  await pool.query(sql);
  await pool.query("INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING", ["001_init"]);
}

export async function withTx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

export type Queryable = pg.Pool | pg.PoolClient;

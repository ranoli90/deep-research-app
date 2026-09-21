import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTEGRITY_MIGRATION = "053_schema_migration_integrity";
const GUEST_MIGRATION = "052_norrow_guest_auth";

type Migration = { id: string; sql: string; sha256: string };

function migrationFiles(): Migration[] {
  const dir = join(__dirname, "../../migrations");
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  const migrations = files.map((name) => {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(name)) throw new Error("migration_filename_invalid");
    const bytes = readFileSync(join(dir, name));
    return { id: name.slice(0, -4), sql: bytes.toString("utf8"),
      sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  if (!migrations.some(({ id }) => id === GUEST_MIGRATION) ||
      !migrations.some(({ id }) => id === INTEGRITY_MIGRATION)) throw new Error("required_migration_source_missing");
  return migrations;
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    application_name: "deep-research",
  });
}

/** Read-only, exact source/schema admission for API and worker runtime roles. */
export async function assertSchemaCurrent(db: pg.Pool | pg.PoolClient): Promise<{ version: string; legacyBaselines: number }> {
  const files = migrationFiles();
  const rows = await db.query<{ id: string; source_sha256: string | null; provenance: string | null }>(`
    SELECT m.id, s.source_sha256, s.provenance FROM schema_migrations m
    LEFT JOIN schema_migration_sources s ON s.migration_id = m.id ORDER BY m.id`);
  if (rows.rows.length !== files.length) throw new Error("schema_migration_set_mismatch");
  let legacyBaselines = 0;
  for (let i = 0; i < files.length; i++) {
    const expected = files[i]!;
    const actual = rows.rows[i]!;
    if (actual.id !== expected.id || actual.source_sha256 !== expected.sha256 ||
        !["applied_with_checksum", "legacy_current_file_baseline"].includes(actual.provenance ?? ""))
      throw new Error("schema_migration_source_mismatch");
    if (actual.provenance === "legacy_current_file_baseline") legacyBaselines++;
  }
  return { version: files.at(-1)!.id, legacyBaselines };
}

/** Operator-only migration step. One session lock covers SQL and queue setup. */
export async function migrate(pool: pg.Pool, afterMigrate?: () => Promise<void>): Promise<void> {
  const files = migrationFiles();
  const byId = new Map(files.map((file) => [file.id, file]));
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(42116, 20260921)");
    try {
      const hasLedger = (await client.query<{ present: string | null }>(
        "SELECT to_regclass('public.schema_migrations')::text AS present")).rows[0]!.present !== null;
      const initialIds = new Set<string>(hasLedger
        ? (await client.query<{ id: string }>("SELECT id FROM schema_migrations")).rows.map((row) => row.id)
        : []);
      let hasSources = (await client.query<{ present: string | null }>(
        "SELECT to_regclass('public.schema_migration_sources')::text AS present")).rows[0]!.present !== null;
      if (initialIds.has(INTEGRITY_MIGRATION) && !hasSources) throw new Error("schema_migration_source_table_missing");
      for (const id of initialIds) if (!byId.has(id)) throw new Error("unknown_applied_migration");
      if (hasSources) await verifyRecordedSources(client, files, initialIds);

      const applied = new Set(initialIds);
      for (const file of files) {
        if (applied.has(file.id)) continue;
        await client.query("BEGIN");
        try {
          await client.query(file.sql);
          await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file.id]);
          applied.add(file.id);
          if (file.id === INTEGRITY_MIGRATION) {
            hasSources = true;
            for (const id of applied) {
              const source = byId.get(id)!;
              await client.query(`INSERT INTO schema_migration_sources
                (migration_id, source_sha256, provenance) VALUES ($1,$2,$3)`, [
                id, source.sha256, initialIds.has(id) ? "legacy_current_file_baseline" : "applied_with_checksum",
              ]);
            }
          } else if (hasSources) {
            await client.query(`INSERT INTO schema_migration_sources
              (migration_id, source_sha256, provenance) VALUES ($1,$2,'applied_with_checksum')`,
            [file.id, file.sha256]);
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          applied.delete(file.id);
          throw error;
        }
      }
      await assertSchemaCurrent(client);
      if (afterMigrate) await afterMigrate();
    } finally {
      await client.query("SELECT pg_advisory_unlock(42116, 20260921)");
    }
  } finally {
    client.release();
  }
}

async function verifyRecordedSources(client: pg.PoolClient, files: Migration[], applied: Set<string>): Promise<void> {
  const sources = await client.query<{ migration_id: string; source_sha256: string; provenance: string }>(
    "SELECT migration_id, source_sha256, provenance FROM schema_migration_sources");
  if (sources.rows.length !== applied.size) throw new Error("schema_migration_source_set_mismatch");
  const byId = new Map(files.map((file) => [file.id, file]));
  for (const row of sources.rows) {
    if (!applied.has(row.migration_id) || row.source_sha256 !== byId.get(row.migration_id)?.sha256 ||
        !["applied_with_checksum", "legacy_current_file_baseline"].includes(row.provenance))
      throw new Error("schema_migration_source_mismatch");
  }
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

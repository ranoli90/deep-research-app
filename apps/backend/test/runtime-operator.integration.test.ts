import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { assertSchemaCurrent, createPool, migrate } from "../src/platform/db.js";
import { createQueue, RESEARCH_QUEUE } from "../src/adapters/queue.js";
import { startWorker } from "../src/worker/runtime.js";
import { loadConfig } from "../src/platform/config.js";
import type { processRun } from "../src/worker/executor.js";

const adminUrl = process.env.TEST_DATABASE_URL ??
  "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
const suffix = `${process.pid}_${randomBytes(4).toString("hex")}`;
const database = `deep_runtime_${suffix}`;
const role = `deep_runtime_role_${suffix}`;
const rolePassword = randomBytes(24).toString("hex");
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${database}`;
const roleUrl = new URL(databaseUrl);
roleUrl.username = role;
roleUrl.password = rolePassword;
const admin = new pg.Client({ connectionString: adminUrl });
let pool: pg.Pool;
let rolePool: pg.Pool;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  pool = createPool(databaseUrl.toString());
}, 30_000);

afterAll(async () => {
  await rolePool?.end();
  await pool?.end();
  // This generated database/role belongs only to this test file.
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.query(`DROP ROLE IF EXISTS "${role}"`);
  await admin.end();
}, 30_000);

describe("operator-owned migration and least-privilege runtime", () => {
  it("serializes fresh operators, records exact source bytes, and fails closed on tampering", async () => {
    const second = createPool(databaseUrl.toString());
    try {
      await Promise.all([migrate(pool), migrate(second)]);
      const state = await assertSchemaCurrent(pool);
      expect(state.version).toBe("053_schema_migration_integrity");
      expect(state.legacyBaselines).toBe(0);
      const duplicate = await pool.query(`SELECT id, count(*)::int AS count FROM schema_migrations
        GROUP BY id HAVING count(*) > 1`);
      expect(duplicate.rows).toEqual([]);
      await migrate(second);
      await pool.query("UPDATE schema_migration_sources SET source_sha256 = repeat('0', 64) WHERE migration_id = '001_init'");
      await expect(assertSchemaCurrent(pool)).rejects.toThrow("schema_migration_source_mismatch");
      await expect(migrate(pool)).rejects.toThrow("schema_migration_source_mismatch");
      const migrationPath = fileURLToPath(new URL("../migrations/001_init.sql", import.meta.url));
      const sourceSha = createHash("sha256").update(readFileSync(migrationPath)).digest("hex");
      await pool.query("UPDATE schema_migration_sources SET source_sha256 = $1 WHERE migration_id = '001_init'", [sourceSha]);
      await expect(assertSchemaCurrent(pool)).resolves.toMatchObject({ legacyBaselines: 0 });
    } finally {
      await second.end();
    }
  }, 120_000);

  it("operator creates the queue; a non-DDL role can start the runtime queue", async () => {
    const operatorQueue = await createQueue(databaseUrl.toString(), { schemaSetup: true });
    await operatorQueue.stop({ graceful: true, timeout: 2000 });
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${rolePassword}'`);
    await admin.query(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`);
    await pool.query(`GRANT USAGE ON SCHEMA public, pgboss TO "${role}"`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, pgboss TO "${role}"`);
    await pool.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public, pgboss TO "${role}"`);
    rolePool = createPool(roleUrl.toString());
    const privilege = await rolePool.query("SELECT has_schema_privilege(current_user, 'pgboss', 'CREATE') AS can_create");
    expect(privilege.rows[0].can_create).toBe(false);
    expect(await assertSchemaCurrent(rolePool)).toMatchObject({ version: "053_schema_migration_integrity" });
    const runtimeQueue = await createQueue(roleUrl.toString(), { schemaSetup: false });
    try {
      expect(await runtimeQueue.getQueue(RESEARCH_QUEUE)).toBeTruthy();
    } finally {
      await runtimeQueue.stop({ graceful: true, timeout: 2000 });
    }
  }, 30_000);

  it("drains an accepted worker job and refuses subsequent intake", async () => {
    let started!: () => void;
    let finish!: () => void;
    const accepted = new Promise<void>((resolve) => { started = resolve; });
    const release = new Promise<void>((resolve) => { finish = resolve; });
    const calls: string[] = [];
    const config = loadConfig({ DATABASE_URL: roleUrl.toString(), DEV_ALLOW_FIXTURE_ROUTE: "true" });
    const runtime = await startWorker((async (_pool, _config, runId) => {
      calls.push(runId);
      started();
      await release;
    }) as typeof processRun, config);
    const sender = await createQueue(databaseUrl.toString(), { schemaSetup: false });
    try {
      await sender.send(RESEARCH_QUEUE, { runId: "accepted-test" });
      await accepted;
      const draining = runtime.shutdown(10_000);
      await sender.send(RESEARCH_QUEUE, { runId: "queued-test" });
      finish();
      await expect(draining).resolves.toEqual({ drained: true });
      expect(calls).toEqual(["accepted-test"]);
    } finally {
      finish();
      await sender.stop({ graceful: false, timeout: 1000 });
    }
  }, 30_000);
});

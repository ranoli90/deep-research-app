import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createPool, migrate } from "../src/platform/db.js";
import { InjectedCrash, processRun } from "../src/worker/diagnostic-executor.js";
import { claimLease, getRun } from "../src/modules/runs.js";
import { loadEvidence } from "../src/modules/evidence.js";
import { getLatestReportForRun } from "../src/modules/reports.js";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";

process.env.DATABASE_URL = TEST_URL;
process.env.APP_AUTH_MODE = "development";
process.env.DEV_ALLOW_FIXTURE_ROUTE = "true";
process.env.LIVE_ROUTE_ENABLED = "false";
process.env.NODE_ENV = "test";

let pool: pg.Pool;
let app: FastifyInstance;
let boss: PgBoss;
let config: AppConfig;

async function authed(): Promise<{ token: string; accountId: string }> {
  const s = await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} });
  const body = s.json() as { token: string; accountId: string };
  const c = await app.inject({
    method: "POST",
    url: "/v1/consent",
    headers: { authorization: `Bearer ${body.token}` },
    payload: { grant: true },
  });
  expect(c.statusCode).toBe(200);
  return body;
}

async function createRun(token: string) {
  return app.inject({
    method: "POST",
    url: "/v1/runs",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    payload: { question: "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01", routeMode: "fixture" },
  });
}

async function reservationCounts(runId: string) {
  const res = await pool.query<{ n: number; settled: number }>(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE state = 'settled')::int AS settled
     FROM reservations WHERE run_id = $1`,
    [runId],
  );
  return { n: Number(res.rows[0]!.n), settled: Number(res.rows[0]!.settled) };
}

beforeAll(async () => {
  pool = createPool(TEST_URL);
  await migrate(pool);
  config = loadConfig({ ...process.env, DATABASE_URL: TEST_URL });
  boss = await createQueue(TEST_URL);
  app = await buildApp({ pool, config, boss });
});
beforeEach(async () => {
  await pool.query("TRUNCATE accounts CASCADE");
});
afterAll(async () => {
  await pool.query(`DELETE FROM pgboss.job WHERE name = 'research-run' AND state IN ('created', 'retry', 'active')`);
  await app.close();
  await boss.stop({ graceful: false, timeout: 2000 });
  await pool.end();
});

describe("P4 recovery drill against shipped worker/Postgres", () => {
  it("crash after fetch: evidence kept, live lease not stolen, expired lease recovered without double-settle", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token);
    expect(created.statusCode).toBe(200);
    const runId = created.json().runId as string;

    await expect(processRun(pool, config, runId, { crashAfter: "persist-evidence", workerId: "worker-a" })).rejects.toBeInstanceOf(
      InjectedCrash,
    );

    const mid = await loadEvidence(pool, runId);
    expect(mid.sources.length).toBeGreaterThan(0);
    expect(mid.passages.length).toBeGreaterThan(0);
    expect(await getLatestReportForRun(pool, runId, accountId)).toBeNull();
    const midRes = await reservationCounts(runId);
    expect(midRes.n).toBe(1);
    expect(midRes.settled).toBe(0);
    const crashed = await getRun(pool, runId);
    expect(crashed?.lifecycle).not.toBe("terminal");

    const stolen = await claimLease(pool, runId, "worker-b", 30_000);
    expect(stolen).toBeNull();

    await pool.query(`UPDATE run_leases SET expires_at = now() - interval '1 second' WHERE run_id = $1`, [runId]);
    const reclaimed = await claimLease(pool, runId, "worker-b", 30_000);
    expect(reclaimed).toBeGreaterThan(crashed!.worker_lease_fence);

    // A logical worker name is not the acquired attempt identity. Simulate another crash
    // between acquisition and execution, then let processRun acquire its own fenced attempt.
    await processRun(pool, config, runId, { workerId: "worker-b" });
    expect((await getRun(pool, runId))?.worker_lease_fence).toBe(reclaimed);
    expect((await getRun(pool, runId))?.lifecycle).not.toBe("terminal");
    await pool.query(`UPDATE run_leases SET expires_at = now() - interval '1 second' WHERE run_id = $1`, [runId]);
    await processRun(pool, config, runId, { workerId: "worker-b" });
    const done = await getRun(pool, runId);
    expect(done?.lifecycle).toBe("terminal");
    const report = await getLatestReportForRun(pool, runId, accountId);
    expect(report).toBeTruthy();
    const after = await loadEvidence(pool, runId);
    expect(after.sources.length).toBeGreaterThanOrEqual(mid.sources.length);
    const endRes = await reservationCounts(runId);
    expect(endRes.n).toBe(1);
    expect(endRes.settled).toBe(1);
    const reports = await pool.query(`SELECT count(*)::int AS n FROM reports WHERE run_id = $1`, [runId]);
    expect(reports.rows[0]!.n).toBe(1);
  });

  it("crash before publish then expired-lease failover: one report and one settlement", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token);
    const runId = created.json().runId as string;

    await expect(processRun(pool, config, runId, { crashAfter: "before-publish", workerId: "writer-a" })).rejects.toBeInstanceOf(
      InjectedCrash,
    );
    expect(await getLatestReportForRun(pool, runId, accountId)).toBeNull();
    const midRes = await reservationCounts(runId);
    expect(midRes.n).toBe(1);
    expect(midRes.settled).toBe(0);

    await pool.query(`UPDATE run_leases SET expires_at = now() - interval '1 second' WHERE run_id = $1`, [runId]);
    await processRun(pool, config, runId, { workerId: "writer-b" });

    const done = await getRun(pool, runId);
    expect(done?.lifecycle).toBe("terminal");
    expect(await getLatestReportForRun(pool, runId, accountId)).toBeTruthy();
    const endRes = await reservationCounts(runId);
    expect(endRes.n).toBe(1);
    expect(endRes.settled).toBe(1);
    const reports = await pool.query(`SELECT count(*)::int AS n FROM reports WHERE run_id = $1`, [runId]);
    expect(reports.rows[0]!.n).toBe(1);
  });
});

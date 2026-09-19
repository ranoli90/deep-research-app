import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { PUBLIC_ACTIVITY_SCHEMA_VERSION } from "@deep/contracts";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createPool, migrate } from "../src/platform/db.js";
import { emitEvent } from "../src/modules/runs.js";

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

describe("GET /v1/runs/:id/events sanitized consumer DTO", () => {
  it("HTTP JSON omits publicSummary, type, payload, CoT canaries, and private hosts", async () => {
    const { token, accountId } = await authed();
    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      payload: { question: "best laptop under 2k", routeMode: "fixture" },
    });
    expect(created.statusCode).toBe(200);
    const runId = created.json().runId as string;
    await emitEvent(pool, {
      runId,
      accountId,
      type: "chain_of_thought",
      summary: "CANARY:PRIVATE_COT let me think step by step",
      phase: "researching",
      payload: {
        type: "chain_of_thought",
        publicSummary: "CANARY:PRIVATE_COT",
        url: "https://10.1.2.3/raw/secret-path",
      },
    });
    await emitEvent(pool, {
      runId,
      accountId,
      type: "opened_source",
      summary: "Opened https://vault.internal/wiki CANARY:RAW_URL",
      phase: "researching",
      payload: { title: "intranet title", url: "https://192.168.0.5/raw" },
    });
    await emitEvent(pool, {
      runId,
      accountId,
      type: "opened_source",
      summary: "Opened https://nist.gov/publications/x",
      phase: "researching",
      payload: { title: "NIST guidance", count: 1 },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}/events?after=0`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const raw = res.body;
    expect(raw).not.toMatch(/"publicSummary"\s*:/);
    expect(raw).not.toMatch(/"public_summary"\s*:/);
    expect(raw).not.toMatch(/"payload"\s*:/);
    expect(raw).not.toMatch(/"type"\s*:/);
    expect(raw).not.toMatch(/CANARY:PRIVATE_COT|CANARY:RAW_URL|vault\.internal|10\.1\.2\.3|192\.168\.0\.5|secret-path/);
    const body = res.json() as { events: Array<Record<string, unknown>> };
    expect(body.events.length).toBeGreaterThan(0);
    for (const event of body.events) {
      expect(Object.keys(event).sort()).toEqual(
        ["activity", "createdAt", "id", "phase", "runId", "schemaVersion", "sequence"].sort(),
      );
      expect(event.schemaVersion).toBe(PUBLIC_ACTIVITY_SCHEMA_VERSION);
      expect(event).not.toHaveProperty("type");
      expect(event).not.toHaveProperty("publicSummary");
      expect(event).not.toHaveProperty("payload");
    }
    const nist = body.events.find((e) => (e.activity as { sourceDomain?: string } | null)?.sourceDomain === "nist.gov");
    expect(nist?.activity).toMatchObject({ kind: "source_reading", sourceTitle: "NIST guidance", sourceDomain: "nist.gov" });
  });
});

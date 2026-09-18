import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import {
  FIXTURE_FETCH_COST_MICRO,
  FIXTURE_SEARCH_COST_MICRO,
  FIXTURE_SYNTH_COST_MICRO,
  FIXTURE_TARIFF_VERSION,
} from "@deep/contracts";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createPool, migrate } from "../src/platform/db.js";
import { processRun } from "../src/worker/diagnostic-executor.js";

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

async function authed() {
  const s = await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} });
  const body = s.json() as { token: string; accountId: string };
  await app.inject({
    method: "POST",
    url: "/v1/consent",
    headers: { authorization: `Bearer ${body.token}` },
    payload: { grant: true },
  });
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

describe("G06 local capability probe and measured fixture cost", () => {
  it("GET /v1/routes/capabilities pins fixture tariffs and does not enable a live paid probe", async () => {
    const { token } = await authed();
    const res = await app.inject({
      method: "GET",
      url: "/v1/routes/capabilities",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().paidProbe).toBe(false);
    const caps = res.json().capabilities as { routeId: string; capability: string; status: string; tariffMicro: number | null; evidence: string }[];
    const search = caps.find((c) => c.routeId === "fixture" && c.capability === "search");
    expect(search?.status).toBe("supported");
    expect(search?.tariffMicro).toBe(FIXTURE_SEARCH_COST_MICRO);
    expect(caps.find((c) => c.routeId === "fixture" && c.capability === "fetch")?.tariffMicro).toBe(FIXTURE_FETCH_COST_MICRO);
    expect(caps.find((c) => c.routeId === "fixture" && c.capability === "synthesize")?.tariffMicro).toBe(FIXTURE_SYNTH_COST_MICRO);
    expect(caps.find((c) => c.capability === "internal_search_visibility")?.status).toBe("unsupported");
    expect(caps.find((c) => c.routeId === "controlled-research" && c.capability === "search")?.status).toBe("unsupported");
    expect(caps.find((c) => c.routeId === "hosted-baseline")?.status).toBe("unsupported");
    expect(JSON.stringify(caps)).not.toMatch(/live completion issued for this probe/i);
    const unauth = await app.inject({ method: "GET", url: "/v1/routes/capabilities" });
    expect(unauth.statusCode).toBe(401);
  });

  it("GET /v1/runs/:id/cost reconciles spent_micro to fixture intents and denies other accounts", async () => {
    const { token, accountId } = await authed();
    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      payload: {
        question: "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01",
        routeMode: "fixture",
      },
    });
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const cost = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}/cost`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(cost.statusCode).toBe(200);
    const body = cost.json() as {
      spentMicro: number;
      intentTotalMicro: number;
      reconciled: boolean;
      reservationState: string;
      reservationAmountMicro: number;
      breakdown: { search: number; fetch: number; synthesize: number; other: number };
      tariffVersion: string;
      effectiveProcessor: string;
      confirmedProviderMicro: number;
      heldProviderMicro: number;
      simulatedFixtureMicro: number;
      allowanceReconciled: boolean;
    };
    expect(body.tariffVersion).toBe(FIXTURE_TARIFF_VERSION);
    expect(body.effectiveProcessor).toBe("app-owned-fixture-catalog");
    expect(body.reconciled).toBe(true);
    expect(body.allowanceReconciled).toBe(true);
    expect(body.confirmedProviderMicro).toBe(0);
    expect(body.heldProviderMicro).toBe(0);
    expect(body.simulatedFixtureMicro).toBe(body.spentMicro);
    expect(body.spentMicro).toBe(body.intentTotalMicro);
    expect(body.spentMicro).toBe(body.breakdown.search + body.breakdown.fetch + body.breakdown.synthesize + body.breakdown.other);
    expect(body.breakdown.search % FIXTURE_SEARCH_COST_MICRO).toBe(0);
    expect(body.breakdown.search).toBeGreaterThan(0);
    expect(body.breakdown.fetch % FIXTURE_FETCH_COST_MICRO).toBe(0);
    expect(body.breakdown.fetch).toBeGreaterThan(0);
    expect(body.breakdown.synthesize).toBe(FIXTURE_SYNTH_COST_MICRO);
    expect(body.reservationState).toBe("settled");
    expect(body.spentMicro).toBeLessThanOrEqual(body.reservationAmountMicro);
    const allow = await pool.query<{ settled_micro: string; reserved_micro: string }>(
      `SELECT settled_micro::text, reserved_micro::text FROM allowance_accounts WHERE account_id = $1`,
      [accountId],
    );
    expect(Number(allow.rows[0]!.settled_micro)).toBe(body.spentMicro);
    expect(Number(allow.rows[0]!.reserved_micro)).toBe(0);
    const other = await authed();
    const stolen = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}/cost`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(stolen.statusCode).toBe(404);
  });
});

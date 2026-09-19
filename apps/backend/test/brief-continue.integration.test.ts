import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createPool, migrate } from "../src/platform/db.js";
import { processRun } from "../src/worker/diagnostic-executor.js";
import { getBrief, getRun } from "../src/modules/runs.js";
import { briefContext, confirmedConstraints } from "../src/modules/research-tasks.js";
import { admitRun } from "../src/modules/run-admission.js";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import { modelInputManifest } from "../src/modules/model-operations.js";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";

process.env.DATABASE_URL = TEST_URL;
process.env.APP_AUTH_MODE = "development";
process.env.DEV_ALLOW_FIXTURE_ROUTE = "true";
process.env.LIVE_ROUTE_ENABLED = "false";
process.env.NODE_ENV = "test";

const ORIGINAL = "What is the filing deadline for employment tax?";

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

async function createRun(token: string, question: string) {
  return app.inject({
    method: "POST",
    url: "/v1/runs",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    payload: { question, routeMode: "fixture" },
  });
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

describe("FP-001/002/007/008 continue brief invariants", () => {
  it("keeps original_question column and payload byte-identical after geography clarification", async () => {
    const { token } = await authed();
    const created = await createRun(token, ORIGINAL);
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    expect((await getRun(pool, runId))?.lifecycle).toBe("awaiting_input");
    const before = await pool.query<{ id: string; original_question: string; payload: { originalQuestion: string } }>(
      `SELECT b.id, b.original_question, b.payload FROM research_briefs b JOIN runs r ON r.brief_id=b.id WHERE r.id=$1`,
      [runId],
    );
    expect(before.rows[0]?.original_question).toBe(ORIGINAL);
    expect(before.rows[0]?.payload.originalQuestion).toBe(ORIGINAL);

    const cont = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/continue`,
      headers: { authorization: `Bearer ${token}` },
      payload: { geography: "Germany" },
    });
    expect(cont.statusCode).toBe(200);

    const after = await pool.query<{ original_question: string; payload: { originalQuestion: string } }>(
      `SELECT b.original_question, b.payload FROM research_briefs b JOIN runs r ON r.brief_id=b.id WHERE r.id=$1`,
      [runId],
    );
    expect(after.rows[0]?.original_question).toBe(ORIGINAL);
    expect(after.rows[0]?.payload.originalQuestion).toBe(ORIGINAL);
    expect(after.rows[0]?.original_question).toBe(after.rows[0]?.payload.originalQuestion);
    expect(after.rows[0]?.payload.originalQuestion).not.toMatch(/ in Germany\?/u);

    const restored = await getBrief(pool, before.rows[0]!.id);
    expect(restored.originalQuestion).toBe(ORIGINAL);
    const geo = restored.constraints.find((c) => c.field === "geography" && c.origin === "confirmed");
    expect(geo).toMatchObject({ origin: "confirmed", importance: "hard" });
    expect(String(geo?.value)).toMatch(/germany/i);
  });

  it("exposes confirmed geography to brief model context without rewriting the question", async () => {
    const { token } = await authed();
    const created = await createRun(token, ORIGINAL);
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const cont = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/continue`,
      headers: { authorization: `Bearer ${token}` },
      payload: { geography: "France" },
    });
    expect(cont.statusCode).toBe(200);
    const run = await getRun(pool, runId);
    const brief = await getBrief(pool, run!.brief_id);
    expect(brief.originalQuestion).toBe(ORIGINAL);
    const context = briefContext(brief.originalQuestion, confirmedConstraints(brief.constraints));
    expect(context.question).toBe(ORIGINAL);
    expect(context.confirmedConstraints?.some((c) => c.field === "geography" && /france/i.test(String(c.value)))).toBe(true);
    const manifest = modelInputManifest(context);
    expect(manifest.version).toBe("model-input.v6");
    expect(manifest).toHaveProperty("confirmedConstraintsDigest");
  });

  it("persists typed budget/currency/timeframe/platform/private_search answers on /continue", async () => {
    const { token } = await authed();
    const created = await createRun(token, ORIGINAL);
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const cont = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/continue`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        answers: [
          { field: "budget", value: "under $2,000 USD" },
          { field: "currency", value: "USD" },
          { field: "timeframe", value: "2020-2024" },
          { field: "platform", value: "iPhone" },
          { field: "private_search", value: "No" },
          { field: "geography", value: "Germany" },
        ],
      },
    });
    expect(cont.statusCode).toBe(200);
    const run = await getRun(pool, runId);
    const brief = await getBrief(pool, run!.brief_id);
    expect(brief.originalQuestion).toBe(ORIGINAL);
    const byField = Object.fromEntries(brief.constraints.filter((c) => c.origin === "confirmed").map((c) => [c.field, c]));
    expect(byField.budget).toMatchObject({ operator: "lte", value: "2000", units: "USD" });
    expect(byField.budget?.value).not.toBe("under $2,000 usd");
    expect(byField.currency).toMatchObject({ value: "USD" });
    expect(byField.timeframe).toMatchObject({ operator: "between", value: "2020-2024" });
    expect(byField.platform).toMatchObject({ value: "iPhone" });
    expect(byField.platform?.value).not.toBe("iphone");
    expect(byField.private_search).toMatchObject({ value: "no" });
    expect(byField.geography).toBeTruthy();
  });

  it("fails restore and admission when original_question column and payload diverge", async () => {
    const { token, accountId } = await authed();
    const key = crypto.randomUUID();
    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
      payload: { question: ORIGINAL, routeMode: "fixture" },
    });
    const runId = created.json().runId as string;
    const briefId = (await getRun(pool, runId))!.brief_id;

    await pool.query(
      `UPDATE research_briefs SET payload = jsonb_set(payload, '{originalQuestion}', to_jsonb($2::text)) WHERE id=$1`,
      [briefId, `${ORIGINAL} rewritten`],
    );
    await expect(getBrief(pool, briefId)).rejects.toThrow("original_question_mismatch");
    const snap = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(snap.statusCode).toBeGreaterThanOrEqual(400);

    await pool.query(
      `UPDATE research_briefs SET payload = jsonb_set(payload, '{originalQuestion}', to_jsonb($2::text)), original_question=$3 WHERE id=$1`,
      [briefId, ORIGINAL, "column diverged"],
    );
    await expect(getBrief(pool, briefId)).rejects.toThrow("original_question_mismatch");
    await expect(admitRun(pool, accountId, key, {
      question: ORIGINAL,
      routeMode: "fixture",
      attachmentIds: [],
      consentPolicyVersion: CONSENT_POLICY_VERSION,
    })).rejects.toThrow("original_question_mismatch");
  });
});

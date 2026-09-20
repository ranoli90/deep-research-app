import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { OUTPUT_REPORT_CATEGORIES, PRIVACY_DATA_FLOWS } from "@deep/contracts";
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

describe("G07 / M10 in-app output reporting and privacy disclosure", () => {
  it("GET /v1/settings exposes privacy disclosure and output-reporting categories; purchases stay gated", async () => {
    const { token } = await authed();
    const res = await app.inject({ method: "GET", url: "/v1/settings", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().privacyDisclosure.dataFlows).toBe(PRIVACY_DATA_FLOWS);
    expect(res.json().privacyDisclosure.deletionVsSubscription).toMatch(/store subscription/i);
    expect(res.json().outputReporting.available).toBe(true);
    expect(res.json().outputReporting.categories).toEqual([...OUTPUT_REPORT_CATEGORIES]);
    expect(res.json().purchases.available).toBe(false);
    expect(res.json().restore.available).toBe(false);
  });

  it("M10 includeExcerpt stores owned answer text; omitting it stores no excerpt; other accounts are denied", async () => {
    const { token, accountId } = await authed();
    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      payload: { question: "What did ACME announce about Widget 4?", routeMode: "fixture" },
    });
    await processRun(pool, config, created.json().runId);
    const snap = await app.inject({
      method: "GET",
      url: `/v1/runs/${created.json().runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const reportId = snap.json().reportId as string;
    const claimId = (await pool.query("SELECT claim_ids FROM reports WHERE id=$1", [reportId])).rows[0].claim_ids[0] as string;
    expect(claimId).toMatch(/^[a-f0-9-]{36}$/);
    const withExcerpt = await app.inject({
      method: "POST",
      url: `/v1/reports/${reportId}/challenges`,
      headers: { authorization: `Bearer ${token}` },
      payload: { claimId, category: "inaccurate", note: "price looks wrong", includeExcerpt: true },
    });
    expect(withExcerpt.statusCode).toBe(200);
    expect(withExcerpt.json().submitted).toBe(true);
    expect(withExcerpt.json().includedExcerpt).toBe(true);
    const row = await pool.query<{ category: string; include_excerpt: boolean; excerpt_text: string | null; note: string }>(
      `SELECT category, include_excerpt, excerpt_text, note FROM challenges WHERE id = $1 AND account_id = $2`,
      [withExcerpt.json().challengeId, accountId],
    );
    expect(row.rows[0]?.category).toBe("inaccurate");
    expect(row.rows[0]?.include_excerpt).toBe(true);
    expect(row.rows[0]?.excerpt_text).toMatch(/Widget 4|ACME/i);
    expect(row.rows[0]?.note).toMatch(/price looks wrong/);

    const without = await app.inject({
      method: "POST",
      url: `/v1/reports/${reportId}/challenges`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        claimId,
        category: "privacy",
        note: "do not attach",
        includeExcerpt: false,
        excerptText: "CLIENT-FORGED-EXCERPT",
      },
    });
    expect(without.json().includedExcerpt).toBe(false);
    const row2 = await pool.query<{ include_excerpt: boolean; excerpt_text: string | null }>(
      `SELECT include_excerpt, excerpt_text FROM challenges WHERE id = $1`,
      [without.json().challengeId],
    );
    expect(row2.rows[0]?.include_excerpt).toBe(false);
    expect(row2.rows[0]?.excerpt_text).toBeNull();

    const other = await authed();
    const stolen = await app.inject({
      method: "POST",
      url: `/v1/reports/${reportId}/challenges`,
      headers: { authorization: `Bearer ${other.token}` },
      payload: { category: "harmful", includeExcerpt: true },
    });
    expect([403, 404]).toContain(stolen.statusCode);

    // The report owner cannot bind an arbitrary claim from another owner/run or an unpublished claim.
    const otherRun = await app.inject({ method: "POST", url: "/v1/runs",
      headers: { authorization: `Bearer ${other.token}`, "idempotency-key": crypto.randomUUID() },
      payload: { question: "What did ACME announce about Widget 4?", routeMode: "fixture" } });
    await processRun(pool, config, otherRun.json().runId);
    const foreignClaim = (await pool.query("SELECT claim_ids FROM reports WHERE run_id=$1", [otherRun.json().runId])).rows[0].claim_ids[0];
    const unpublishedClaim = crypto.randomUUID();
    await pool.query("INSERT INTO claims (id,run_id,account_id,text,type,support_status) VALUES ($1,$2,$3,'unpublished assertion','fact','unverified')",
      [unpublishedClaim, created.json().runId, accountId]);
    for (const rejectedId of [foreignClaim, unpublishedClaim, crypto.randomUUID()]) {
      const challenge = await app.inject({ method: "POST", url: `/v1/reports/${reportId}/challenges`,
        headers: { authorization: `Bearer ${token}` }, payload: { claimId: rejectedId, category: "claim", note: "wrong binding" } });
      expect(challenge.statusCode).toBe(404);
      const follow = await app.inject({ method: "POST", url: `/v1/runs/${created.json().runId}/follow-up`,
        headers: { authorization: `Bearer ${token}` }, payload: { claimId: rejectedId, note: "wrong binding" } });
      expect(follow.statusCode).toBe(404);
    }
    const malformed = await app.inject({ method: "POST", url: `/v1/reports/${reportId}/challenges`,
      headers: { authorization: `Bearer ${token}` }, payload: { claimId: "answer", category: "claim", note: "wrong binding" } });
    expect(malformed.statusCode).toBe(400);
    expect((await pool.query("SELECT id FROM runs WHERE parent_run_id=$1", [created.json().runId])).rowCount).toBe(0);
  });

  it("restore purchases stays gated and grants no entitlement", async () => {
    const { token, accountId } = await authed();
    const res = await app.inject({
      method: "POST",
      url: "/v1/purchases/restore",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().available).toBe(false);
    expect(res.json().entitlements).toBe(0);
    const ents = await pool.query(`SELECT count(*)::int AS n FROM entitlements WHERE account_id = $1`, [accountId]);
    expect(ents.rows[0]!.n).toBe(0);
  });
});

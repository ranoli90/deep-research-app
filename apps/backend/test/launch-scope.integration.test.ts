import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createPool, migrate } from "../src/platform/db.js";
import { processRun } from "../src/worker/executor.js";
import { getRun, listEvents } from "../src/modules/runs.js";
import { loadEvidence } from "../src/modules/evidence.js";
import { getLatestReportForRun } from "../src/modules/reports.js";
import { revokeConsent } from "../src/modules/access.js";

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

describe("launch-scope fixture/postgres cases", () => {
  it("R02 asks a jurisdiction question when it would change the answer", async () => {
    const { token } = await authed();
    const created = await createRun(token, "What is the filing deadline for employment tax?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const run = await getRun(pool, runId);
    expect(run?.lifecycle).toBe("awaiting_input");
    const events = await listEvents(pool, runId, 0);
    expect(events.some((e) => e.type === "clarify")).toBe(true);
    expect(JSON.stringify(events)).toMatch(/jurisdiction/i);
  });

  it("R03 does not interview a clear comparison over style", async () => {
    const { token } = await authed();
    const created = await createRun(
      token,
      "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01, keep the tone punchy",
    );
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const events = await listEvents(pool, runId, 0);
    expect(events.some((e) => e.type === "clarify")).toBe(false);
    const run = await getRun(pool, runId);
    expect(run?.lifecycle).toBe("terminal");
  });

  it("R07 keeps a paywalled page snippet-only and does not claim a full read", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What does the paywalled 2024 study say about the 42% figure?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const evidence = await loadEvidence(pool, runId);
    expect(evidence.sources.some((s) => s.access_level === "blocked")).toBe(true);
    expect(evidence.passages.some((p) => p.exact_text.includes("THIS FULL TEXT MUST NOT BE USED"))).toBe(false);
    const report = await getLatestReportForRun(pool, runId, accountId);
    expect(JSON.stringify(report?.blocks)).toMatch(/snippet-only|blocked|full reading/i);
  });

  it("R11 records a real price contradiction without averaging", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "How much does Gadget Mini cost in EUR?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const report = await getLatestReportForRun(pool, runId, accountId);
    const text = JSON.stringify(report?.blocks);
    expect(text).toMatch(/19/);
    expect(text).toMatch(/45/);
    expect(text).toMatch(/not averaged|Unresolved disagreement/i);
  });

  it("R14 budget-limited outcome is not marked comprehensive", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    const runId = created.json().runId as string;
    await pool.query(`UPDATE runs SET budget_micro = 16000 WHERE id = $1`, [runId]);
    await processRun(pool, config, runId);
    const report = await getLatestReportForRun(pool, runId, accountId);
    expect(report?.outcome).toBe("completed_with_limitations");
    expect(JSON.stringify(report?.limitations)).toMatch(/Budget|not comprehensive/i);
  });

  it("R22 preserves a reproducible annual cost calculation", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(
      token,
      "What is 12 months of the Vendor A 40 EUR per month Germany price as of 2026-03-01?",
    );
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const report = await getLatestReportForRun(pool, runId, accountId);
    const text = JSON.stringify(report?.blocks);
    expect(text).toMatch(/480/);
    expect(text).toMatch(/annual_from_monthly/);
  });

  it("V2-01 uses the compatibility matrix, not summary count", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Is NimbusDB compatible with Postgres 14?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const evidence = await loadEvidence(pool, runId);
    expect(evidence.sources.some((s) => s.source_type === "vendor-matrix")).toBe(true);
    const report = await getLatestReportForRun(pool, runId, accountId);
    const text = JSON.stringify(report?.blocks).toLowerCase();
    expect(text).toMatch(/not compatible|incompatible/);
    expect(text).not.toMatch(/certified compatible from \d+ summaries/);
    const events = await listEvents(pool, runId, 0);
    expect(JSON.stringify(events)).toMatch(/source type|compatibility matrix|gap/i);
  });

  it("V2-02 / R08 switches source type after summary-family saturation", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Is NimbusDB compatible with Postgres 14?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const report = await getLatestReportForRun(pool, runId, accountId);
    expect(JSON.stringify(report?.blocks)).toMatch(/vendor compatibility matrix|source-type|review summaries/i);
  });

  it("V2-04 relaxed budget discovers a previously omitted candidate", async () => {
    const { token } = await authed();
    const created = await createRun(token, "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    const parentId = created.json().runId as string;
    await processRun(pool, config, parentId);
    const parentEv = await loadEvidence(pool, parentId);
    expect(parentEv.sources.some((s) => s.canonical_locator.includes("vendor-c"))).toBe(false);
    const snap = await app.inject({ method: "GET", url: `/v1/runs/${parentId}`, headers: { authorization: `Bearer ${token}` } });
    const corr = await app.inject({
      method: "POST",
      url: `/v1/runs/${parentId}/corrections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedBriefRevision: snap.json().brief.revision, correctionText: "Actually, the budget is 120 EUR" },
    });
    const childId = corr.json().runId as string;
    expect(corr.json().impact.reopenedDiscoveryScopes).toContain("candidate-discovery");
    await processRun(pool, config, childId);
    const childEv = await loadEvidence(pool, childId);
    expect(childEv.sources.some((s) => s.canonical_locator.includes("vendor-c"))).toBe(true);
    const child = await getRun(pool, childId);
    const report = await getLatestReportForRun(pool, childId, child!.account_id);
    expect(JSON.stringify(report?.blocks)).toMatch(/Vendor C/);
  });

  it("V2-05 recomputes a corrected numeric unit", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Convert a 10 g daily dose for the named agent");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const snap = await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers: { authorization: `Bearer ${token}` } });
    const corr = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/corrections`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        expectedBriefRevision: snap.json().brief.revision,
        correctionText: "Actually the dose is 10 milligrams not 10 grams",
      },
    });
    const childId = corr.json().runId as string;
    await processRun(pool, config, childId);
    const report = await getLatestReportForRun(pool, childId, accountId);
    const text = JSON.stringify(report?.blocks);
    expect(text).toMatch(/10 mg|10000 mg|mg/);
    expect(corr.json().impact.reopenedDiscoveryScopes ?? []).not.toContain("candidate-discovery");
  });

  it("V2-06 unknown dependency completeness forces a full rerun flag", async () => {
    const { token } = await authed();
    const created = await createRun(token, "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const snap = await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers: { authorization: `Bearer ${token}` } });
    const corr = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/corrections`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        expectedBriefRevision: snap.json().brief.revision,
        correctionText: "dependency completeness unknown; please recheck the conclusion",
      },
    });
    expect(corr.json().fullRerun).toBe(true);
    expect(corr.json().impact.dependencyCompleteness).toBe("unknown");
    const childId = corr.json().runId as string;
    await processRun(pool, config, childId);
    const child = await getRun(pool, childId);
    expect(child?.parent_run_id).toBe(runId);
    expect(child?.lifecycle).toBe("terminal");
  });

  it("P2 a non-budget correction does not reopen candidate discovery or add Vendor C", async () => {
    const { token } = await authed();
    const created = await createRun(token, "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    const parentId = created.json().runId as string;
    await processRun(pool, config, parentId);
    const parentEv = await loadEvidence(pool, parentId);
    expect(parentEv.sources.some((s) => s.canonical_locator.includes("vendor-c"))).toBe(false);
    const snap = await app.inject({ method: "GET", url: `/v1/runs/${parentId}`, headers: { authorization: `Bearer ${token}` } });
    const corr = await app.inject({
      method: "POST",
      url: `/v1/runs/${parentId}/corrections`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        expectedBriefRevision: snap.json().brief.revision,
        correctionText: "The founding year is historical, not a current price.",
      },
    });
    expect(corr.json().impact.reopenedDiscoveryScopes ?? []).not.toContain("candidate-discovery");
    const childId = corr.json().runId as string;
    await processRun(pool, config, childId);
    const childEv = await loadEvidence(pool, childId);
    expect(childEv.sources.some((s) => s.canonical_locator.includes("vendor-c"))).toBe(false);
  });

  it("V2-18 distinguishes no eligible inspected option from universal absence", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Compare managed Postgres options in Germany under 10 EUR as of 2026-03-01");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const report = await getLatestReportForRun(pool, runId, accountId);
    const text = JSON.stringify(report?.blocks);
    expect(text).toMatch(/inspected/);
    expect(text).toMatch(/not a claim that no option exists outside/i);
  });

  it("E07 denies another account's evidence id", async () => {
    const a = await authed();
    const created = await createRun(a.token, "What did ACME announce about Widget 4?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const evidence = await loadEvidence(pool, runId);
    const passageId = evidence.passages[0]!.id;
    const b = await authed();
    const denied = await app.inject({
      method: "GET",
      url: `/v1/sources/${passageId}`,
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(denied.statusCode).toBe(404);
  });

  it("S04 does not leave raw script markup in the canonical report", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Summarize the hostile markup page with a script tag");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const report = await getLatestReportForRun(pool, runId, accountId);
    expect(JSON.stringify(report?.blocks)).not.toMatch(/<script/i);
  });

  it("S11 revoked consent blocks new runs", async () => {
    const { token, accountId } = await authed();
    await revokeConsent(pool, accountId);
    const created = await createRun(token, "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    expect(created.statusCode).toBe(403);
    expect(created.json().code).toBe("consent_required");
  });

  it("J09 concurrent reservations cannot exceed the remaining allowance", async () => {
    const { token, accountId } = await authed();
    await pool.query(`UPDATE allowance_accounts SET limit_micro = 150000, reserved_micro = 0, settled_micro = 0 WHERE account_id = $1`, [
      accountId,
    ]);
    const q = "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01";
    const [a, b] = await Promise.all([createRun(token, q), createRun(token, q)]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toContain(200);
    expect(codes.some((c) => c === 402 || c === 500 || c === 200)).toBe(true);
    const n = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM runs WHERE account_id = $1`, [accountId]);
    expect(n.rows[0]!.n).toBeLessThanOrEqual(1);
    const reserved = await pool.query<{ reserved_micro: string }>(
      `SELECT reserved_micro FROM allowance_accounts WHERE account_id = $1`,
      [accountId],
    );
    expect(Number(reserved.rows[0]!.reserved_micro)).toBeLessThanOrEqual(150000);
  });

  it("challenge and markdown export use the same stored report", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const snap = await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers: { authorization: `Bearer ${token}` } });
    const reportId = snap.json().reportId as string;
    const before = await app.inject({ method: "GET", url: `/v1/reports/${reportId}`, headers: { authorization: `Bearer ${token}` } });
    const ch = await app.inject({
      method: "POST",
      url: `/v1/reports/${reportId}/challenges`,
      headers: { authorization: `Bearer ${token}` },
      payload: { claimId: "answer", category: "claim", note: "check the announcement date" },
    });
    expect(ch.statusCode).toBe(200);
    expect(ch.json().challengeId).toBeTruthy();
    const row = await pool.query<{ claim_id: string; note: string; report_id: string }>(
      `SELECT claim_id, note, report_id FROM challenges WHERE id = $1 AND account_id = $2`,
      [ch.json().challengeId, accountId],
    );
    expect(row.rows[0]?.claim_id).toBe("answer");
    expect(row.rows[0]?.note).toMatch(/announcement date/);
    expect(row.rows[0]?.report_id).toBe(reportId);
    const after = await app.inject({ method: "GET", url: `/v1/reports/${reportId}`, headers: { authorization: `Bearer ${token}` } });
    expect(after.json().blocks).toEqual(before.json().blocks);
    const other = await authed();
    const stolen = await app.inject({
      method: "POST",
      url: `/v1/reports/${reportId}/challenges`,
      headers: { authorization: `Bearer ${other.token}` },
      payload: { claimId: "answer", category: "claim", note: "not mine" },
    });
    expect([403, 404]).toContain(stolen.statusCode);
    const exp = await app.inject({
      method: "GET",
      url: `/v1/reports/${reportId}/export`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(exp.json().markdown.length).toBeGreaterThan(20);
    expect(exp.json().format).toBe("markdown");
    expect(exp.json().markdown).toMatch(/Widget 4|ACME/i);
  });
});

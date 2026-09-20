import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { EXPLAIN_EVIDENCE_INCOMPLETE, investigationInstruction } from "@deep/research-core";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createPool, migrate } from "../src/platform/db.js";
import { getBrief, getRun, setPendingInput } from "../src/modules/runs.js";
import { insertSource, insertVersionAndPassage } from "../src/modules/evidence.js";
import { getLatestReportForRun, publishReport } from "../src/modules/reports.js";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";

process.env.DATABASE_URL = TEST_URL;
process.env.APP_AUTH_MODE = "development";
process.env.DEV_ALLOW_FIXTURE_ROUTE = "true";
process.env.LIVE_ROUTE_ENABLED = "false";
process.env.NODE_ENV = "test";

const QUESTION = "best laptop for local AI under $2k";
const DELL_TEXT = "Dell XPS 15 lists at $2499.";

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

async function publishOwned(accountId: string, runId: string, text: string) {
  const run = (await getRun(pool, runId))!;
  const sourceId = await insertSource(pool, {
    accountId,
    runId,
    locator: "https://example.org/dell-xps",
    title: "Laptop prices",
    publisher: "Example",
    originCluster: "example.org",
  });
  const { passageId, versionId } = await insertVersionAndPassage(pool, {
    sourceId,
    accountId,
    runId,
    locator: "https://example.org/dell-xps",
    text,
    accessLevel: "full-text",
  });
  const claimId = crypto.randomUUID();
  const basis = {
    briefRevision: run.brief_revision,
    evidenceRevision: run.evidence_revision,
    consentEpoch: run.consent_epoch,
    cancellationEpoch: run.cancellation_epoch,
    workerLeaseFence: run.worker_lease_fence,
  };
  const published = await publishReport(pool, {
    report: {
      reportId: crypto.randomUUID(),
      version: 1,
      runId,
      basis,
      outcome: "completed",
      blocks: [{ id: "answer", kind: "text", text, claimIds: [claimId], citationIds: [passageId] }],
      claimIds: [claimId],
      limitations: [],
      sourceAccessSummary: [],
      routeMode: "fixture",
    },
    accountId,
    loaded: basis,
    claims: [{ id: claimId, text, type: "external-fact", supportStatus: "direct", passageIds: [passageId] }],
    passages: [{ id: passageId, sourceId, sourceVersionId: versionId, exactText: text, locator: "document" }],
    deleted: false,
  });
  expect(published).toMatchObject({ accepted: true });
  return { passageId, reportId: published.reportId! };
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

describe("ENG-033 follow-up explain from owned evidence", () => {
  it("answers Why not Dell from the published report and owned passage ids without mutating the brief", async () => {
    const { token, accountId } = await authed();
    const headers = { authorization: `Bearer ${token}` };
    const runId = (await createRun(token, QUESTION)).json().runId as string;
    const before = (await getRun(pool, runId))!;
    const original = await getBrief(pool, before.brief_id);
    const { passageId } = await publishOwned(accountId, runId, DELL_TEXT);
    expect(await getLatestReportForRun(pool, runId, accountId)).toBeTruthy();

    const explained = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/follow-up`,
      headers,
      payload: { message: "Why not Dell?" },
    });
    expect(explained.statusCode).toBe(200);
    expect(explained.json()).toMatchObject({
      kind: "explain",
      runId,
      mutatesBrief: false,
      evidenceComplete: true,
      answer: DELL_TEXT,
    });
    expect(explained.json().citationPassageIds).toEqual([passageId]);
    expect(explained.json().needsTargetedResearch).toBeUndefined();
    expect((await getRun(pool, runId))!.brief_id).toBe(before.brief_id);
    expect((await getBrief(pool, before.brief_id)).originalQuestion).toBe(original.originalQuestion);
    expect((await pool.query("SELECT id FROM runs WHERE parent_run_id=$1", [runId])).rowCount).toBe(0);
  });

  it("returns an honest incomplete explain when the report does not establish the point", async () => {
    const { token, accountId } = await authed();
    const runId = (await createRun(token, QUESTION)).json().runId as string;
    await publishOwned(accountId, runId, "ThinkPad T14 is recommended under $2000.");
    const explained = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/follow-up`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "Why not Dell?" },
    });
    expect(explained.statusCode).toBe(200);
    expect(explained.json()).toMatchObject({
      kind: "explain",
      mutatesBrief: false,
      evidenceComplete: false,
      needsTargetedResearch: true,
      answer: EXPLAIN_EVIDENCE_INCOMPLETE,
    });
    expect(explained.json().citationPassageIds).toEqual([]);
    expect((await pool.query("SELECT id FROM runs WHERE parent_run_id=$1", [runId])).rowCount).toBe(0);
  });

  it("keeps Wave A stale steer and wrong pending-input identities at 409", async () => {
    const { token, accountId } = await authed();
    const headers = { authorization: `Bearer ${token}` };
    const steerId = (await createRun(token, "Compare battery technologies")).json().runId as string;
    const before = (await getRun(pool, steerId))!;
    const steer = {
      method: "POST" as const,
      url: `/v1/runs/${steerId}/follow-up`,
      headers,
      payload: { message: "Only use official sources", expectedBriefRevision: before.brief_revision },
    };
    expect((await app.inject(steer)).statusCode).toBe(200);
    expect((await app.inject(steer)).statusCode).toBe(409);

    const pendingId = (await createRun(token, "What is the filing deadline for employment tax?")).json().runId as string;
    await setPendingInput(pool, { runId: pendingId, accountId, briefRevision: 1, type: "clarification" });
    const pending = (await getRun(pool, pendingId))!;
    expect((await app.inject({
      method: "POST",
      url: `/v1/runs/${pendingId}/continue`,
      headers,
      payload: { geography: "France", pendingInputId: crypto.randomUUID(), expectedBriefRevision: pending.brief_revision },
    })).statusCode).toBe(409);
    expect((await app.inject({
      method: "POST",
      url: `/v1/runs/${pendingId}/continue`,
      headers,
      payload: { geography: "France", pendingInputId: pending.pending_input_id, expectedBriefRevision: pending.brief_revision + 1 },
    })).statusCode).toBe(409);
  });

  it("POST Go deeper on battery life deepens a child without rewriting originalQuestion or falling into verification", async () => {
    const { token, accountId } = await authed();
    const headers = { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() };
    const runId = (await createRun(token, QUESTION)).json().runId as string;
    const before = (await getRun(pool, runId))!;
    const original = await getBrief(pool, before.brief_id);
    await publishOwned(accountId, runId, DELL_TEXT);
    await pool.query(
      "UPDATE runs SET lifecycle='terminal', terminal_outcome='completed', route_mode='controlled-research' WHERE id=$1",
      [runId],
    );

    const deepened = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/follow-up`,
      headers,
      payload: { message: "Go deeper on battery life", expectedBriefRevision: before.brief_revision },
    });
    expect(deepened.statusCode).toBe(200);
    expect(deepened.statusCode).not.toBe(400);
    expect(deepened.json()).toMatchObject({
      kind: "deepen",
      parentRunId: runId,
      mutatesBrief: false,
    });
    expect(deepened.json().runId).toBeTruthy();
    expect(deepened.json().runId).not.toBe(runId);
    expect(deepened.json().verificationId).toBeUndefined();
    const child = (await getRun(pool, deepened.json().runId as string))!;
    expect(child.parent_run_id).toBe(runId);
    expect((await getBrief(pool, child.brief_id)).originalQuestion).toBe(original.originalQuestion);
    expect((await getBrief(pool, before.brief_id)).originalQuestion).toBe(QUESTION);
    expect((await getBrief(pool, before.brief_id)).originalQuestion).toBe(original.originalQuestion);
    const childBrief = await getBrief(pool, child.brief_id);
    expect(childBrief.desiredOutcome).toContain(investigationInstruction("battery life"));
    expect(childBrief.desiredOutcome).toMatch(/battery life/i);
    expect(childBrief.assumptions.some((row) => row.value === "Go deeper on battery life")).toBe(false);
    expect((await pool.query("SELECT verification_required_revision FROM runs WHERE id=$1", [child.id])).rows[0].verification_required_revision).toBeNull();
  });

  it("applies a typed budget change without rewriting the original question or dropping geography", async () => {
    const { token, accountId } = await authed();
    const headers = { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() };
    const runId = (await createRun(token, QUESTION)).json().runId as string;
    const before = (await getRun(pool, runId))!;
    const original = await getBrief(pool, before.brief_id);
    const geo = {
      id: "geo-indiana",
      field: "geography",
      operator: "eq",
      value: "Indiana",
      origin: "confirmed",
      importance: "hard",
      explanation: "Confirmed geography",
    };
    await pool.query(
      `UPDATE research_briefs SET payload = jsonb_set(payload, '{constraints}', $2::jsonb) WHERE id=$1`,
      [original.id, JSON.stringify([...original.constraints.filter((c) => c.field !== "geography"), geo])],
    );
    await publishOwned(accountId, runId, DELL_TEXT);
    await pool.query(
      "UPDATE runs SET lifecycle='terminal', terminal_outcome='completed', route_mode='controlled-research' WHERE id=$1",
      [runId],
    );
    const changed = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/follow-up`,
      headers,
      payload: { message: "Actually, under $1,500", expectedBriefRevision: before.brief_revision },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ kind: "change_constraint", parentRunId: runId });
    expect(changed.json().runId).not.toBe(runId);
    const child = (await getRun(pool, changed.json().runId as string))!;
    const childBrief = await getBrief(pool, child.brief_id);
    expect(childBrief.originalQuestion).toBe(QUESTION);
    expect(childBrief.originalQuestion).not.toMatch(/Actually/i);
    const budget = childBrief.constraints.find((c) => c.field === "budget");
    expect(budget).toMatchObject({ operator: "lte", value: "1500", units: "USD", origin: "confirmed" });
    expect(budget?.value).not.toBe("2000");
    expect(childBrief.constraints.find((c) => c.field === "geography")).toMatchObject({ value: "Indiana", origin: "confirmed" });
    expect((await getBrief(pool, before.brief_id)).originalQuestion).toBe(QUESTION);
    const stale = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/follow-up`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "Actually, under $2,500", expectedBriefRevision: before.brief_revision + 5 },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("returns authorized claim wording on GET /v1/reports/:id", async () => {
    const { token, accountId } = await authed();
    const runId = (await createRun(token, QUESTION)).json().runId as string;
    const { reportId } = await publishOwned(accountId, runId, DELL_TEXT);
    const report = await app.inject({
      method: "GET",
      url: `/v1/reports/${reportId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().claims).toEqual(expect.arrayContaining([expect.objectContaining({ text: DELL_TEXT })]));
  });

  it("does not treat a verify message as verification or a diagnostic child", async () => {
    const { token, accountId } = await authed();
    const runId = (await createRun(token, QUESTION)).json().runId as string;
    await publishOwned(accountId, runId, DELL_TEXT);
    await pool.query("UPDATE runs SET lifecycle='terminal', terminal_outcome='completed' WHERE id=$1", [runId]);
    const challenged = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/follow-up`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "Is that true?", expectedBriefRevision: 1 },
    });
    expect(challenged.statusCode).toBe(409);
    expect(challenged.json().error?.code ?? challenged.json().code).toBeDefined();
    expect(JSON.stringify(challenged.json())).toMatch(/Select the conclusion/i);
    expect((await getRun(pool, runId))!.lifecycle).toBe("terminal");
  });

  it("rejects a deleted account on follow-up explain", async () => {
    const { token, accountId } = await authed();
    const runId = (await createRun(token, QUESTION)).json().runId as string;
    await publishOwned(accountId, runId, DELL_TEXT);
    await pool.query("UPDATE accounts SET deleted_at=now() WHERE id=$1", [accountId]);
    const explained = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/follow-up`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "Why not Dell?" },
    });
    expect(explained.statusCode).toBe(401);
  });
});

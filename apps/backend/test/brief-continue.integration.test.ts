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

describe("ENG-001/003/034–036 state and transport regressions", () => {
  it("binds clarification to exact pending identity and prevents sibling endpoints from resuming it", async () => {
    const { token } = await authed();
    const runId = (await createRun(token, ORIGINAL)).json().runId;
    await processRun(pool, config, runId);
    const run = (await getRun(pool,runId))!;
    const headers = { authorization: `Bearer ${token}` };
    const snapshot = (await app.inject({ method:"GET",url:`/v1/runs/${runId}`,headers })).json();
    expect(snapshot.pendingInput).toEqual({id:run.pending_input_id,type:"clarification",briefRevision:run.brief_revision});
    expect((await app.inject({method:"POST",url:`/v1/runs/${runId}/continue`,headers,payload:{ geography:"France",pendingInputId:crypto.randomUUID(),expectedBriefRevision:run.brief_revision }})).statusCode).toBe(409);
    expect((await app.inject({method:"POST",url:`/v1/runs/${runId}/continue`,headers,payload:{ geography:"France",pendingInputId:run.pending_input_id,expectedBriefRevision:run.brief_revision+1 }})).statusCode).toBe(409);
    expect((await app.inject({method:"POST",url:`/v1/runs/${runId}/assumptions`,headers,payload:{action:"replace",values:["France"],expectedBriefRevision:run.brief_revision}})).statusCode).toBe(409);
    await pool.query("UPDATE runs SET pending_input_type='query_authorization' WHERE id=$1",[runId]);
    expect((await app.inject({method:"POST",url:`/v1/runs/${runId}/continue`,headers,payload:{ geography:"France",pendingInputId:run.pending_input_id,expectedBriefRevision:run.brief_revision }})).statusCode).toBe(409);
    expect((await getRun(pool,runId))!.lifecycle).toBe("awaiting_input");
  });
  it("commits source steering to a new brief and rejects stale replay without mutating prior identities", async () => {
    const { token } = await authed();
    const runId = (await createRun(token,"Compare battery technologies")).json().runId;
    const before = (await getRun(pool,runId))!;
    const original = await getBrief(pool,before.brief_id);
    const request = {method:"POST" as const,url:`/v1/runs/${runId}/follow-up`,headers:{authorization:`Bearer ${token}`},payload:{message:"Only use official sources",expectedBriefRevision:before.brief_revision}};
    const changed = await app.inject(request);
    expect(changed.statusCode).toBe(200);
    const after = (await getRun(pool,runId))!;
    expect(after.brief_revision).toBeGreaterThan(before.brief_revision);
    expect(after.brief_id).not.toBe(before.brief_id);
    expect(await getBrief(pool,before.brief_id)).toEqual(original);
    expect((await getBrief(pool,after.brief_id)).originalQuestion).toBe(original.originalQuestion);
    expect((await getBrief(pool,after.brief_id)).sourceRestrictions).not.toEqual(original.sourceRestrictions);
    expect((await app.inject(request)).statusCode).toBe(409);
    expect((await getRun(pool,runId))!.brief_id).toBe(after.brief_id);
  });
  it("terminal source additions admit one idempotent child and preserve the published parent", async () => {
    const {token}=await authed();const headers={authorization:`Bearer ${token}`,"idempotency-key":crypto.randomUUID()};
    const runId=(await createRun(token,"Compare battery technologies")).json().runId;
    await pool.query("UPDATE runs SET lifecycle='terminal',terminal_outcome='completed' WHERE id=$1",[runId]);
    const before=(await getRun(pool,runId))!;
    const request={method:"POST" as const,url:`/v1/runs/${runId}/follow-up`,headers,payload:{message:"Add https://vendor.example/spec",expectedBriefRevision:before.brief_revision}};
    const first=await app.inject(request);expect(first.statusCode).toBe(200);
    const second=await app.inject(request);expect(second.statusCode).toBe(200);
    expect(first.json().runId).toBe(second.json().runId);expect(first.json().runId).not.toBe(runId);
    expect((await getRun(pool,runId))!.brief_id).toBe(before.brief_id);
    const child=(await getRun(pool,first.json().runId))!;expect(child.parent_run_id).toBe(runId);
    expect((await getBrief(pool,child.brief_id)).sourceRestrictions).toContain("url:https://vendor.example/spec");
  });
  it("terminal assumption replace with expectedBriefRevision admits a child and keeps the original question", async () => {
    const {token}=await authed();
    const headers={authorization:`Bearer ${token}`,"idempotency-key":crypto.randomUUID()};
    const runId=(await createRun(token,"best laptop for local AI under 2k")).json().runId as string;
    await pool.query("UPDATE runs SET lifecycle='terminal',terminal_outcome='completed' WHERE id=$1",[runId]);
    const before=(await getRun(pool,runId))!;
    const original=await getBrief(pool,before.brief_id);
    const replaced=await app.inject({
      method:"POST",url:`/v1/runs/${runId}/assumptions`,headers,
      payload:{action:"replace",values:["Quiet fans"],expectedBriefRevision:before.brief_revision},
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().runId).toBeTruthy();
    expect(replaced.json().runId).not.toBe(runId);
    const child=(await getRun(pool,replaced.json().runId as string))!;
    expect(child.parent_run_id).toBe(runId);
    expect((await getBrief(pool,child.brief_id)).originalQuestion).toBe(original.originalQuestion);
    expect((await getBrief(pool,before.brief_id)).originalQuestion).toBe(original.originalQuestion);
  });
  it("rejects malformed cursors, object ids, raw-cast bodies and missing live idempotency", async () => {
    const {token}=await authed();const headers={authorization:`Bearer ${token}`};
    const runId=(await createRun(token,"Compare battery technologies")).json().runId;
    for(const after of ["-1","NaN","1.5","9007199254740992","1&after=2"])
      expect((await app.inject({method:"GET",url:`/v1/runs/${runId}/events?after=${after}`,headers})).statusCode).toBe(400);
    expect((await app.inject({method:"GET",url:"/v1/runs/not-a-uuid",headers})).statusCode).toBe(400);
    expect((await app.inject({method:"POST",url:`/v1/runs/${runId}/assumptions`,headers,payload:{action:"anything"}})).statusCode).toBe(400);
    expect((await app.inject({method:"POST",url:`/v1/runs/${runId}/continue`,headers,payload:{answers:[{field:"geography",value:"Texas"}]}})).statusCode).toBe(400);
    expect((await app.inject({method:"POST",url:`/v1/runs/${runId}/assumptions`,headers,payload:{action:"replace",values:["Quiet fans"]}})).statusCode).toBe(400);
    expect((await app.inject({method:"POST",url:"/v1/consent",headers,payload:{grant:true,admin:true}})).statusCode).toBe(400);
    expect((await app.inject({method:"POST",url:"/v1/runs",headers,payload:{question:"Compare battery technologies",routeMode:"controlled-research"}})).statusCode).toBe(400);
  });
  it("centrally rejects deleted tokens on every sibling read endpoint",async()=>{
    const {token,accountId}=await authed();const headers={authorization:`Bearer ${token}`};
    const runId=(await createRun(token,"Compare battery technologies")).json().runId;
    await pool.query("UPDATE accounts SET deleted_at=now() WHERE id=$1",[accountId]);
    for(const url of ["/v1/session","/v1/library","/v1/settings",`/v1/runs/${runId}/events`,`/v1/runs/${runId}`])
      expect((await app.inject({method:"GET",url,headers})).statusCode).toBe(401);
  });
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
      payload: { pendingInputId: (await getRun(pool,runId))!.pending_input_id, expectedBriefRevision: (await getRun(pool,runId))!.brief_revision, geography: "Germany" },
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

    const afterRun = await getRun(pool, runId);
    expect(afterRun?.brief_revision).toBeGreaterThan(1);
    expect(afterRun?.brief_id).not.toBe(before.rows[0]!.id);
    const restored = await getBrief(pool, afterRun!.brief_id);
    expect(restored.originalQuestion).toBe(ORIGINAL);
    const geo = restored.constraints.find((c) => c.field === "geography" && c.origin === "confirmed");
    expect(geo).toMatchObject({ origin: "confirmed", importance: "hard" });
    expect(String(geo?.value)).toMatch(/germany/i);
    const prior = await getBrief(pool, before.rows[0]!.id);
    expect(prior.constraints.some((c) => c.field === "geography" && c.origin === "confirmed")).toBe(false);
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
      payload: { pendingInputId: (await getRun(pool,runId))!.pending_input_id, expectedBriefRevision: (await getRun(pool,runId))!.brief_revision, geography: "France" },
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
      payload: { pendingInputId: (await getRun(pool,runId))!.pending_input_id, expectedBriefRevision: (await getRun(pool,runId))!.brief_revision,
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

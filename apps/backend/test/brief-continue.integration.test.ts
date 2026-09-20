import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createPool, migrate } from "../src/platform/db.js";
import { processRun } from "../src/worker/diagnostic-executor.js";
import { getBrief, getRun, setPendingInput } from "../src/modules/runs.js";
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
    expect(snapshot.pendingInput).toEqual({id:run.pending_input_id,type:"clarification",briefRevision:run.brief_revision,field:"geography"});
    expect((await app.inject({method:"POST",url:`/v1/runs/${runId}/continue`,headers,payload:{ geography:"France",pendingInputId:crypto.randomUUID(),expectedBriefRevision:run.brief_revision }})).statusCode).toBe(409);
    expect((await app.inject({method:"POST",url:`/v1/runs/${runId}/continue`,headers,payload:{ geography:"France",pendingInputId:run.pending_input_id,expectedBriefRevision:run.brief_revision+1 }})).statusCode).toBe(409);
    expect((await app.inject({method:"POST",url:`/v1/runs/${runId}/assumptions`,headers,payload:{action:"replace",values:["France"],expectedBriefRevision:run.brief_revision}})).statusCode).toBe(409);
    expect((await app.inject({method:"POST",url:`/v1/runs/${runId}/continue`,headers,payload:{ pendingInputId:run.pending_input_id,expectedBriefRevision:run.brief_revision,answers:[{field:"budget",value:"under 2000 USD"}] }})).statusCode).toBe(400);
    expect((await app.inject({method:"POST",url:`/v1/runs/${runId}/assumptions`,headers,payload:{action:"confirm",expectedBriefRevision:run.brief_revision+1}})).statusCode).toBe(409);
    await pool.query("UPDATE runs SET pending_input_type='query_authorization', pending_input_field=NULL WHERE id=$1",[runId]);
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

  it("rejects extra, conflicting, and mixed-field continue answers without mutating the brief", async () => {
    const { token } = await authed();
    const created = await createRun(token, ORIGINAL);
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const before = (await getRun(pool, runId))!;
    const original = await getBrief(pool, before.brief_id);
    const headers = { authorization: `Bearer ${token}` };
    const pending = { pendingInputId: before.pending_input_id, expectedBriefRevision: before.brief_revision };
    expect((await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers })).json().pendingInput.field).toBe("geography");
    expect((await app.inject({
      method: "POST", url: `/v1/runs/${runId}/continue`, headers,
      payload: { ...pending, answers: [{ field: "budget", value: "under $2,000 USD" }] },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "POST", url: `/v1/runs/${runId}/continue`, headers,
      payload: { ...pending, answers: [
        { field: "geography", value: "Germany" },
        { field: "budget", value: "under $2,000 USD" },
      ] },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "POST", url: `/v1/runs/${runId}/continue`, headers,
      payload: { ...pending, answers: [
        { field: "geography", value: "Germany" },
        { field: "geography", value: "France" },
      ] },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "POST", url: `/v1/runs/${runId}/continue`, headers,
      payload: { ...pending, geography: "Germany", answers: [{ field: "geography", value: "France" }] },
    })).statusCode).toBe(400);
    const after = (await getRun(pool, runId))!;
    expect(after.lifecycle).toBe("awaiting_input");
    expect(after.brief_id).toBe(before.brief_id);
    expect(after.brief_revision).toBe(before.brief_revision);
    expect(after.pending_input_id).toBe(before.pending_input_id);
    expect(await getBrief(pool, after.brief_id)).toEqual(original);
    const valid = await app.inject({
      method: "POST", url: `/v1/runs/${runId}/continue`, headers,
      payload: { ...pending, answers: [{ field: "geography", value: "Germany" }] },
    });
    expect(valid.statusCode).toBe(200);
    const resumed = (await getRun(pool, runId))!;
    expect(resumed.lifecycle).toBe("queued");
    expect((await getBrief(pool, resumed.brief_id)).originalQuestion).toBe(ORIGINAL);
    expect((await getBrief(pool, resumed.brief_id)).constraints.some((c) => c.field === "geography" && /germany/i.test(String(c.value)))).toBe(true);
  });

  it("omits pending field when the column is null and refuses to apply a guessed answer", async () => {
    const { token } = await authed();
    const created = await createRun(token, ORIGINAL);
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    await pool.query("UPDATE runs SET pending_input_field=NULL WHERE id=$1", [runId]);
    const headers = { authorization: `Bearer ${token}` };
    const snap = (await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers })).json();
    expect(snap.pendingInput.field).toBeUndefined();
    const before = (await getRun(pool, runId))!;
    expect((await app.inject({
      method: "POST", url: `/v1/runs/${runId}/continue`, headers,
      payload: { pendingInputId: before.pending_input_id, expectedBriefRevision: before.brief_revision, geography: "Germany" },
    })).statusCode).toBe(409);
    expect((await getRun(pool, runId))!.lifecycle).toBe("awaiting_input");
  });

  it("persists a typed budget answer only when budget is the pending field", async () => {
    const { token } = await authed();
    const created = await createRun(token, ORIGINAL);
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    await pool.query("UPDATE runs SET pending_input_field='budget' WHERE id=$1", [runId]);
    const run = (await getRun(pool, runId))!;
    const cont = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/continue`,
      headers: { authorization: `Bearer ${token}` },
      payload: { pendingInputId: run.pending_input_id, expectedBriefRevision: run.brief_revision,
        answers: [{ field: "budget", value: "under $2,000 USD" }] },
    });
    expect(cont.statusCode).toBe(200);
    const brief = await getBrief(pool, (await getRun(pool, runId))!.brief_id);
    expect(brief.originalQuestion).toBe(ORIGINAL);
    expect(brief.constraints.find((c) => c.field === "budget" && c.origin === "confirmed")).toMatchObject({
      operator: "lte", value: "2000", units: "USD",
    });
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

describe("R-04/CL-01 concurrent cancel, declared fields, and sibling continue class", () => {
  async function budgetRows(runId: string, accountId: string) {
    return {
      reservations: (await pool.query<{ state: string }>(
        `SELECT state FROM reservations WHERE run_id=$1 AND account_id=$2 ORDER BY id`,
        [runId, accountId],
      )).rows,
      reserved: (await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM reservations WHERE run_id=$1 AND account_id=$2 AND state='reserved'`,
        [runId, accountId],
      )).rows[0]!.n,
    };
  }

  async function until(check: () => Promise<boolean>) {
    for (let n = 0; n < 200; n++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("expected_database_barrier_not_reached");
  }

  async function gateEvent(runId: string, type: "cancel_requested" | "clarification_answered") {
    const name = `r04_${crypto.randomUUID().replaceAll("-", "")}`;
    const key = crypto.randomUUID();
    await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.run_id::text=TG_ARGV[0] AND NEW.type=TG_ARGV[1] THEN PERFORM pg_advisory_xact_lock(hashtextextended(TG_ARGV[2],0)); END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON run_events FOR EACH ROW EXECUTE FUNCTION ${name}('${runId}','${type}','${key}')`);
    return {
      key,
      cleanup: async () => {
        await pool.query(`DROP TRIGGER IF EXISTS ${name} ON run_events`);
        await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
      },
    };
  }

  async function blocker(key: string) {
    const db = await pool.connect();
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
    const pid = Number((await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    return {
      pid,
      release: async () => {
        await db.query("ROLLBACK");
        db.release();
      },
    };
  }

  async function pausedRun(token: string) {
    const runId = (await createRun(token, ORIGINAL)).json().runId as string;
    await processRun(pool, config, runId);
    const run = (await getRun(pool, runId))!;
    expect(run.lifecycle).toBe("awaiting_input");
    return run;
  }

  it("rejects extra answers when the pending field is a single declared field", async () => {
    const { token, accountId } = await authed();
    const run = await pausedRun(token);
    const headers = { authorization: `Bearer ${token}` };
    const pending = { pendingInputId: run.pending_input_id, expectedBriefRevision: run.brief_revision };
    const original = await getBrief(pool, run.brief_id);
    const money = await budgetRows(run.id, accountId);
    expect((await app.inject({
      method: "POST", url: `/v1/runs/${run.id}/continue`, headers,
      payload: { ...pending, answers: [
        { field: "geography", value: "Indiana" },
        { field: "budget", value: "under $2,000 USD" },
      ] },
    })).statusCode).toBe(400);
    const after = (await getRun(pool, run.id))!;
    expect(after.lifecycle).toBe("awaiting_input");
    expect(after.brief_id).toBe(run.brief_id);
    expect(after.pending_input_id).toBe(run.pending_input_id);
    expect(await getBrief(pool, after.brief_id)).toEqual(original);
    expect(await budgetRows(run.id, accountId)).toEqual(money);
  });

  it("does not resurrect a cancelled pause or leave leftover pending identity", async () => {
    const { token, accountId } = await authed();
    const run = await pausedRun(token);
    const headers = { authorization: `Bearer ${token}` };
    const original = await getBrief(pool, run.brief_id);
    expect((await app.inject({ method: "POST", url: `/v1/runs/${run.id}/cancel`, headers })).statusCode).toBe(200);
    const cancelled = (await getRun(pool, run.id))!;
    expect(cancelled.lifecycle).toBe("terminal");
    expect(cancelled.terminal_outcome).toBe("cancelled");
    expect(cancelled.pending_input_id).toBeNull();
    expect((await app.inject({ method: "GET", url: `/v1/runs/${run.id}`, headers })).json().pendingInput).toBeNull();
    expect((await app.inject({
      method: "POST", url: `/v1/runs/${run.id}/continue`, headers,
      payload: { pendingInputId: run.pending_input_id, expectedBriefRevision: run.brief_revision, geography: "Indiana" },
    })).statusCode).toBe(409);
    const after = (await getRun(pool, run.id))!;
    expect(after.brief_id).toBe(run.brief_id);
    expect(after.brief_revision).toBe(run.brief_revision);
    expect(await getBrief(pool, after.brief_id)).toEqual(original);
    expect((await budgetRows(run.id, accountId)).reserved).toBe("0");
    expect((await budgetRows(run.id, accountId)).reservations.every((row) => row.state === "settled")).toBe(true);
  });

  it("keeps brief, pending, and budget consistent when continue and cancel race", async () => {
    const { token, accountId } = await authed();
    const run = await pausedRun(token);
    const headers = { authorization: `Bearer ${token}` };
    const original = await getBrief(pool, run.brief_id);
    const pending = { pendingInputId: run.pending_input_id, expectedBriefRevision: run.brief_revision };
    const [cont, cancel] = await Promise.all([
      app.inject({ method: "POST", url: `/v1/runs/${run.id}/continue`, headers, payload: { ...pending, geography: "Indiana" } }),
      app.inject({ method: "POST", url: `/v1/runs/${run.id}/cancel`, headers }),
    ]);
    expect(cancel.statusCode).toBe(200);
    expect([200, 409]).toContain(cont.statusCode);
    const after = (await getRun(pool, run.id))!;
    const brief = await getBrief(pool, after.brief_id);
    expect(brief.originalQuestion).toBe(ORIGINAL);
    expect(after.pending_input_id).toBeNull();
    expect(after.lifecycle).not.toBe("awaiting_input");
    expect(["terminal", "cancelling"]).toContain(after.lifecycle);
    expect((await app.inject({ method: "GET", url: `/v1/runs/${run.id}`, headers })).json().pendingInput).toBeNull();
    expect((await budgetRows(run.id, accountId)).reservations).toHaveLength(1);
    if (after.lifecycle === "terminal") {
      expect(after.terminal_outcome).toBe("cancelled");
      expect((await budgetRows(run.id, accountId)).reserved).toBe("0");
    }
    if (cont.statusCode === 200) {
      expect(after.brief_id).not.toBe(run.brief_id);
      expect(brief.constraints.some((c) => c.field === "geography" && /indiana/i.test(String(c.value)))).toBe(true);
    } else {
      expect(after.brief_id).toBe(run.brief_id);
      expect(brief).toEqual(original);
    }
  });

  it("lets cancel win a paused continue without applying the answer", async () => {
    const { token, accountId } = await authed();
    const run = await pausedRun(token);
    const headers = { authorization: `Bearer ${token}` };
    const original = await getBrief(pool, run.brief_id);
    const gate = await gateEvent(run.id, "cancel_requested");
    const lock = await blocker(gate.key);
    let pending: Promise<unknown> | undefined;
    let released = false;
    try {
      const cancel = app.inject({ method: "POST", url: `/v1/runs/${run.id}/cancel`, headers });
      pending = Promise.resolve(cancel);
      await until(async () => Boolean((await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))", [lock.pid])).rowCount));
      const cont = app.inject({
        method: "POST", url: `/v1/runs/${run.id}/continue`, headers,
        payload: { pendingInputId: run.pending_input_id, expectedBriefRevision: run.brief_revision, geography: "Indiana" },
      });
      pending = Promise.all([cancel, cont]);
      await until(async () => Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0")).rows[0].n) >= 2);
      await lock.release();
      released = true;
      const [cancelRes, contRes] = await Promise.all([cancel, cont]);
      expect(cancelRes.statusCode).toBe(200);
      expect(contRes.statusCode).toBe(409);
      const after = (await getRun(pool, run.id))!;
      expect(after.lifecycle).toBe("terminal");
      expect(after.terminal_outcome).toBe("cancelled");
      expect(after.brief_id).toBe(run.brief_id);
      expect(after.pending_input_id).toBeNull();
      expect(await getBrief(pool, after.brief_id)).toEqual(original);
      expect((await budgetRows(run.id, accountId)).reserved).toBe("0");
    } finally {
      if (!released) await lock.release();
      if (pending) await pending;
      await gate.cleanup();
    }
  });

  it("lets continue commit then cancel settle without restoring pending or rewriting the question", async () => {
    const { token, accountId } = await authed();
    const run = await pausedRun(token);
    const headers = { authorization: `Bearer ${token}` };
    const gate = await gateEvent(run.id, "clarification_answered");
    const lock = await blocker(gate.key);
    let pending: Promise<unknown> | undefined;
    let released = false;
    try {
      const cont = app.inject({
        method: "POST", url: `/v1/runs/${run.id}/continue`, headers,
        payload: { pendingInputId: run.pending_input_id, expectedBriefRevision: run.brief_revision, geography: "Indiana" },
      });
      pending = Promise.resolve(cont);
      await until(async () => Boolean((await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))", [lock.pid])).rowCount));
      const cancel = app.inject({ method: "POST", url: `/v1/runs/${run.id}/cancel`, headers });
      pending = Promise.all([cont, cancel]);
      await until(async () => Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0")).rows[0].n) >= 2);
      await lock.release();
      released = true;
      const [contRes, cancelRes] = await Promise.all([cont, cancel]);
      expect(contRes.statusCode).toBe(200);
      expect(cancelRes.statusCode).toBe(200);
      const after = (await getRun(pool, run.id))!;
      const brief = await getBrief(pool, after.brief_id);
      expect(brief.originalQuestion).toBe(ORIGINAL);
      expect(after.brief_id).not.toBe(run.brief_id);
      expect(after.pending_input_id).toBeNull();
      expect(after.lifecycle).toBe("terminal");
      expect(after.terminal_outcome).toBe("cancelled");
      expect(brief.constraints.some((c) => c.field === "geography" && /indiana/i.test(String(c.value)))).toBe(true);
      expect((await budgetRows(run.id, accountId)).reserved).toBe("0");
      expect((await app.inject({ method: "GET", url: `/v1/runs/${run.id}`, headers })).json().pendingInput).toBeNull();
    } finally {
      if (!released) await lock.release();
      if (pending) await pending;
      await gate.cleanup();
    }
  });

  it("keeps sibling follow-up, assumption replace, and empty continue from resuming a pause", async () => {
    const { token } = await authed();
    const run = await pausedRun(token);
    const headers = { authorization: `Bearer ${token}` };
    const original = await getBrief(pool, run.brief_id);
    expect((await app.inject({ method: "POST", url: `/v1/runs/${run.id}/continue`, headers, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({
      method: "POST", url: `/v1/runs/${run.id}/continue`, headers,
      payload: { pendingInputId: run.pending_input_id, expectedBriefRevision: run.brief_revision },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "POST", url: `/v1/runs/${run.id}/continue`, headers,
      payload: { pendingInputId: run.pending_input_id, expectedBriefRevision: run.brief_revision, geography: "   " },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "POST", url: `/v1/runs/${run.id}/follow-up`, headers,
      payload: { message: "Change the budget to $1,500", expectedBriefRevision: run.brief_revision },
    })).statusCode).toBe(409);
    expect((await app.inject({
      method: "POST", url: `/v1/runs/${run.id}/assumptions`, headers,
      payload: { action: "replace", values: ["Quiet fans"], expectedBriefRevision: run.brief_revision },
    })).statusCode).toBe(409);
    const confirmed = await app.inject({
      method: "POST", url: `/v1/runs/${run.id}/assumptions`, headers,
      payload: { action: "confirm", expectedBriefRevision: run.brief_revision },
    });
    expect(confirmed.statusCode).toBe(200);
    const after = (await getRun(pool, run.id))!;
    expect(after.lifecycle).toBe("awaiting_input");
    expect(after.pending_input_id).toBe(run.pending_input_id);
    expect(after.brief_id).toBe(run.brief_id);
    expect((await getBrief(pool, after.brief_id)).originalQuestion).toBe(original.originalQuestion);
  });

  it("continues a paused child without mutating the parent brief or budget", async () => {
    const { token, accountId } = await authed();
    const headers = { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() };
    const parentId = (await createRun(token, "Compare battery technologies")).json().runId as string;
    await pool.query("UPDATE runs SET lifecycle='terminal', terminal_outcome='completed' WHERE id=$1", [parentId]);
    const parentBefore = (await getRun(pool, parentId))!;
    const parentBrief = await getBrief(pool, parentBefore.brief_id);
    const parentMoney = await budgetRows(parentId, accountId);
    const replaced = await app.inject({
      method: "POST", url: `/v1/runs/${parentId}/assumptions`, headers,
      payload: { action: "replace", values: ["Quiet fans"], expectedBriefRevision: parentBefore.brief_revision },
    });
    expect(replaced.statusCode).toBe(200);
    const childId = replaced.json().runId as string;
    expect(childId).not.toBe(parentId);
    const pendingInputId = await setPendingInput(pool, {
      runId: childId, accountId, briefRevision: (await getRun(pool, childId))!.brief_revision, type: "clarification", field: "geography",
    });
    expect((await app.inject({
      method: "POST", url: `/v1/runs/${parentId}/continue`, headers,
      payload: { pendingInputId, expectedBriefRevision: parentBefore.brief_revision, geography: "Indiana" },
    })).statusCode).toBe(409);
    const childCont = await app.inject({
      method: "POST", url: `/v1/runs/${childId}/continue`, headers,
      payload: { pendingInputId, expectedBriefRevision: (await getRun(pool, childId))!.brief_revision, geography: "Indiana" },
    });
    expect(childCont.statusCode).toBe(200);
    const parentAfter = (await getRun(pool, parentId))!;
    expect(parentAfter.brief_id).toBe(parentBefore.brief_id);
    expect(parentAfter.lifecycle).toBe("terminal");
    expect(await getBrief(pool, parentAfter.brief_id)).toEqual(parentBrief);
    expect(await budgetRows(parentId, accountId)).toEqual(parentMoney);
    const child = (await getRun(pool, childId))!;
    expect(child.parent_run_id).toBe(parentId);
    expect(child.lifecycle).toBe("queued");
    expect(child.pending_input_id).toBeNull();
    const childBrief = await getBrief(pool, child.brief_id);
    expect(childBrief.originalQuestion).toBe(parentBrief.originalQuestion);
    expect(childBrief.constraints.some((c) => c.field === "geography" && /indiana/i.test(String(c.value)))).toBe(true);
  });
});

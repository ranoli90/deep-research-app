import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createPool, migrate } from "../src/platform/db.js";

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
  return body;
}

/** Direct owned-run fixture: enough rows for pagination without running the worker. */
async function insertOwnRun(accountId: string, title: string, updatedAt: Date) {
  const conversationId = crypto.randomUUID();
  const briefId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  await pool.query(`INSERT INTO conversations(id,account_id,title,created_at) VALUES($1,$2,$3,$4)`,
    [conversationId, accountId, title, updatedAt]);
  await pool.query(`INSERT INTO research_briefs(id,conversation_id,account_id,original_question,payload,revision)
    VALUES($1,$2,$3,$4,'{}'::jsonb,1)`, [briefId, conversationId, accountId, title]);
  await pool.query(`INSERT INTO runs(id,account_id,conversation_id,brief_id,route_mode,lifecycle,phase,terminal_outcome,brief_revision,consent_epoch,budget_micro,created_at,updated_at)
    VALUES($1,$2,$3,$4,'fixture','terminal','done','completed',1,1,100000,$5,$5)`,
    [runId, accountId, conversationId, briefId, updatedAt]);
  return { runId, conversationId, briefId };
}

async function attachReport(accountId: string, runId: string, text: string, sourceTitle: string) {
  const sourceId = crypto.randomUUID();
  await pool.query(`INSERT INTO sources(id,account_id,run_id,canonical_locator,original_locator,title,source_type)
    VALUES($1,$2,$3,$4,$4,$5,'web')`,
    [sourceId, accountId, runId, `https://example.org/${sourceId}`, sourceTitle]);
  const reportId = crypto.randomUUID();
  await pool.query(`INSERT INTO reports(id,run_id,account_id,version,outcome,basis,blocks,claim_ids,limitations,source_access_summary,route_mode)
    VALUES($1,$2,$3,1,'completed','{}'::jsonb,$4::jsonb,'{}','[]'::jsonb,$5::jsonb,'fixture')`,
    [reportId, runId, accountId,
      JSON.stringify([{ id: crypto.randomUUID(), kind: "text", text, claimIds: [], citationIds: [] }]),
      JSON.stringify([{ sourceId, title: sourceTitle, accessLevel: "public" }])]);
  return { reportId, sourceId };
}

/** Minimal live claimed parent: member binding to a guest-owned run, verified by the exact helper. */
async function insertClaimedParent(memberId: string, title: string, updatedAt: Date) {
  const ownerId = crypto.randomUUID();
  await pool.query(`INSERT INTO accounts(id) VALUES($1)`, [ownerId]);
  const { runId, conversationId } = await insertOwnRun(ownerId, title, updatedAt);
  const guestContextId = crypto.randomUUID();
  const controlVersion = 2;
  await pool.query(`INSERT INTO guest_contexts(id,execution_owner_account_id,conversation_id,sponsor_policy_id,status,control_version,expires_at)
    VALUES($1,$2,$3,'norrow-guest-first.v1','claimed',$4,now()+interval '1 day')`,
    [guestContextId, ownerId, conversationId, controlVersion]);
  await pool.query(`INSERT INTO conversation_control_bindings(id,guest_context_id,guest_conversation_id,member_account_id,control_version,member_deletion_epoch)
    VALUES($1,$2,$3,$4,$5,0)`, [crypto.randomUUID(), guestContextId, conversationId, memberId, controlVersion]);
  await pool.query(`INSERT INTO guest_first_request_receipts(guest_context_id,request_id,request_digest,run_id)
    VALUES($1,$2,$3,$4)`, [guestContextId, crypto.randomUUID(), "0".repeat(64), runId]);
  return { runId, ownerId, guestContextId };
}

async function page(token: string, extra = "") {
  const res = await app.inject({ method: "GET", url: `/v1/library${extra}`, headers: { authorization: `Bearer ${token}` } });
  return res;
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

describe("R10 library history", () => {
  it("paginates more than 100 mixed own and claimed investigations and finds the oldest by search", async () => {
    const member = await authed();
    const stranger = await authed();
    const base = Date.parse("2026-01-01T00:00:00.000Z");

    const ownIds: string[] = [];
    let oldestId = "";
    for (let i = 0; i < 120; i++) {
      const title = i === 0 ? "archived zebra protocol review" : `Own investigation ${String(i).padStart(3, "0")}`;
      const created = await insertOwnRun(member.accountId, title, new Date(base + i * 1000));
      ownIds.push(created.runId);
      if (i === 0) {
        oldestId = created.runId;
        await attachReport(member.accountId, created.runId, "Zebra protocol final answer text.", "Zebra protocol source");
      }
    }
    const claimed = await insertClaimedParent(member.accountId, "claimed llama migration analysis", new Date(base + 5000));
    const strangerRun = await insertOwnRun(stranger.accountId, "stranger secret investigation", new Date(base + 6000));
    const strangerId = strangerRun.runId;

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await page(member.token, cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: { id: string }[]; nextCursor: string | null };
      for (const item of body.items) seen.push(item.id);
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 25);

    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(121);
    expect(seen).toContain(claimed.runId);
    expect(seen).not.toContain(strangerId);

    const search = await page(member.token, "?q=zebra");
    expect(search.statusCode).toBe(200);
    const found = search.json().items as { id: string; preview: string | null; source_count: number; updated_at: string; status: string }[];
    const oldest = found.find((item) => item.id === oldestId);
    expect(oldest).toBeTruthy();
    expect(oldest!.preview).toMatch(/Zebra protocol/);
    expect(oldest!.source_count).toBe(1);
    expect(oldest!.updated_at).toBeTruthy();
    expect(oldest!.status).toBe("completed");

    const claimedSearch = await page(member.token, "?q=llama");
    expect((claimedSearch.json().items as { id: string }[]).map((item) => item.id)).toContain(claimed.runId);

    const empty = await page(member.token, "?q=no-such-investigation-anywhere");
    expect(empty.statusCode).toBe(200);
    expect(empty.json().items).toEqual([]);
  });

  it("keeps strict query validation for the library route", async () => {
    const member = await authed();
    expect((await page(member.token, "?owner=other")).statusCode).toBe(400);
    expect((await page(member.token, "?cursor=not-a-cursor")).statusCode).toBe(400);
    expect((await page(member.token, "?limit=0")).statusCode).toBe(400);
  });

  it("does not duplicate a row or cross accounts when paging across an insert and a deletion", async () => {
    const member = await authed();
    const stranger = await authed();
    const base = Date.parse("2026-02-01T00:00:00.000Z");

    const owned = new Map<string, { conversationId: string; briefId: string }>();
    for (let i = 0; i < 60; i++) {
      const created = await insertOwnRun(member.accountId, `Paged investigation ${String(i).padStart(3, "0")}`, new Date(base + i * 1000));
      owned.set(created.runId, { conversationId: created.conversationId, briefId: created.briefId });
    }
    const strangerRun = await insertOwnRun(stranger.accountId, "stranger paged investigation", new Date(base + 70_000));

    const first = await page(member.token, "?limit=20");
    const firstBody = first.json() as { items: { id: string }[]; nextCursor: string | null };
    const seen = firstBody.items.map((item) => item.id);
    expect(seen.length).toBe(20);

    // A new newest row and a deletion of an un-fetched older row happen mid-pagination.
    await insertOwnRun(member.accountId, "inserted mid-pagination", new Date(base + 100_000));
    const victim = [...owned.keys()][5]!;
    const victimRows = owned.get(victim)!;
    await pool.query("DELETE FROM runs WHERE id=$1", [victim]);
    await pool.query("DELETE FROM research_briefs WHERE id=$1", [victimRows.briefId]);
    await pool.query("DELETE FROM conversations WHERE id=$1", [victimRows.conversationId]);
    owned.delete(victim);

    let cursor = firstBody.nextCursor;
    let pages = 1;
    while (cursor && pages < 25) {
      const res = await page(member.token, `?limit=20&cursor=${encodeURIComponent(cursor)}`);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: { id: string }[]; nextCursor: string | null };
      for (const item of body.items) seen.push(item.id);
      cursor = body.nextCursor;
      pages++;
    }

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).not.toContain(strangerRun.runId);
    for (const id of seen) expect(owned.has(id)).toBe(true);
    expect(seen).not.toContain(victim);
  });
});

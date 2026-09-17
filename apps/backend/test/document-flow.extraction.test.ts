import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import type pg from "pg";
import { buildApp } from "../src/api/app.js";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createQueue } from "../src/adapters/queue.js";
import { processRun } from "../src/worker/executor.js";
import { ingestAttachments } from "../src/worker/attachment-ingestion.js";
import { claimLease, getBrief, getRun } from "../src/modules/runs.js";
import { fencedSession } from "../src/worker/fenced-session.js";
let app: FastifyInstance, pool: pg.Pool, boss: PgBoss, config: AppConfig;
beforeAll(async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
  pool = createPool(databaseUrl); await migrate(pool); boss = await createQueue(databaseUrl);
  config = loadConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, APP_AUTH_MODE: "development", DEV_ALLOW_FIXTURE_ROUTE: "true", WRITING_CANCEL_WINDOW_MS: "1" });
  app = await buildApp({ pool, boss, config });
});
afterAll(async () => { await app.close(); await boss.stop({ graceful: false, timeout: 2000 }); await pool.end(); });
async function setup() {
  const session = (await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} })).json();
  const headers = { authorization: `Bearer ${session.token}` };
  expect((await app.inject({ method: "POST", url: "/v1/consent", headers, payload: { grant: true } })).statusCode).toBe(200);
  const bytes = await readFile(new URL("./fixtures/documents/digital-scoped.pdf", import.meta.url));
  const uploaded = await app.inject({ method: "POST", url: "/v1/attachments/bytes", headers: { ...headers,
    "content-type": "application/octet-stream", "x-document-mime": "application/pdf", "x-file-name": "field-notes.pdf" }, payload: bytes });
  expect(uploaded.statusCode).toBe(201);
  const attachmentId = uploaded.json().attachmentId;
  const response = await app.inject({ method: "POST", url: "/v1/runs", headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    payload: { question: "What does the supplied Ardent field note say about underwater recording?", routeMode: "fixture", attachmentIds: [attachmentId] } });
  expect(response.statusCode).toBe(200);
  return { accountId: session.accountId, headers, attachmentId, runId: response.json().runId, bytes };
}
it("W04 real API/worker persists PDF bytes, page locators and limitations; source inspection and deletion use the same records", async () => {
  const task = await setup(); await processRun(pool, config, task.runId);
  const att = (await pool.query("SELECT processing_state,extraction FROM attachments WHERE id=$1", [task.attachmentId])).rows[0];
  expect(att.processing_state).toBe("partially_read"); expect(att.extraction.blocks).toHaveLength(2);
  const passages = (await pool.query("SELECT p.* FROM passages p JOIN source_versions v ON v.id=p.source_version_id JOIN sources s ON s.id=v.source_id WHERE s.canonical_locator=$1 AND p.run_id=$2 ORDER BY p.locator->>'block'", [`attachment://${task.attachmentId}`, task.runId])).rows;
  expect(passages).toHaveLength(2);
  const reopened = await app.inject({ method: "GET", url: `/v1/sources/${passages[1].id}`, headers: task.headers });
  expect(reopened.statusCode).toBe(200); expect(reopened.json().passageLocator.block).toBe("page:2/block:0");
  expect(reopened.json().exactText).toContain("This result does not apply to immersion or cold weather.");
  expect(reopened.json().warnings).toContain("pdf_layout_tables_and_ocr_unverified");
  expect(reopened.json().accessLevel).toBe("partial-text");
  const artifact = (await pool.query("SELECT a.body FROM evidence_artifacts a JOIN extraction_receipts r ON r.artifact_id=a.id WHERE r.source_version_id=$1", [passages[0].source_version_id])).rows[0];
  expect(artifact.body).toEqual(task.bytes);
  expect((await app.inject({ method: "POST", url: "/v1/account/deletion", headers: task.headers })).statusCode).toBe(200);
  const purged = (await pool.query("SELECT raw_bytes,extraction FROM attachments WHERE id=$1", [task.attachmentId])).rows[0];
  expect(purged.raw_bytes).toBeNull(); expect(purged.extraction).toBeNull();
  expect((await app.inject({ method: "GET", url: `/v1/sources/${passages[1].id}`, headers: task.headers })).statusCode).toBe(401);
});
it.each(["cancel", "delete"])("W04 %s after actual parsing prevents late result persistence", async (action) => {
  const task = await setup(), owner = crypto.randomUUID();
  const run = (await getRun(pool, task.runId))!, brief = await getBrief(pool, run.brief_id);
  const fence = (await withTx(pool, (db) => claimLease(db, run.id, owner, 30_000)))!;
  const session = fencedSession(pool, { runId: run.id, accountId: run.account_id, owner, fence, briefRevision: run.brief_revision, leaseMs: 30_000 });
  let writes = 0;
  try {
    await expect(ingestAttachments(pool, run, brief, { ...session, write: async (fn, revoked) => {
      if (++writes === 2) {
        const result = await app.inject({ method: "POST", url: action === "delete" ? "/v1/account/deletion" : `/v1/runs/${run.id}/cancel`, headers: task.headers });
        expect(result.statusCode).toBe(200);
      }
      return session.write(fn, revoked);
    } })).rejects.toThrow("stale_worker");
    expect((await pool.query("SELECT 1 FROM passages WHERE run_id=$1", [run.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT extraction FROM attachments WHERE id=$1", [task.attachmentId])).rows[0].extraction).toBeNull();
  } finally { session.stop(); }
});

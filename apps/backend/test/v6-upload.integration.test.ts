import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import type pg from "pg";
import { buildApp } from "../src/api/app.js";
import { createPool, migrate } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";
import { createQueue } from "../src/adapters/queue.js";
let app: FastifyInstance, pool: pg.Pool, boss: PgBoss;
beforeAll(async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
  pool = createPool(databaseUrl); await migrate(pool); boss = await createQueue(databaseUrl);
  app = await buildApp({ pool, boss, config: loadConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, APP_AUTH_MODE: "development", DEV_ALLOW_FIXTURE_ROUTE: "true" }) });
});
afterAll(async () => { await app.close(); await boss.stop({ graceful: false, timeout: 2000 }); await pool.end(); });
async function login() { return (await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} })).json(); }
it("W04 rejects pasted notes masquerading as PDF while preserving explicit text notes", async () => {
  const session = await login(), headers = { authorization: `Bearer ${session.token}` };
  const falsePdf = await app.inject({ method: "POST", url: "/v1/attachments", headers, payload: { filename: "scan.pdf", mime: "application/pdf", text: "page 1 only" } });
  expect(falsePdf.statusCode).toBe(400);
  const note = await app.inject({ method: "POST", url: "/v1/attachments", headers, payload: { filename: "note.txt", mime: "text/plain", text: "A real pasted note." } });
  expect(note.statusCode).toBe(200); expect(note.json().coverage).toBe("complete");
});
it("W04 stores actual bounded binary bytes and digest with no fabricated extraction, under owner scope", async () => {
  const session = await login();
  const bytes = await readFile(new URL("./fixtures/documents/digital-scoped.pdf", import.meta.url));
  const headers = { authorization: `Bearer ${session.token}`, "content-type": "application/octet-stream", "x-document-mime": "application/pdf", "x-file-name": "original.pdf" };
  const response = await app.inject({ method: "POST", url: "/v1/attachments/bytes", headers, payload: bytes });
  expect(response.statusCode).toBe(201); expect(response.json().processingState).toBe("stored");
  const row = (await pool.query("SELECT * FROM attachments WHERE id=$1", [response.json().attachmentId])).rows[0];
  expect(row.raw_bytes).toEqual(bytes); expect(row.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(row.account_id).toBe(session.accountId); expect(row.extracted_text).toBeNull();
  const invalid = await app.inject({ method: "POST", url: "/v1/attachments/bytes", headers, payload: Buffer.from("fake PDF text") });
  expect(invalid.statusCode).toBe(400);
  const unauthenticated = await app.inject({ method: "POST", url: "/v1/attachments/bytes", headers: { "content-type": "application/octet-stream" }, payload: bytes });
  expect(unauthenticated.statusCode).toBe(401);
  const other = await login();
  expect((await app.inject({ method: "GET", url: `/v1/attachments/${row.id}`, headers: { authorization: `Bearer ${other.token}` } })).statusCode).toBe(404);
  const metadata = await app.inject({ method: "GET", url: `/v1/attachments/${row.id}`, headers: { authorization: `Bearer ${session.token}` } });
  expect(metadata.statusCode).toBe(200); expect(metadata.body).not.toContain("raw_bytes");
});

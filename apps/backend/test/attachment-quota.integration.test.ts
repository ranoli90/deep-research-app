import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import type PgBoss from "pg-boss";
import type { FastifyInstance } from "fastify";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { createDevSession, deleteAccount } from "../src/modules/access.js";
import {
  attachmentStorageExposure,
  attachmentStorageUsage,
  expireAbandonedAttachmentReservations,
  reserveAttachmentUpload,
} from "../src/modules/attachments.js";

const url = process.env.TEST_DATABASE_URL!;
let pool: pg.Pool, boss: PgBoss;
const apps: FastifyInstance[] = [];
const accounts: string[] = [];

beforeAll(async () => { pool = createPool(url); await migrate(pool); boss = await createQueue(url); });
afterEach(async () => {
  for (const id of accounts.splice(0)) await withTx(pool, async (db) => {
    await deleteAccount(db, id);
    await db.query("DELETE FROM file_deletion_outbox WHERE account_id=$1", [id]);
    await db.query("DELETE FROM attachments WHERE account_id=$1", [id]);
    for (const table of ["research_briefs", "conversations", "allowance_accounts", "sessions", "consent_records", "tombstones"])
      await db.query(`DELETE FROM ${table} WHERE account_id=$1`, [id]);
    await db.query("DELETE FROM accounts WHERE id=$1", [id]);
  });
});
afterAll(async () => {
  for (const app of apps) await app.close();
  await boss.stop({ graceful: false, timeout: 2000 });
  await pool.end();
});

async function makeApp(env: Record<string, string> = {}): Promise<{ app: FastifyInstance; config: AppConfig }> {
  const config = loadConfig({ NODE_ENV: "test", APP_AUTH_MODE: "development", DATABASE_URL: url, ...env });
  const app = await buildApp({ pool, boss, config });
  apps.push(app);
  return { app, config };
}
async function account() { const s = await withTx(pool, createDevSession); accounts.push(s.accountId); return s; }
function upload(app: FastifyInstance, token: string, bytes: Buffer, key?: string) {
  return app.inject({ method: "POST", url: "/v1/attachments/bytes",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream",
      "x-document-mime": "text/plain", "x-file-name": "note.txt", ...(key ? { "idempotency-key": key } : {}) },
    payload: bytes });
}

it("R12 enforces a per-account byte quota before storing bytes and keeps committed usage", async () => {
  const { app } = await makeApp({ ATTACHMENT_ACCOUNT_BYTE_QUOTA: "10" });
  const owner = await account();
  const first = await upload(app, owner.token, Buffer.from("xxxxxx"));
  expect(first.statusCode).toBe(201);
  const denied = await upload(app, owner.token, Buffer.from("yyyyyy"));
  expect(denied.statusCode).toBe(413);
  expect(denied.json()).toMatchObject({ code: "storage_quota_exceeded" });
  expect(denied.json().message).toContain("still on this device");
  expect((await pool.query("SELECT COUNT(*)::int n FROM attachments WHERE account_id=$1 AND deleted_at IS NULL", [owner.accountId])).rows[0].n).toBe(1);
  expect(await attachmentStorageUsage(pool, owner.accountId)).toMatchObject({ committedBytes: 6, committedObjects: 1, reservedBytes: 0, reservedObjects: 0 });
});

it("R12 enforces a per-account object quota", async () => {
  const { app } = await makeApp({ ATTACHMENT_ACCOUNT_OBJECT_QUOTA: "1" });
  const owner = await account();
  expect((await upload(app, owner.token, Buffer.from("one"))).statusCode).toBe(201);
  const denied = await upload(app, owner.token, Buffer.from("two"));
  expect(denied.statusCode).toBe(413);
  expect(denied.json().code).toBe("storage_quota_exceeded");
});

it("R12 bounds the per-account upload admission rate", async () => {
  const { app } = await makeApp({ ATTACHMENT_ADMISSION_LIMIT: "2" });
  const owner = await account();
  expect((await upload(app, owner.token, Buffer.from("one"))).statusCode).toBe(201);
  expect((await upload(app, owner.token, Buffer.from("two"))).statusCode).toBe(201);
  const denied = await upload(app, owner.token, Buffer.from("three"));
  expect(denied.statusCode).toBe(413);
  expect(denied.json().code).toBe("storage_quota_exceeded");
});

it("R12 enforces the global storage exposure control across accounts", async () => {
  const S = 8, baseline = await attachmentStorageExposure(pool);
  const { app } = await makeApp({ ATTACHMENT_GLOBAL_BYTE_QUOTA: String(baseline.committedBytes + baseline.reservedBytes + 2 * S) });
  const a = await account(), b = await account();
  expect((await upload(app, a.token, Buffer.from("a".repeat(S)))).statusCode).toBe(201);
  expect((await upload(app, b.token, Buffer.from("b".repeat(S)))).statusCode).toBe(201);
  const denied = await upload(app, a.token, Buffer.from("c".repeat(S)));
  expect(denied.statusCode).toBe(413);
  expect(denied.json().code).toBe("storage_quota_exceeded");
});

it("R12 concurrent unique uploads cannot oversubscribe the same account quota", async () => {
  const S = 8;
  const { app } = await makeApp({ ATTACHMENT_ACCOUNT_BYTE_QUOTA: String(3 * S) });
  const owner = await account();
  const results = await Promise.all(Array.from({ length: 8 }, () => upload(app, owner.token, Buffer.from("x".repeat(S)))));
  const statuses = results.map((r) => r.statusCode);
  expect(statuses.filter((s) => s === 201)).toHaveLength(3);
  expect(statuses.filter((s) => s === 413)).toHaveLength(5);
  expect((await pool.query("SELECT COUNT(*)::int n FROM attachments WHERE account_id=$1 AND deleted_at IS NULL", [owner.accountId])).rows[0].n).toBe(3);
  expect(await attachmentStorageUsage(pool, owner.accountId)).toMatchObject({ committedBytes: 3 * S, committedObjects: 3, reservedBytes: 0 });
});

it("R12 an idempotent retry does not double-debit storage", async () => {
  const { app } = await makeApp();
  const owner = await account(), key = crypto.randomUUID(), bytes = Buffer.from("retry content");
  const first = await upload(app, owner.token, bytes, key);
  expect(first.statusCode).toBe(201);
  const before = await attachmentStorageUsage(pool, owner.accountId);
  const replay = await upload(app, owner.token, bytes, key);
  expect(replay.statusCode).toBe(201);
  expect(replay.json().attachmentId).toBe(first.json().attachmentId);
  expect(await attachmentStorageUsage(pool, owner.accountId)).toEqual(before);
  expect((await pool.query("SELECT COUNT(*)::int n FROM attachment_storage_reservations WHERE account_id=$1", [owner.accountId])).rows[0].n).toBe(1);
});

it("R12 a rejected write releases its reservation without committing storage", async () => {
  const { app } = await makeApp();
  const owner = await account();
  const rejected = await app.inject({ method: "POST", url: "/v1/attachments/bytes",
    headers: { authorization: `Bearer ${owner.token}`, "content-type": "application/octet-stream",
      "x-document-mime": "application/pdf", "x-file-name": "not-a.pdf", "idempotency-key": crypto.randomUUID() },
    payload: Buffer.from("definitely not a pdf") });
  expect(rejected.statusCode).toBe(400);
  expect(await attachmentStorageUsage(pool, owner.accountId)).toMatchObject({ committedBytes: 0, reservedBytes: 0 });
  expect((await pool.query("SELECT state FROM attachment_storage_reservations WHERE account_id=$1", [owner.accountId])).rows)
    .toEqual([{ state: "released" }]);
});

it("R12 account deletion releases committed storage and live reservations", async () => {
  const { app, config } = await makeApp();
  const owner = await account();
  expect((await upload(app, owner.token, Buffer.from("kept content"))).statusCode).toBe(201);
  const live = await reserveAttachmentUpload(pool, config, { accountId: owner.accountId, sizeBytes: 32 });
  expect(live.reused).toBe(false);
  expect(await attachmentStorageUsage(pool, owner.accountId)).toMatchObject({ committedBytes: 12, reservedBytes: 32 });
  await deleteAccount(pool, owner.accountId);
  expect(await attachmentStorageUsage(pool, owner.accountId)).toMatchObject({ committedBytes: 0, reservedBytes: 0 });
});

it("R12 an abandoned reservation stops counting and is expired safely", async () => {
  const { config } = await makeApp();
  const owner = await account();
  const live = await reserveAttachmentUpload(pool, config, { accountId: owner.accountId, sizeBytes: 64 });
  expect(await attachmentStorageUsage(pool, owner.accountId)).toMatchObject({ reservedBytes: 64, reservedObjects: 1 });
  await pool.query("UPDATE attachment_storage_reservations SET expires_at=now()-interval '1 minute' WHERE id=$1", [live.id]);
  expect(await attachmentStorageUsage(pool, owner.accountId)).toMatchObject({ reservedBytes: 0, reservedObjects: 0 });
  expect(await withTx(pool, (db) => expireAbandonedAttachmentReservations(db, owner.accountId))).toBe(1);
  expect((await pool.query("SELECT state FROM attachment_storage_reservations WHERE id=$1", [live.id])).rows[0].state).toBe("expired");
});

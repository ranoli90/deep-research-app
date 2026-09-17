import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import { createPool, migrate } from "../src/platform/db.js";
import { accountForIdentity } from "../src/modules/identity.js";
import { createDevSession, deleteAccount } from "../src/modules/access.js";
import { loadConfig } from "../src/platform/config.js";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";

let pool: pg.Pool, app: FastifyInstance, boss: PgBoss;
const issuer = "https://test-project.supabase.co/auth/v1";
beforeAll(async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
  pool = createPool(databaseUrl); await migrate(pool); boss = await createQueue(databaseUrl);
  const config = loadConfig({ NODE_ENV: "production", APP_AUTH_MODE: "production", DEV_ALLOW_FIXTURE_ROUTE: "false",
    DATABASE_URL: databaseUrl, SUPABASE_URL: "https://test-project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only" });
  app = await buildApp({ pool, boss, config });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await app.close(); await boss.stop({ graceful: false, timeout: 2000 }); await pool.end(); });

it("W03 concurrent verified identity mapping creates one owner and no implicit spend allowance", async () => {
  const identity = { issuer, subject: crypto.randomUUID() };
  const results = await Promise.all(Array.from({ length: 8 }, () => accountForIdentity(pool, identity)));
  expect(new Set(results.map((r) => r?.accountId)).size).toBe(1);
  const accountId = results[0]!.accountId;
  expect((await pool.query("SELECT count(*)::int AS n FROM external_identities WHERE account_id=$1", [accountId])).rows[0].n).toBe(1);
  expect((await pool.query("SELECT limit_micro FROM allowance_accounts WHERE account_id=$1", [accountId])).rows[0].limit_micro).toBe("0");
  const otherIssuer = await accountForIdentity(pool, { ...identity, issuer: "https://other.supabase.co/auth/v1" });
  expect(otherIssuer?.accountId).not.toBe(accountId);
  await deleteAccount(pool, accountId);
  expect(await accountForIdentity(pool, identity)).toBeNull();
  expect((await pool.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NOT NULL", [accountId])).rowCount).toBe(1);
});

it("W03 production rejects local sessions and never falls back when the real verifier is unavailable", async () => {
  const local = await createDevSession(pool);
  const transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport);
  expect((await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} })).statusCode).toBe(403);
  expect((await app.inject({ method: "GET", url: "/v1/library", headers: { authorization: `Bearer ${local.token}` } })).statusCode).toBe(401);
  expect(transport).not.toHaveBeenCalled();
  transport.mockRejectedValue(new Error("network unavailable"));
  expect((await app.inject({ method: "GET", url: "/v1/library", headers: { authorization: "Bearer test.header.signature" } })).statusCode).toBe(503);
});

it("W03 production API resolves authoritative identity and deletion remains denied even with a still-valid provider token", async () => {
  const subject = crypto.randomUUID();
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: subject, aud: "authenticated",
    role: "authenticated", is_anonymous: false, email_confirmed_at: "2026-09-01T00:00:00Z", user_metadata: { accountId: crypto.randomUUID() } })));
  const headers = { authorization: "Bearer test.header.signature" };
  const session = await app.inject({ method: "GET", url: "/v1/session", headers });
  expect(session.statusCode).toBe(200);
  expect(session.json().accountId).not.toBe(subject);
  expect((await app.inject({ method: "GET", url: "/v1/library", headers })).json()).toEqual({ items: [] });
  const deleted = await app.inject({ method: "POST", url: "/v1/account/deletion", headers });
  expect(deleted.statusCode).toBe(200);
  expect((await app.inject({ method: "GET", url: "/v1/session", headers })).statusCode).toBe(401);
  expect((await pool.query("SELECT account_id FROM external_identities WHERE account_id=$1", [session.json().accountId])).rowCount).toBe(1);
});

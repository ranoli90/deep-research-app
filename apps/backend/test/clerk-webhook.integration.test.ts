import { createHmac, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyClerkWebhook } from "../src/adapters/auth/clerk-webhook.js";
import { applyClerkWebhookEvent } from "../src/modules/clerk-revocation.js";
import { accountForIdentity, identityDigest } from "../src/modules/identity.js";
import { createPool, migrate } from "../src/platform/db.js";

const adminUrl = process.env.TEST_DATABASE_URL ??
  "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
const database = `deep_clerk_webhook_${process.pid}_${randomBytes(4).toString("hex")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${database}`;
const admin = new pg.Client({ connectionString: adminUrl });
const signingKey = randomBytes(32);
const config = { signingSecret: `whsec_${signingKey.toString("base64")}`,
  expectedInstanceId: "ins_syntheticStage1", issuer: "https://synthetic.clerk.accounts.dev" };
let pool: pg.Pool;

function signed(kind: string, data: Record<string, unknown>, eventId = `msg_${randomBytes(8).toString("hex")}`) {
  const body = Buffer.from(JSON.stringify({ object: "event", type: kind,
    instance_id: config.expectedInstanceId, timestamp: Date.now(), data }));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", signingKey).update(`${eventId}.${timestamp}.`).update(body).digest("base64");
  return { body, headers: { "svix-id": eventId, "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}` } };
}

async function deliver(kind: string, data: Record<string, unknown>, eventId?: string) {
  const message = signed(kind, data, eventId);
  return applyClerkWebhookEvent(pool, await verifyClerkWebhook(message.body, message.headers, config));
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  pool = createPool(databaseUrl.toString());
  await migrate(pool);
  // This suite is intentionally not runnable on the old a15accf base: owner
  // migration 054 and identityDigest must be merged before its evidence counts.
  const schema = await pool.query("SELECT to_regclass('public.clerk_webhook_receipts') AS receipts");
  if (!schema.rows[0]?.receipts) throw new Error("requires_owner_054_integration");
}, 120_000);

afterAll(async () => {
  await pool?.end();
  const active = await admin.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname=$1", [database]);
  if (Number(active.rows[0]?.count) !== 0) throw new Error("clerk_webhook_test_clients_remain");
  await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
  await admin.end();
}, 30_000);

describe("verified Clerk webhook durable effects", () => {
  it("AUTH-09/10 dedupes an event, rejects a changed digest and tombstones one exact session", async () => {
    const eventId = `msg_${randomBytes(8).toString("hex")}`;
    const message = signed("session.revoked", { id: "sess_Synthetic1", user_id: "user_Synthetic1" }, eventId);
    const verified = await verifyClerkWebhook(message.body, message.headers, config);
    const concurrent = await Promise.all([
      applyClerkWebhookEvent(pool, verified), applyClerkWebhookEvent(pool, verified),
    ]);
    expect(concurrent.map((result) => result.reused).sort()).toEqual([false, true]);
    expect(await applyClerkWebhookEvent(pool, verified)).toEqual({ reused: true });
    await expect(deliver("session.revoked", { id: "sess_Synthetic2", user_id: "user_Synthetic1" }, eventId))
      .rejects.toThrow("clerk_webhook_replay_mismatch");
    expect(await deliver("session.ended", { id: "sess_Synthetic1", user_id: "user_Synthetic1" }))
      .toEqual({ reused: false });
    const rows = await pool.query("SELECT session_id FROM clerk_revoked_sessions WHERE session_id LIKE 'sess_Synthetic%' ");
    expect(rows.rows).toEqual([{ session_id: "sess_Synthetic1" }]);
  });

  it("AUTH-10/11 deletes a mapped member and delayed create/update cannot resurrect it", async () => {
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const mapped = await accountForIdentity(pool, { issuer: config.issuer, subject });
    expect(mapped).not.toBeNull();
    expect(await deliver("user.deleted", { id: subject })).toEqual({ reused: false });
    const digest = identityDigest(config.issuer, subject);
    const deleted = await pool.query(`SELECT a.deleted_at,a.deletion_epoch FROM external_identities i
      JOIN accounts a ON a.id=i.account_id WHERE i.identity_digest=$1`, [digest]);
    expect(deleted.rows[0]?.deleted_at).toBeTruthy();
    expect(Number(deleted.rows[0]?.deletion_epoch)).toBeGreaterThan(0);
    expect(await pool.query("SELECT 1 FROM clerk_deleted_subjects WHERE identity_digest=$1", [digest]))
      .toMatchObject({ rowCount: 1 });
    expect(await deliver("user.created", { id: subject })).toEqual({ reused: false });
    expect(await deliver("user.updated", { id: subject, email_addresses: [{ email_address: "other@example.test" }] }))
      .toEqual({ reused: false });
    expect(await accountForIdentity(pool, { issuer: config.issuer, subject })).toBeNull();
  });

  it("AUTH-10 deletion arriving before first login and racing a login remains a monotone deny", async () => {
    const early = `user_${randomBytes(8).toString("hex")}`;
    expect(await deliver("user.deleted", { id: early })).toEqual({ reused: false });
    expect(await accountForIdentity(pool, { issuer: config.issuer, subject: early })).toBeNull();
    await deliver("user.created", { id: early });
    expect(await accountForIdentity(pool, { issuer: config.issuer, subject: early })).toBeNull();

    const raced = `user_${randomBytes(8).toString("hex")}`;
    const otherPool = createPool(databaseUrl.toString());
    try {
      await Promise.all([
        accountForIdentity(otherPool, { issuer: config.issuer, subject: raced }),
        deliver("user.deleted", { id: raced }),
      ]);
      expect(await accountForIdentity(pool, { issuer: config.issuer, subject: raced })).toBeNull();
      const live = await pool.query(`SELECT count(*)::int AS count FROM external_identities i
        JOIN accounts a ON a.id=i.account_id WHERE i.identity_digest=$1 AND a.deleted_at IS NULL`,
      [identityDigest(config.issuer, raced)]);
      expect(live.rows[0].count).toBe(0);
    } finally {
      await otherPool.end();
    }
  });
});

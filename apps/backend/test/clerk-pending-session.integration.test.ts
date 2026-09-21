import { createHmac, generateKeyPairSync, randomBytes, randomUUID, sign, type KeyObject } from "node:crypto";
import pg from "pg";
import type PgBoss from "pg-boss";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountForIdentity, identityDigest } from "../src/modules/identity.js";
import { createPool, migrate } from "../src/platform/db.js";
import { createQueue } from "../src/adapters/queue.js";
import { buildApp } from "../src/api/app.js";
import { loadConfig } from "../src/platform/config.js";

/**
 * AUD01: a pending Clerk session bearer is denied at the authoritative backend
 * before ordinary member access, while signature/issuer/audience-expiry,
 * revocation and deletion-tombstone controls keep firing.
 *
 * Real `@clerk/backend verifyToken` + live `app.inject` HTTP boundary, local
 * synthetic RSA-2048 keys, isolated scratch database. No live Clerk calls.
 */
const adminUrl = process.env.TEST_DATABASE_URL ??
  "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
const database = `deep_clerk_pending_${process.pid}_${randomBytes(4).toString("hex")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${database}`;
const admin = new pg.Client({ connectionString: adminUrl });
const signingKey = randomBytes(32);
const jwtKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attackerKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwtPublicKey = jwtKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
const config = { signingSecret: `whsec_${signingKey.toString("base64")}`,
  expectedInstanceId: "ins_syntheticStage1", issuer: "https://synthetic.clerk.accounts.dev" };
let pool: pg.Pool;
let boss: PgBoss;
let app: FastifyInstance;

type SessionStatus = { sts?: string; status?: string; session_status?: string; sessionStatus?: string };

function pendingCapableToken(subject: string, sessionId: string, expiresInSeconds = 300,
  key: KeyObject = jwtKeys.privateKey, party: string | null = "https://synthetic.app.test",
  sessionState: SessionStatus = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "synthetic" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: config.issuer, sub: subject, sid: sessionId,
    iat: now, nbf: now - 1, exp: now + expiresInSeconds,
    ...(party === null ? {} : { azp: party }), ...sessionState })).toString("base64url");
  const input = `${header}.${payload}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")}`;
}

function sessionWith(token: string) {
  return app.inject({ method: "GET", url: "/v1/session",
    headers: { authorization: `Bearer ${token}` } });
}

async function mapped(subject: string): Promise<boolean> {
  return (await pool.query("SELECT 1 FROM external_identities WHERE identity_digest=$1",
    [identityDigest(config.issuer, subject)])).rowCount !== 0;
}

function signed(kind: string, data: Record<string, unknown>, eventId = `msg_${randomBytes(8).toString("hex")}`) {
  const body = Buffer.from(JSON.stringify({ object: "event", type: kind,
    instance_id: config.expectedInstanceId, timestamp: Date.now(), data }));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", signingKey).update(`${eventId}.${timestamp}.`).update(body).digest("base64");
  return { body, headers: { "svix-id": eventId, "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}` } };
}

async function enabledGuest() {
  const bootstrap = await app.inject({ method: "POST", url: "/v1/guest/bootstrap", payload: {} });
  expect(bootstrap.statusCode).toBe(201);
  const guest = bootstrap.json() as { guestContextId: string; conversationId: string; proof: string };
  return guest;
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  pool = createPool(databaseUrl.toString());
  await migrate(pool);
  const schema = await pool.query("SELECT to_regclass('public.clerk_webhook_receipts') AS receipts");
  if (!schema.rows[0]?.receipts) throw new Error("requires_owner_054_integration");
  await pool.query(`UPDATE guest_sponsor_policies SET enabled=true,killed=false,exposure_cap_micro=100000,
    per_guest_cap_micro=100000,bootstrap_limit_per_risk=100,expires_at=now()+interval '1 day' WHERE id='norrow-guest-first.v1'`);
  boss = await createQueue(databaseUrl.toString());
  app = await buildApp({ pool, boss, config: loadConfig({ NODE_ENV: "test", APP_AUTH_MODE: "production",
    APP_IDENTITY_PROVIDER: "clerk", DATABASE_URL: databaseUrl.toString(),
    CLERK_ISSUER: config.issuer, CLERK_AUTHORIZED_PARTIES: "https://synthetic.app.test",
    CLERK_PUBLISHABLE_KEY: "pk_test_only", CLERK_SECRET_KEY: "sk_test_only", CLERK_JWT_KEY: jwtPublicKey,
    CLERK_WEBHOOK_SIGNING_SECRET: config.signingSecret,
    CLERK_WEBHOOK_INSTANCE_ID: config.expectedInstanceId,
    NORROW_GUEST_BOOTSTRAP_ENABLED: "true",
    NORROW_GUEST_PROOF_PEPPER: "nonsecret-isolated-test-pepper-1234567890" }) });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await boss?.stop({ graceful: true, timeout: 2000 });
  await pool?.end();
  const active = await admin.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname=$1", [database]);
  if (Number(active.rows[0]?.count) !== 0) throw new Error("clerk_pending_test_clients_remain");
  await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
  await admin.end();
}, 30_000);

describe("pending Clerk sessions are denied before member access", () => {
  it("P-ACTIVE-01 valid active session maps exactly once with a stable account", async () => {
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const sessionId = `sess_${randomBytes(8).toString("hex")}`;
    const first = await sessionWith(pendingCapableToken(subject, sessionId));
    expect(first.statusCode).toBe(200);
    const accountId = first.json().accountId as string;
    expect(accountId).toBeTruthy();
    const refreshed = await sessionWith(pendingCapableToken(subject, sessionId, 600));
    expect(refreshed.json().accountId).toBe(accountId);
    expect(await mapped(subject)).toBe(true);
  });

  it("P-ACTIVE-01 explicit active markers still pass", async () => {
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const sessionId = `sess_${randomBytes(8).toString("hex")}`;
    for (const marker of [{ sts: "active" }, { status: "active" }] as SessionStatus[]) {
      const response = await sessionWith(pendingCapableToken(subject, sessionId, 300,
        jwtKeys.privateKey, "https://synthetic.app.test", marker));
      expect(response.statusCode).toBe(200);
    }
  });

  it("P-PEND-02 pending sts bearer is denied before mapping; same subject stays eligible", async () => {
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const denied = await sessionWith(pendingCapableToken(subject,
      `sess_${randomBytes(8).toString("hex")}`, 300, jwtKeys.privateKey,
      "https://synthetic.app.test", { sts: "pending" }));
    expect(denied.statusCode).toBe(401);
    expect(await mapped(subject)).toBe(false);
    // The deny is per-token, not a subject tombstone: an active bearer for the
    // same subject still maps normally afterwards.
    const active = await sessionWith(pendingCapableToken(subject,
      `sess_${randomBytes(8).toString("hex")}`));
    expect(active.statusCode).toBe(200);
    expect(await mapped(subject)).toBe(true);
  });

  it("P-PEND-03 pending status variants are denied without mapping", async () => {
    for (const marker of [{ status: "pending" }, { session_status: "pending" },
      { sessionStatus: "pending" }, { sts: "suspended" }] as SessionStatus[]) {
      const subject = `user_${randomBytes(8).toString("hex")}`;
      const denied = await sessionWith(pendingCapableToken(subject,
        `sess_${randomBytes(8).toString("hex")}`, 300, jwtKeys.privateKey,
        "https://synthetic.app.test", marker));
      expect(denied.statusCode).toBe(401);
      expect(await mapped(subject)).toBe(false);
    }
  });

  it("P-PEND-04 pending bearer cannot satisfy the member half of guest claim", async () => {
    const guest = await enabledGuest();
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const pending = pendingCapableToken(subject, `sess_${randomBytes(8).toString("hex")}`,
      300, jwtKeys.privateKey, "https://synthetic.app.test", { sts: "pending" });
    const claimRequestId = randomUUID();
    const response = await app.inject({ method: "POST", url: "/v1/guest/claim",
      headers: { "x-norrow-guest-proof": guest.proof, authorization: `Bearer ${pending}` },
      payload: { claimRequestId, submissionId: claimRequestId, guestContextId: guest.guestContextId,
        conversationId: guest.conversationId, conversationVersion: 1, authAttemptId: claimRequestId } });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("authority_denied");
    expect(response.json().message).toBe("Both verified member and guest proof are required.");
    expect(await mapped(subject)).toBe(false);
    expect((await pool.query("SELECT 1 FROM guest_claim_requests WHERE request_id=$1",
      [claimRequestId])).rowCount).toBe(0);
  });

  it("P-PEND-05 active bearer at the same claim route proceeds past the member gate", async () => {
    const guest = await enabledGuest();
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const active = pendingCapableToken(subject, `sess_${randomBytes(8).toString("hex")}`);
    const claimRequestId = randomUUID();
    const response = await app.inject({ method: "POST", url: "/v1/guest/claim",
      headers: { "x-norrow-guest-proof": guest.proof, authorization: `Bearer ${active}` },
      payload: { claimRequestId, submissionId: claimRequestId, guestContextId: guest.guestContextId,
        conversationId: guest.conversationId, conversationVersion: 1, authAttemptId: claimRequestId } });
    // No pending action exists, so the claim fails on domain rules after the
    // member gate — but never on the member-authority gate itself.
    expect(response.json().message).not.toBe("Both verified member and guest proof are required.");
  });

  it("P-ISS-06 wrong issuer is denied without mapping", async () => {
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "synthetic" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: "https://wrong.issuer.test", sub: subject,
      sid: `sess_${randomBytes(8).toString("hex")}`, iat: now, nbf: now - 1, exp: now + 300,
      azp: "https://synthetic.app.test" })).toString("base64url");
    const input = `${header}.${payload}`;
    const token = `${input}.${sign("RSA-SHA256", Buffer.from(input), jwtKeys.privateKey).toString("base64url")}`;
    expect((await sessionWith(token)).statusCode).toBe(401);
    expect(await mapped(subject)).toBe(false);
  });

  it("P-EXP-07 expired bearer is denied without mapping", async () => {
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const expired = pendingCapableToken(subject, `sess_${randomBytes(8).toString("hex")}`, -60);
    expect((await sessionWith(expired)).statusCode).toBe(401);
    expect(await mapped(subject)).toBe(false);
  });

  it("P-SIG-08 false signature is denied without mapping", async () => {
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const forged = pendingCapableToken(subject, `sess_${randomBytes(8).toString("hex")}`,
      300, attackerKeys.privateKey);
    expect((await sessionWith(forged)).statusCode).toBe(401);
    expect(await mapped(subject)).toBe(false);
  });

  it("P-REV-09 revocation removes only the revoked session authority", async () => {
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const sid1 = `sess_${randomBytes(8).toString("hex")}`;
    const sid2 = `sess_${randomBytes(8).toString("hex")}`;
    const first = await sessionWith(pendingCapableToken(subject, sid1));
    expect(first.statusCode).toBe(200);
    const accountId = first.json().accountId as string;
    const message = signed("session.revoked", { id: sid1, user_id: subject });
    expect((await app.inject({ method: "POST", url: "/v1/clerk/webhooks",
      headers: { ...message.headers, "content-type": "application/json" },
      payload: message.body })).json()).toEqual({ accepted: true, reused: false });
    expect((await sessionWith(pendingCapableToken(subject, sid1))).statusCode).toBe(401);
    const other = await sessionWith(pendingCapableToken(subject, sid2));
    expect(other.statusCode).toBe(200);
    expect(other.json().accountId).toBe(accountId);
  });

  it("P-DEL-10 deleted principal stays denied after mapping", async () => {
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const mappedAccount = await accountForIdentity(pool, { issuer: config.issuer, subject });
    expect(mappedAccount).not.toBeNull();
    // Exercise the live boundary once while mapped, then tombstone the subject.
    const live = await sessionWith(pendingCapableToken(subject,
      `sess_${randomBytes(8).toString("hex")}`));
    expect(live.statusCode).toBe(200);
    expect(live.json().accountId).toBe(mappedAccount!.accountId);
    const message = signed("user.deleted", { id: subject });
    expect((await app.inject({ method: "POST", url: "/v1/clerk/webhooks",
      headers: { ...message.headers, "content-type": "application/json" },
      payload: message.body })).json()).toEqual({ accepted: true, reused: false });
    expect((await sessionWith(pendingCapableToken(subject,
      `sess_${randomBytes(8).toString("hex")}`))).statusCode).toBe(401);
    expect(await accountForIdentity(pool, { issuer: config.issuer, subject })).toBeNull();
  });

  it("P-AZP-11 wrong party is denied; omitted party still passes", async () => {
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const sessionId = `sess_${randomBytes(8).toString("hex")}`;
    const native = await sessionWith(pendingCapableToken(subject, sessionId, 300,
      jwtKeys.privateKey, null));
    expect(native.statusCode).toBe(200);
    const wrong = await sessionWith(pendingCapableToken(subject, sessionId, 300,
      jwtKeys.privateKey, "https://wrong.app.test"));
    expect(wrong.statusCode).toBe(401);
  });

  it("P-UNAV-12 key-service outage still fails closed without mapping", async () => {
    const subject = `user_${randomBytes(8).toString("hex")}`;
    const token = pendingCapableToken(subject, `sess_${randomBytes(8).toString("hex")}`);
    const offline = await buildApp({ pool, boss, config: loadConfig({ NODE_ENV: "test",
      APP_AUTH_MODE: "production", APP_IDENTITY_PROVIDER: "clerk", DATABASE_URL: databaseUrl.toString(),
      CLERK_ISSUER: config.issuer, CLERK_AUTHORIZED_PARTIES: "https://synthetic.app.test",
      CLERK_PUBLISHABLE_KEY: "pk_test_only", CLERK_SECRET_KEY: "sk_test_only",
      CLERK_WEBHOOK_SIGNING_SECRET: config.signingSecret,
      CLERK_WEBHOOK_INSTANCE_ID: config.expectedInstanceId }) });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic key-service outage")));
    try {
      expect((await offline.inject({ method: "GET", url: "/v1/session",
        headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(503);
      expect(await mapped(subject)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      await offline.close();
    }
  });
});

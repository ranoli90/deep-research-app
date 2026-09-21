import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { canonicalGuestPendingPayload, CONSENT_POLICY_VERSION } from "@deep/contracts";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { recordIntent, settleRun } from "../src/modules/billing.js";
import { createPool, migrate } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";

// Every execution owns a new database; TEST_DATABASE_URL is only its local CREATE DATABASE authority.
const adminUrl = process.env.TEST_DATABASE_URL ??
  "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
const database = `deep_norrow_concurrency_${process.pid}_${randomBytes(4).toString("hex")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${database}`;
const url = databaseUrl.toString();
const admin = new pg.Client({ connectionString: adminUrl });
const policyId = "norrow-guest-first.v1";
const reservationMicro = 100_000;
const config = loadConfig({ DATABASE_URL: url, NODE_ENV: "test", APP_AUTH_MODE: "development",
  NORROW_GUEST_BOOTSTRAP_ENABLED: "true", NORROW_GUEST_PROOF_PEPPER: "nonsecret-isolated-concurrency-pepper-1234567890",
  DEV_ALLOW_FIXTURE_ROUTE: "true" });

type Guest = { guestContextId: string; conversationId: string; proof: string; headers: { "x-norrow-guest-proof": string } };
let poolA: pg.Pool;
let poolB: pg.Pool;
let bossA: PgBoss;
let bossB: PgBoss;
let appA: FastifyInstance;
let appB: FastifyInstance;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  poolA = createPool(url);
  poolB = createPool(url);
  await migrate(poolA);
  bossA = await createQueue(url);
  bossB = await createQueue(url);
  appA = await buildApp({ pool: poolA, boss: bossA, config });
  appB = await buildApp({ pool: poolB, boss: bossB, config });
}, 120_000);

afterAll(async () => {
  await appA?.close();
  await appB?.close();
  await bossA?.stop({ graceful: true, timeout: 2_000 });
  await bossB?.stop({ graceful: true, timeout: 2_000 });
  await poolA?.end();
  await poolB?.end();
  const active = await admin.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname=$1", [database]);
  if (Number(active.rows[0]?.count) !== 0) throw new Error("norrow_concurrency_test_clients_remain");
  await admin.query(`DROP DATABASE "${database}"`);
  await admin.end();
}, 30_000);

beforeEach(async () => {
  await poolA.query("TRUNCATE accounts CASCADE");
  await poolA.query("TRUNCATE guest_bootstrap_limits");
  await poolA.query(`UPDATE guest_sponsor_policies SET enabled=false,killed=true,
    expires_at=now()+interval '1 day',exposure_cap_micro=0,bootstrap_limit_per_risk=10 WHERE id=$1`, [policyId]);
  await poolA.query("UPDATE guest_sponsor_ledgers SET settled_micro=0,reserved_micro=0,held_micro=0 WHERE policy_id=$1", [policyId]);
});

async function enableSponsor(exposureCapMicro: number) {
  await poolA.query(`UPDATE guest_sponsor_policies SET enabled=true,killed=false,exposure_cap_micro=$2,
    per_guest_cap_micro=$3 WHERE id=$1`, [policyId, exposureCapMicro, reservationMicro]);
}

async function bootstrap(app: FastifyInstance): Promise<Guest> {
  const response = await app.inject({ method: "POST", url: "/v1/guest/bootstrap", payload: {} });
  expect(response.statusCode).toBe(201);
  const result = response.json() as Omit<Guest, "headers">;
  return { ...result, headers: { "x-norrow-guest-proof": result.proof } };
}

async function consent(app: FastifyInstance, guest: Guest) {
  const response = await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers,
    payload: { grant: true } });
  expect(response.statusCode).toBe(200);
}

function submit(app: FastifyInstance, guest: Guest, key: string, question: string) {
  return app.inject({ method: "POST", url: "/v1/runs",
    headers: { ...guest.headers, "idempotency-key": key },
    payload: { question, routeMode: "fixture", conversationId: guest.conversationId,
      consentPolicyVersion: CONSENT_POLICY_VERSION } });
}

async function pending(app: FastifyInstance, guest: Guest, text: string) {
  const submissionId = randomUUID();
  const authAttemptId = randomUUID();
  const action = { kind: "new_research" as const, text };
  const registered = await app.inject({ method: "POST", url: "/v1/guest/pending-actions",
    headers: guest.headers, payload: { submissionId, guestContextId: guest.guestContextId,
      conversationId: guest.conversationId, conversationVersion: 1, payload: action,
      payloadDigest: createHash("sha256").update(canonicalGuestPendingPayload(action)).digest("hex"),
      consentPolicyVersion: CONSENT_POLICY_VERSION } });
  expect(registered.statusCode).toBe(202);
  const begun = await app.inject({ method: "POST", url: "/v1/guest/pending-actions/attempts/begin",
    headers: guest.headers, payload: { submissionId, authAttemptId, provider: "email_code" } });
  expect(begun.statusCode).toBe(200);
  return { submissionId, authAttemptId };
}

async function member(app: FastifyInstance) {
  const response = await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} });
  expect(response.statusCode).toBe(200);
  return response.json() as { token: string; accountId: string };
}

async function ledger() {
  return (await poolA.query<{ reserved_micro: string; held_micro: string; settled_micro: string }>(
    "SELECT reserved_micro,held_micro,settled_micro FROM guest_sponsor_ledgers WHERE policy_id=$1", [policyId])).rows[0]!;
}

describe("Norrow independent-client admission and claim races", () => {
  it("GUEST-07/08: two replicas admit one distinct first turn, replay its exact identity and reject changed content", async () => {
    await enableSponsor(300_000);
    const guest = await bootstrap(appA);
    await consent(appA, guest);
    const attempts = [
      { app: appA, key: randomUUID(), question: "How does the filing rule apply in 2026?" },
      { app: appB, key: randomUUID(), question: "What evidence supports the filing rule?" },
    ];
    const responses = await Promise.all(attempts.map(({ app, key, question }) => submit(app, guest, key, question)));
    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 403]);
    const winnerIndex = responses.findIndex(response => response.statusCode === 200);
    const loserIndex = 1 - winnerIndex;
    const winner = attempts[winnerIndex]!;
    const accepted = responses[winnerIndex]!.json() as { runId: string };
    expect(responses[loserIndex]!.json()).toMatchObject({ code: "AUTH_REQUIRED_NEXT_TURN" });
    expect(responses[loserIndex]!.body).not.toContain(accepted.runId);

    const replay = await submit(attempts[loserIndex]!.app, guest, winner.key, winner.question);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ runId: accepted.runId, reused: true });
    const changed = await submit(winner.app, guest, winner.key, "An altered question under the admitted key");
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ code: "idempotency_conflict" });
    expect(changed.body).not.toContain(accepted.runId);

    const receipts = await poolA.query<{ request_id: string; run_id: string }>(
      "SELECT request_id,run_id FROM guest_first_request_receipts WHERE guest_context_id=$1", [guest.guestContextId]);
    expect(receipts.rows).toEqual([{ request_id: winner.key, run_id: accepted.runId }]);
    expect((await poolA.query("SELECT count(*)::int AS n FROM runs")).rows[0].n).toBe(1);
    expect((await poolA.query("SELECT count(*)::int AS n FROM guest_sponsor_reservations")).rows[0].n).toBe(1);
    expect((await poolA.query("SELECT count(*)::int AS n FROM provider_intents")).rows[0].n).toBe(0);
    expect(await ledger()).toMatchObject({ reserved_micro: "100000", held_micro: "0", settled_micro: "0" });
  });

  it("GUEST-09: invalid first requests do not consume the grant or reserve sponsor exposure", async () => {
    await enableSponsor(100_000);
    const guest = await bootstrap(appA);
    await consent(appA, guest);
    for (const question of ["", "x".repeat(20_001)]) {
      const denied = await submit(appB, guest, randomUUID(), question);
      expect(denied.statusCode).toBe(400);
      expect(denied.json()).toMatchObject({ code: "invalid_input" });
    }
    const unsupported = await appB.inject({ method: "POST", url: "/v1/runs",
      headers: { ...guest.headers, "idempotency-key": randomUUID() },
      payload: { question: "A valid question", routeMode: "unapproved-route",
        conversationId: guest.conversationId, consentPolicyVersion: CONSENT_POLICY_VERSION } });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json()).toMatchObject({ code: "invalid_input" });
    expect((await poolA.query("SELECT accepted_turn_count FROM guest_contexts WHERE id=$1", [guest.guestContextId]))
      .rows[0].accepted_turn_count).toBe(0);
    expect((await poolA.query("SELECT count(*)::int AS n FROM guest_first_request_receipts")).rows[0].n).toBe(0);
    expect((await poolA.query("SELECT count(*)::int AS n FROM runs")).rows[0].n).toBe(0);
    expect((await poolA.query("SELECT count(*)::int AS n FROM guest_sponsor_reservations")).rows[0].n).toBe(0);
    expect((await poolA.query("SELECT count(*)::int AS n FROM provider_intents")).rows[0].n).toBe(0);
    expect(await ledger()).toMatchObject({ reserved_micro: "0", held_micro: "0", settled_micro: "0" });
    expect((await submit(appA, guest, randomUUID(), "A valid first question")).statusCode).toBe(200);
  });

  it("CLAIM-04/05: A's proof cannot claim B; competing members yield one durable claimant", async () => {
    await enableSponsor(300_000);
    const guestA = await bootstrap(appA);
    const guestB = await bootstrap(appB);
    await consent(appA, guestA);
    await consent(appB, guestB);
    expect((await submit(appA, guestA, randomUUID(), "Research the first filing")).statusCode).toBe(200);
    expect((await submit(appB, guestB, randomUUID(), "Research the second filing")).statusCode).toBe(200);
    const actionA = await pending(appA, guestA, "Continue the first filing");
    const actionB = await pending(appB, guestB, "Continue the second filing");
    const memberA = await member(appA);
    const memberB = await member(appB);
    const wrong = await appA.inject({ method: "POST", url: "/v1/guest/claim",
      headers: { ...guestA.headers, authorization: `Bearer ${memberA.token}` },
      payload: { claimRequestId: randomUUID(), ...actionB, guestContextId: guestB.guestContextId,
        conversationId: guestB.conversationId, conversationVersion: 1 } });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toMatchObject({ code: "authority_denied" });
    expect(wrong.body).not.toContain(guestB.conversationId);
    expect((await poolA.query("SELECT state FROM guest_pending_actions WHERE submission_id=$1", [actionB.submissionId]))
      .rows[0].state).toBe("authenticating");

    const attempts = [
      { app: appA, member: memberA, claimRequestId: randomUUID() },
      { app: appB, member: memberB, claimRequestId: randomUUID() },
    ];
    const responses = await Promise.all(attempts.map(({ app, member, claimRequestId }) => app.inject({
      method: "POST", url: "/v1/guest/claim",
      headers: { ...guestA.headers, authorization: `Bearer ${member.token}` },
      payload: { claimRequestId, ...actionA, guestContextId: guestA.guestContextId,
        conversationId: guestA.conversationId, conversationVersion: 1 },
    })));
    expect(responses.filter(response => response.statusCode === 200)).toHaveLength(1);
    const winnerIndex = responses.findIndex(response => response.statusCode === 200);
    const loserIndex = 1 - winnerIndex;
    expect([401, 403]).toContain(responses[loserIndex]!.statusCode);
    expect(responses[loserIndex]!.json()).not.toHaveProperty("accountId");
    expect(responses[loserIndex]!.body).not.toContain(guestA.conversationId);
    const winner = attempts[winnerIndex]!;
    const loser = attempts[loserIndex]!;
    const resolution = await winner.app.inject({ method: "POST", url: "/v1/guest/claims/resolve",
      headers: { authorization: `Bearer ${winner.member.token}` },
      payload: { claimRequestId: winner.claimRequestId, submissionId: actionA.submissionId } });
    expect(resolution.statusCode).toBe(200);
    expect(resolution.json()).toMatchObject({ type: "claim_accepted", accountId: winner.member.accountId });
    const deniedResolution = await loser.app.inject({ method: "POST", url: "/v1/guest/claims/resolve",
      headers: { authorization: `Bearer ${loser.member.token}` },
      payload: { claimRequestId: loser.claimRequestId, submissionId: actionA.submissionId } });
    expect(deniedResolution.statusCode).toBe(403);
    expect(deniedResolution.body).not.toContain(guestA.conversationId);

    expect((await poolA.query("SELECT count(*)::int AS n FROM guest_claim_requests WHERE guest_context_id=$1",
      [guestA.guestContextId])).rows[0].n).toBe(1);
    expect((await poolA.query("SELECT count(*)::int AS n FROM conversation_control_bindings WHERE guest_context_id=$1",
      [guestA.guestContextId])).rows[0].n).toBe(1);
    expect((await poolA.query("SELECT member_account_id FROM conversation_control_bindings WHERE guest_context_id=$1",
      [guestA.guestContextId])).rows[0].member_account_id).toBe(winner.member.accountId);
    expect((await poolA.query("SELECT status,proof_digest FROM guest_contexts WHERE id=$1",
      [guestA.guestContextId])).rows[0]).toMatchObject({ status: "claimed", proof_digest: null });
    expect((await poolA.query("SELECT state,member_account_id FROM guest_pending_actions WHERE submission_id=$1",
      [actionA.submissionId])).rows[0]).toMatchObject({ state: "claimed", member_account_id: winner.member.accountId });
    expect((await poolA.query("SELECT count(*)::int AS n FROM runs")).rows[0].n).toBe(2);
    expect((await poolA.query("SELECT count(*)::int AS n FROM provider_intents")).rows[0].n).toBe(0);
    expect(await ledger()).toMatchObject({ reserved_micro: "200000", held_micro: "0", settled_micro: "0" });
  });

  it("COST-01: concurrent guests cannot exceed the final sponsor slot, including after unknown HOLD", async () => {
    await enableSponsor(reservationMicro);
    const guestA = await bootstrap(appA);
    const guestB = await bootstrap(appB);
    await consent(appA, guestA);
    await consent(appB, guestB);
    const attempts = [
      { app: appA, guest: guestA, key: randomUUID(), question: "Research the first public filing" },
      { app: appB, guest: guestB, key: randomUUID(), question: "Research the second public filing" },
    ];
    const responses = await Promise.all(attempts.map(({ app, guest, key, question }) =>
      submit(app, guest, key, question)));
    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 402]);
    const winnerIndex = responses.findIndex(response => response.statusCode === 200);
    const loserIndex = 1 - winnerIndex;
    const winner = attempts[winnerIndex]!;
    const loser = attempts[loserIndex]!;
    const runId = responses[winnerIndex]!.json().runId as string;
    expect(responses[loserIndex]!.json()).toMatchObject({ code: "allowance_exhausted" });
    expect(responses[loserIndex]!.body).not.toContain(runId);
    expect((await poolA.query("SELECT count(*)::int AS n FROM guest_first_request_receipts")).rows[0].n).toBe(1);
    expect((await poolA.query("SELECT count(*)::int AS n FROM runs")).rows[0].n).toBe(1);
    expect((await poolA.query("SELECT count(*)::int AS n FROM guest_sponsor_reservations")).rows[0].n).toBe(1);
    expect(await ledger()).toMatchObject({ reserved_micro: "100000", held_micro: "0", settled_micro: "0" });
    const retry = await submit(loser.app, loser.guest, loser.key, loser.question);
    expect(retry.statusCode).toBe(402);
    expect((await poolA.query("SELECT count(*)::int AS n FROM guest_first_request_receipts")).rows[0].n).toBe(1);

    // Synthetic issued/unknown provider intent: never call a provider or release its exposure to a new guest.
    const owner = (await poolA.query<{ execution_owner_account_id: string }>(
      "SELECT execution_owner_account_id FROM guest_contexts WHERE id=$1", [winner.guest.guestContextId]))
      .rows[0]!.execution_owner_account_id;
    await poolA.query("UPDATE runs SET route_mode='controlled-research' WHERE id=$1", [runId]);
    const intentId = await recordIntent(poolA, runId, { correlationId: randomUUID(),
      route: "openrouter:synthetic", digest: "b".repeat(64), reserved: 17_000, state: "issued" });
    await settleRun(poolA, owner, runId, 0);
    expect(await ledger()).toMatchObject({ reserved_micro: "0", held_micro: "100000", settled_micro: "0" });
    expect((await poolA.query("SELECT state FROM guest_sponsor_reservations WHERE run_id=$1", [runId]))
      .rows[0].state).toBe("held");
    expect((await poolA.query("SELECT id,state FROM provider_intents")).rows).toEqual([{ id: intentId, state: "issued" }]);
    expect((await submit(loser.app, loser.guest, loser.key, loser.question)).statusCode).toBe(402);
    expect((await poolA.query("SELECT count(*)::int AS n FROM runs")).rows[0].n).toBe(1);
    expect((await poolA.query("SELECT count(*)::int AS n FROM guest_first_request_receipts")).rows[0].n).toBe(1);
    expect(await ledger()).toMatchObject({ reserved_micro: "0", held_micro: "100000", settled_micro: "0" });
  });
});

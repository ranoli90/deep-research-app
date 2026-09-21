import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { createHash } from "node:crypto";
import { canonicalGuestPendingPayload, CONSENT_POLICY_VERSION } from "@deep/contracts";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { createPool, migrate } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";

const url = process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
let pool: pg.Pool;
let boss: PgBoss;
let app: FastifyInstance;

beforeAll(async () => {
  pool = createPool(url);
  await migrate(pool);
  boss = await createQueue(url);
  app = await buildApp({ pool, boss, config: loadConfig({ DATABASE_URL: url, NODE_ENV: "test",
    APP_AUTH_MODE: "development", NORROW_GUEST_BOOTSTRAP_ENABLED: "true",
    NORROW_GUEST_PROOF_PEPPER: "nonsecret-isolated-test-pepper-1234567890",
    DEV_ALLOW_FIXTURE_ROUTE: "true" }) });
});
beforeEach(async () => {
  await pool.query("TRUNCATE accounts CASCADE");
  await pool.query("TRUNCATE guest_bootstrap_limits");
  await pool.query(`UPDATE guest_sponsor_policies SET enabled=false,killed=true,expires_at=now()+interval '1 day',
    exposure_cap_micro=0,bootstrap_limit_per_risk=10 WHERE id='norrow-guest-first.v1'`);
  await pool.query("UPDATE guest_sponsor_ledgers SET settled_micro=0,reserved_micro=0,held_micro=0 WHERE policy_id='norrow-guest-first.v1'");
});
afterAll(async () => {
  await app.close();
  await boss.stop({ graceful: false, timeout: 2000 });
  await pool.end();
});

async function enabledGuest() {
  await pool.query(`UPDATE guest_sponsor_policies SET enabled=true,killed=false,exposure_cap_micro=100000,
    per_guest_cap_micro=100000 WHERE id='norrow-guest-first.v1'`);
  const bootstrap = await app.inject({ method: "POST", url: "/v1/guest/bootstrap", payload: {} });
  expect(bootstrap.statusCode).toBe(201);
  const guest = bootstrap.json() as { guestContextId: string; conversationId: string; proof: string };
  return { ...guest, headers: { "x-norrow-guest-proof": guest.proof } };
}

describe("NARROW-GUEST-001 first-turn server authority and bounded sponsor", () => {
  it("does not issue a guest proof when the sponsor policy is disabled", async () => {
    const denied = await app.inject({ method: "POST", url: "/v1/guest/bootstrap", payload: {} });
    expect(denied.statusCode).toBe(402);
    expect((await pool.query("SELECT count(*)::int AS n FROM guest_contexts")).rows[0].n).toBe(0);
  });

  it("admits one first run atomically, replays exact request, and registers but does not dispatch a second action", async () => {
    const guest = await enabledGuest();
    const session = await app.inject({ method: "GET", url: "/v1/session", headers: guest.headers });
    expect(session.json()).toMatchObject({ actorKind: "guest", acceptedTurnCount: 0, firstTurnAvailable: true });
    const consent = await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers, payload: { grant: true } });
    expect(consent.statusCode).toBe(200);
    const key = crypto.randomUUID();
    const payload = { question: "What is the filing deadline for employment tax?", routeMode: "fixture",
      conversationId: guest.conversationId, consentPolicyVersion: CONSENT_POLICY_VERSION };
    const first = await app.inject({ method: "POST", url: "/v1/runs",
      headers: { ...guest.headers, "idempotency-key": key }, payload });
    expect(first.statusCode).toBe(200);
    const runId = first.json().runId as string;
    const retry = await app.inject({ method: "POST", url: "/v1/runs",
      headers: { ...guest.headers, "idempotency-key": key }, payload });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ runId, reused: true });
    expect((await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers: guest.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/runs/${runId}/events`, headers: guest.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/session", headers: guest.headers })).json())
      .toMatchObject({ acceptedTurnCount: 1, firstTurnAvailable: false });
    const second = await app.inject({ method: "POST", url: "/v1/runs",
      headers: { ...guest.headers, "idempotency-key": crypto.randomUUID() }, payload: { ...payload, question: "Another distinct research question" } });
    expect(second.statusCode).toBe(403);
    expect(second.json().code).toBe("AUTH_REQUIRED_NEXT_TURN");
    const action = { kind: "new_research" as const, text: "Another distinct research question" };
    const submissionId = crypto.randomUUID();
    const pending = { submissionId, guestContextId: guest.guestContextId, conversationId: guest.conversationId,
      conversationVersion: 1, payload: action, payloadDigest: createHash("sha256")
        .update(canonicalGuestPendingPayload(action)).digest("hex"), consentPolicyVersion: CONSENT_POLICY_VERSION };
    const register = await app.inject({ method: "POST", url: "/v1/guest/pending-actions", headers: guest.headers, payload: pending });
    expect(register.statusCode).toBe(202);
    expect(register.json()).toMatchObject({ code: "AUTH_REQUIRED_NEXT_TURN", submissionId, controlVersion: 1 });
    const replay = await app.inject({ method: "POST", url: "/v1/guest/pending-actions", headers: guest.headers, payload: pending });
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toEqual(register.json());
    expect((await pool.query("SELECT count(*)::int AS n FROM runs")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT reserved_micro::int AS n FROM guest_sponsor_ledgers WHERE policy_id='norrow-guest-first.v1'")).rows[0].n).toBe(100000);
    expect((await pool.query("SELECT count(*)::int AS n FROM guest_sponsor_reservations WHERE run_id=$1", [runId])).rows[0].n).toBe(1);
  });

  it("claims with dual proof, preserves member funding gate, resumes once, and allows a third member send", async () => {
    const guest = await enabledGuest();
    await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers, payload: { grant: true } });
    const firstId = crypto.randomUUID();
    const first = await app.inject({ method: "POST", url: "/v1/runs",
      headers: { ...guest.headers, "idempotency-key": firstId },
      payload: { question: "What is the filing deadline for employment tax?", routeMode: "fixture",
        conversationId: guest.conversationId, consentPolicyVersion: CONSENT_POLICY_VERSION } });
    expect(first.statusCode).toBe(200);
    const firstRunId = first.json().runId as string;
    const resolveFirst = await app.inject({ method: "POST", url: "/v1/run-requests/resolve", headers: guest.headers,
      payload: { idempotencyKey: firstId } });
    expect(resolveFirst.json()).toMatchObject({ status: "accepted", run: { runId: firstRunId } });
    const action = { kind: "new_research" as const, text: "Compare current filing requirements" };
    const submissionId = crypto.randomUUID();
    const payloadDigest = createHash("sha256").update(canonicalGuestPendingPayload(action)).digest("hex");
    const register = await app.inject({ method: "POST", url: "/v1/guest/pending-actions", headers: guest.headers,
      payload: { submissionId, guestContextId: guest.guestContextId, conversationId: guest.conversationId,
        conversationVersion: 1, payload: action, payloadDigest, consentPolicyVersion: CONSENT_POLICY_VERSION } });
    expect(register.statusCode).toBe(202);
    const member = (await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} })).json() as
      { token: string; accountId: string };
    const memberHeaders = { authorization: `Bearer ${member.token}` };
    expect((await app.inject({ method: "POST", url: "/v1/guest/claim", headers: memberHeaders,
      payload: { claimRequestId: crypto.randomUUID(), submissionId, guestContextId: guest.guestContextId,
        conversationId: guest.conversationId, conversationVersion: 1 } })).statusCode).toBe(403);
    const claimRequestId = crypto.randomUUID();
    const claim = await app.inject({ method: "POST", url: "/v1/guest/claim",
      headers: { ...memberHeaders, ...guest.headers },
      payload: { claimRequestId, submissionId, guestContextId: guest.guestContextId,
        conversationId: guest.conversationId, conversationVersion: 1 } });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toMatchObject({ type: "claim_accepted", accountId: member.accountId,
      budgetAllowed: true, authorityAllowed: true, controlVersion: 2 });
    const claimResolve = await app.inject({ method: "POST", url: "/v1/guest/claims/resolve", headers: memberHeaders,
      payload: { claimRequestId, submissionId } });
    expect(claimResolve.json()).toMatchObject({ type: "claim_accepted", controlVersion: 2 });
    expect((await app.inject({ method: "GET", url: `/v1/runs/${firstRunId}`, headers: guest.headers })).statusCode).toBe(401);
    const resumePayload = { submissionId, claimRequestId, controlVersion: 2, payloadDigest };
    await pool.query("UPDATE allowance_accounts SET limit_micro=0 WHERE account_id=$1", [member.accountId]);
    const unfunded = await app.inject({ method: "POST", url: "/v1/guest/actions/resume", headers: memberHeaders,
      payload: resumePayload });
    expect(unfunded.statusCode).toBe(402);
    expect(unfunded.json().code).toBe("allowance_exhausted");
    expect((await pool.query("SELECT state FROM guest_pending_actions WHERE submission_id=$1", [submissionId])).rows[0].state)
      .toBe("claimed");
    await pool.query("UPDATE allowance_accounts SET limit_micro=300000 WHERE account_id=$1", [member.accountId]);
    const resume = await app.inject({ method: "POST", url: "/v1/guest/actions/resume", headers: memberHeaders,
      payload: resumePayload });
    expect(resume.statusCode).toBe(200);
    const receipt = resume.json() as { runId: string; memberConversationId: string; receiptId: string };
    expect(receipt).toMatchObject({ type: "continuation_dispatched", kind: "new_research" });
    const replay = await app.inject({ method: "POST", url: "/v1/guest/actions/resume", headers: memberHeaders,
      payload: resumePayload });
    expect(replay.json()).toMatchObject({ runId: receipt.runId, receiptId: receipt.receiptId });
    const resolved = await app.inject({ method: "POST", url: "/v1/guest/actions/resolve", headers: memberHeaders,
      payload: { submissionId, claimRequestId } });
    expect(resolved.json()).toMatchObject({ runId: receipt.runId, receiptId: receipt.receiptId });
    const memberRun = (await pool.query("SELECT account_id,claimed_parent_run_id,guest_pending_action_id FROM runs WHERE id=$1",
      [receipt.runId])).rows[0];
    expect(memberRun).toMatchObject({ account_id: member.accountId, claimed_parent_run_id: firstRunId,
      guest_pending_action_id: submissionId });
    expect((await pool.query("SELECT account_id FROM runs WHERE id=$1", [firstRunId])).rows[0].account_id)
      .not.toBe(member.accountId);
    const third = await app.inject({ method: "POST", url: "/v1/runs",
      headers: { ...memberHeaders, "idempotency-key": crypto.randomUUID() },
      payload: { question: "What changes next year?", routeMode: "fixture",
        conversationId: receipt.memberConversationId, consentPolicyVersion: CONSENT_POLICY_VERSION } });
    expect(third.statusCode).toBe(200);
    expect(third.json().runId).not.toBe(receipt.runId);
  });
});

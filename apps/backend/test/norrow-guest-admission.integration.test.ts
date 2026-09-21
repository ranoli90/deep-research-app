import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { createHash } from "node:crypto";
import { canonicalGuestPendingPayload, CONSENT_POLICY_VERSION } from "@deep/contracts";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";
import { recordIntent, settleRun } from "../src/modules/billing.js";
import { processRun } from "../src/worker/diagnostic-executor.js";
import { assertRouteAdmission } from "../src/modules/run-route-admission.js";
import { guestExecutionAllowed } from "../src/modules/guest-execution-control.js";
import { publishReport } from "../src/modules/reports.js";

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
    const dismissedAttemptId = crypto.randomUUID();
    const beginDismissed = await app.inject({ method: "POST", url: "/v1/guest/pending-actions/attempts/begin",
      headers: guest.headers, payload: { submissionId, authAttemptId: dismissedAttemptId, provider: "email_code" } });
    expect(beginDismissed.json()).toMatchObject({ state: "authenticating", attemptRevision: 1 });
    const dismiss = await app.inject({ method: "POST", url: "/v1/guest/pending-actions/attempts/end",
      headers: guest.headers, payload: { submissionId, authAttemptId: dismissedAttemptId, reason: "dismissed" } });
    expect(dismiss.json()).toMatchObject({ state: "dismissed", attemptRevision: 1 });
    const authAttemptId = crypto.randomUUID();
    const begin = await app.inject({ method: "POST", url: "/v1/guest/pending-actions/attempts/begin",
      headers: guest.headers, payload: { submissionId, authAttemptId, provider: "email_code" } });
    expect(begin.json()).toMatchObject({ state: "authenticating", attemptRevision: 2 });
    const member = (await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} })).json() as
      { token: string; accountId: string };
    const memberHeaders = { authorization: `Bearer ${member.token}` };
    expect((await app.inject({ method: "POST", url: "/v1/guest/claim", headers: memberHeaders,
      payload: { claimRequestId: crypto.randomUUID(), submissionId, guestContextId: guest.guestContextId,
        conversationId: guest.conversationId, conversationVersion: 1, authAttemptId } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/guest/claim",
      headers: { ...memberHeaders, ...guest.headers },
      payload: { claimRequestId: crypto.randomUUID(), submissionId, guestContextId: guest.guestContextId,
        conversationId: guest.conversationId, conversationVersion: 1,
        authAttemptId: dismissedAttemptId } })).statusCode).toBe(409);
    const claimRequestId = crypto.randomUUID();
    const claim = await app.inject({ method: "POST", url: "/v1/guest/claim",
      headers: { ...memberHeaders, ...guest.headers },
      payload: { claimRequestId, submissionId, guestContextId: guest.guestContextId,
        conversationId: guest.conversationId, conversationVersion: 1, authAttemptId } });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toMatchObject({ type: "claim_accepted", accountId: member.accountId,
      budgetAllowed: true, authorityAllowed: true, controlVersion: 2, consentPolicyVersion: null });
    const claimResolve = await app.inject({ method: "POST", url: "/v1/guest/claims/resolve", headers: memberHeaders,
      payload: { claimRequestId, submissionId } });
    expect(claimResolve.json()).toMatchObject({ type: "claim_accepted", controlVersion: 2 });
    expect((await app.inject({ method: "GET", url: `/v1/runs/${firstRunId}`, headers: guest.headers })).statusCode).toBe(401);
    const resumePayload = { submissionId, claimRequestId, controlVersion: 2, payloadDigest };
    const noMemberConsent = await app.inject({ method: "POST", url: "/v1/guest/actions/resume",
      headers: memberHeaders, payload: resumePayload });
    expect(noMemberConsent.statusCode).toBe(403);
    expect(noMemberConsent.json().code).toBe("consent_required");
    expect((await pool.query("SELECT count(*)::int AS n FROM consent_records WHERE account_id=$1", [member.accountId])).rows[0].n)
      .toBe(0);
    const explicitMemberConsent = await app.inject({ method: "POST", url: "/v1/consent",
      headers: memberHeaders, payload: { grant: true } });
    expect(explicitMemberConsent.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/consent", headers: memberHeaders,
      payload: { grant: false } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/guest/actions/resume", headers: memberHeaders,
      payload: resumePayload })).json().code).toBe("consent_required");
    expect((await app.inject({ method: "POST", url: "/v1/consent", headers: memberHeaders,
      payload: { grant: true } })).statusCode).toBe(200);
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
    const deletion = await app.inject({ method: "POST", url: "/v1/account/deletion",
      headers: memberHeaders, payload: {} });
    expect(deletion.statusCode).toBe(200);
    const removed = (await pool.query<{ status: string; deleted_at: Date | null; state: string; payload: unknown }>(
      `SELECT g.status,a.deleted_at,p.state,p.payload FROM guest_contexts g
       JOIN accounts a ON a.id=g.execution_owner_account_id
       JOIN guest_pending_actions p ON p.guest_context_id=g.id WHERE g.id=$1`, [guest.guestContextId])).rows[0]!;
    expect(removed).toMatchObject({ status: "deleted", state: "deleted", payload: {} });
    expect(removed.deleted_at).toBeTruthy();
    expect((await app.inject({ method: "POST", url: "/v1/guest/actions/resume", headers: memberHeaders,
      payload: resumePayload })).statusCode).toBe(401);
  });

  it("revokes guest control version and destroys proof on guest deletion before claim", async () => {
    const guest = await enabledGuest();
    expect((await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers,
      payload: { grant: true } })).statusCode).toBe(200);
    const revoked = await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers,
      payload: { grant: false } });
    expect(revoked.json()).toMatchObject({ granted: false, controlVersion: 2 });
    expect((await app.inject({ method: "GET", url: "/v1/session", headers: guest.headers })).json())
      .toMatchObject({ consentGranted: false, controlVersion: 2 });
    const deleted = await app.inject({ method: "POST", url: "/v1/account/deletion",
      headers: guest.headers, payload: {} });
    expect(deleted.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/session", headers: guest.headers })).statusCode).toBe(401);
    expect((await pool.query("SELECT status,proof_digest FROM guest_contexts WHERE id=$1", [guest.guestContextId])).rows[0])
      .toMatchObject({ status: "deleted", proof_digest: null });
  });

  it("rejects a stale auth attempt after guest consent revoke and re-grant", async () => {
    const guest = await enabledGuest();
    await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers, payload: { grant: true } });
    expect((await app.inject({ method: "POST", url: "/v1/runs",
      headers: { ...guest.headers, "idempotency-key": crypto.randomUUID() },
      payload: { question: "What did ACME announce about Widget 4?", routeMode: "fixture",
        conversationId: guest.conversationId, consentPolicyVersion: CONSENT_POLICY_VERSION } })).statusCode).toBe(200);
    const action = { kind: "new_research" as const, text: "A second research action" };
    const submissionId = crypto.randomUUID();
    const authAttemptId = crypto.randomUUID();
    const pending = { submissionId, guestContextId: guest.guestContextId, conversationId: guest.conversationId,
      conversationVersion: 1, payload: action, payloadDigest: createHash("sha256")
        .update(canonicalGuestPendingPayload(action)).digest("hex"), consentPolicyVersion: CONSENT_POLICY_VERSION };
    expect((await app.inject({ method: "POST", url: "/v1/guest/pending-actions", headers: guest.headers,
      payload: pending })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url: "/v1/guest/pending-actions/attempts/begin",
      headers: guest.headers, payload: { submissionId, authAttemptId, provider: "email_code" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers,
      payload: { grant: false } })).json()).toMatchObject({ controlVersion: 2 });
    expect((await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers,
      payload: { grant: true } })).statusCode).toBe(200);
    const member = (await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} })).json() as { token: string };
    const stale = await app.inject({ method: "POST", url: "/v1/guest/claim",
      headers: { ...guest.headers, authorization: `Bearer ${member.token}` },
      payload: { claimRequestId: crypto.randomUUID(), submissionId, guestContextId: guest.guestContextId,
        conversationId: guest.conversationId, conversationVersion: 1, authAttemptId } });
    expect(stale.statusCode).toBe(409);
    expect((await pool.query("SELECT state FROM guest_pending_actions WHERE submission_id=$1", [submissionId])).rows[0].state)
      .toBe("rejected");
    expect((await pool.query("SELECT count(*)::int AS n FROM conversation_control_bindings")).rows[0].n).toBe(0);
  });

  it("checks live admission on the same transaction connection at pool size one", async () => {
    const single = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 500 });
    try {
      const config = loadConfig({ DATABASE_URL: url, NODE_ENV: "test", APP_AUTH_MODE: "development",
        LIVE_ROUTE_ENABLED: "true", DEV_ALLOW_FIXTURE_ROUTE: "false",
        OPENROUTER_API_KEY: "synthetic-no-provider-call", LIVE_SPEND_CAP_MICRO: "1000000" });
      await expect(withTx(single, (db) => assertRouteAdmission(db, config, "controlled-research")))
        .resolves.toBeUndefined();
    } finally { await single.end(); }
  });

  it("fences a claimed parent worker and direct publication after binding revocation", async () => {
    const guest = await enabledGuest();
    await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers, payload: { grant: true } });
    const first = await app.inject({ method: "POST", url: "/v1/runs",
      headers: { ...guest.headers, "idempotency-key": crypto.randomUUID() },
      payload: { question: "What did ACME announce about Widget 4?", routeMode: "fixture",
        conversationId: guest.conversationId, consentPolicyVersion: CONSENT_POLICY_VERSION } });
    expect(first.statusCode).toBe(200);
    const runId = first.json().runId as string;
    const owner = (await pool.query("SELECT execution_owner_account_id FROM guest_contexts WHERE id=$1",
      [guest.guestContextId])).rows[0].execution_owner_account_id as string;
    const action = { kind: "new_research" as const, text: "Another Widget question" };
    const submissionId = crypto.randomUUID();
    const authAttemptId = crypto.randomUUID();
    await app.inject({ method: "POST", url: "/v1/guest/pending-actions", headers: guest.headers,
      payload: { submissionId, guestContextId: guest.guestContextId, conversationId: guest.conversationId,
        conversationVersion: 1, payload: action,
        payloadDigest: createHash("sha256").update(canonicalGuestPendingPayload(action)).digest("hex"),
        consentPolicyVersion: CONSENT_POLICY_VERSION } });
    await app.inject({ method: "POST", url: "/v1/guest/pending-actions/attempts/begin", headers: guest.headers,
      payload: { submissionId, authAttemptId, provider: "email_code" } });
    const member = (await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} })).json() as { token: string };
    expect((await app.inject({ method: "POST", url: "/v1/guest/claim",
      headers: { ...guest.headers, authorization: `Bearer ${member.token}` },
      payload: { claimRequestId: crypto.randomUUID(), submissionId, guestContextId: guest.guestContextId,
        conversationId: guest.conversationId, conversationVersion: 1, authAttemptId } })).statusCode).toBe(200);
    await pool.query("UPDATE conversation_control_bindings SET revoked_at=now(),revocation_reason='member_revoked' WHERE guest_context_id=$1",
      [guest.guestContextId]);
    await pool.query(`INSERT INTO guest_control_tombstones(guest_context_id,control_version,reason)
      SELECT id,control_version,'member_revoked' FROM guest_contexts WHERE id=$1`, [guest.guestContextId]);
    expect(await guestExecutionAllowed(pool, runId, owner)).toBe(false);
    await processRun(pool, loadConfig({ DATABASE_URL: url, NODE_ENV: "test", APP_AUTH_MODE: "development",
      DEV_ALLOW_FIXTURE_ROUTE: "true" }), runId);
    expect((await pool.query("SELECT count(*)::int AS n FROM reports WHERE run_id=$1", [runId])).rows[0].n).toBe(0);
    const attempted = await publishReport(pool, { accountId: owner, report: { runId } as never,
      loaded: {} as never, claims: [], passages: [], deleted: false });
    expect(attempted).toMatchObject({ accepted: false, reason: "guest_control_revoked" });
    expect((await app.inject({ method: "GET", url: `/v1/runs/${runId}`,
      headers: { authorization: `Bearer ${member.token}` } })).statusCode).toBe(404);
  });

  it("terminalizes edited or dismissed pending actions before and after claim without dispatch", async () => {
    const guest = await enabledGuest();
    await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers, payload: { grant: true } });
    expect((await app.inject({ method: "POST", url: "/v1/runs",
      headers: { ...guest.headers, "idempotency-key": crypto.randomUUID() },
      payload: { question: "What did ACME announce about Widget 4?", routeMode: "fixture",
        conversationId: guest.conversationId, consentPolicyVersion: CONSENT_POLICY_VERSION } })).statusCode).toBe(200);
    const action = { kind: "new_research" as const, text: "Saved second action" };
    const payloadDigest = createHash("sha256").update(canonicalGuestPendingPayload(action)).digest("hex");
    const register = async (submissionId: string) => app.inject({ method: "POST", url: "/v1/guest/pending-actions",
      headers: guest.headers, payload: { submissionId, guestContextId: guest.guestContextId,
        conversationId: guest.conversationId, conversationVersion: 1, payload: action, payloadDigest,
        consentPolicyVersion: CONSENT_POLICY_VERSION } });
    const oldId = crypto.randomUUID();
    const oldAttemptId = crypto.randomUUID();
    expect((await register(oldId)).statusCode).toBe(202);
    await app.inject({ method: "POST", url: "/v1/guest/pending-actions/attempts/begin", headers: guest.headers,
      payload: { submissionId: oldId, authAttemptId: oldAttemptId, provider: "email_code" } });
    const cancelled = await app.inject({ method: "POST", url: "/v1/guest/pending-actions/cancel",
      headers: guest.headers, payload: { submissionId: oldId } });
    expect(cancelled.json()).toMatchObject({ type: "action_abandoned", submissionId: oldId });
    expect((await app.inject({ method: "POST", url: "/v1/guest/pending-actions/cancel",
      headers: guest.headers, payload: { submissionId: oldId } })).statusCode).toBe(200);
    const newId = crypto.randomUUID();
    const newAttemptId = crypto.randomUUID();
    expect((await register(newId)).statusCode).toBe(202);
    await app.inject({ method: "POST", url: "/v1/guest/pending-actions/attempts/begin", headers: guest.headers,
      payload: { submissionId: newId, authAttemptId: newAttemptId, provider: "email_code" } });
    const member = (await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} })).json() as { token: string };
    const mixed = { ...guest.headers, authorization: `Bearer ${member.token}` };
    expect((await app.inject({ method: "POST", url: "/v1/guest/claim", headers: mixed,
      payload: { claimRequestId: crypto.randomUUID(), submissionId: oldId,
        guestContextId: guest.guestContextId, conversationId: guest.conversationId,
        conversationVersion: 1, authAttemptId: oldAttemptId } })).statusCode).toBe(409);
    const claimRequestId = crypto.randomUUID();
    expect((await app.inject({ method: "POST", url: "/v1/guest/claim", headers: mixed,
      payload: { claimRequestId, submissionId: newId, guestContextId: guest.guestContextId,
        conversationId: guest.conversationId, conversationVersion: 1,
        authAttemptId: newAttemptId } })).statusCode).toBe(200);
    const memberHeaders = { authorization: `Bearer ${member.token}` };
    const abandoned = await app.inject({ method: "POST", url: "/v1/guest/actions/abandon",
      headers: memberHeaders, payload: { submissionId: newId, claimRequestId } });
    expect(abandoned.json()).toMatchObject({ type: "action_abandoned", submissionId: newId, claimRequestId });
    expect((await app.inject({ method: "POST", url: "/v1/guest/claims/resolve",
      headers: memberHeaders, payload: { submissionId: newId, claimRequestId } })).json().type)
      .toBe("action_abandoned");
    expect((await app.inject({ method: "POST", url: "/v1/guest/actions/resume", headers: memberHeaders,
      payload: { submissionId: newId, claimRequestId, controlVersion: 2, payloadDigest } })).statusCode).toBe(409);
    expect((await pool.query("SELECT count(*)::int AS n FROM runs")).rows[0].n).toBe(1);
  });

  it("moves unknown paid outcome into sponsor HOLD and settles exact confirmed receipt once", async () => {
    const guest = await enabledGuest();
    await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers, payload: { grant: true } });
    const first = await app.inject({ method: "POST", url: "/v1/runs",
      headers: { ...guest.headers, "idempotency-key": crypto.randomUUID() },
      payload: { question: "Research this filing deadline", routeMode: "fixture",
        conversationId: guest.conversationId, consentPolicyVersion: CONSENT_POLICY_VERSION } });
    expect(first.statusCode).toBe(200);
    const runId = first.json().runId as string;
    const owner = (await pool.query<{ execution_owner_account_id: string }>(
      "SELECT execution_owner_account_id FROM guest_contexts WHERE id=$1", [guest.guestContextId])).rows[0]!.execution_owner_account_id;
    // Synthetic transport outcome only: no provider request is issued.
    await pool.query("UPDATE runs SET route_mode='controlled-research' WHERE id=$1", [runId]);
    const intentId = await recordIntent(pool, runId, { correlationId: crypto.randomUUID(),
      route: "openrouter:synthetic", digest: "a".repeat(64), reserved: 17000, state: "issued" });
    await settleRun(pool, owner, runId, 0);
    expect((await pool.query("SELECT reserved_micro::int,held_micro::int,settled_micro::int FROM guest_sponsor_ledgers WHERE policy_id='norrow-guest-first.v1'")).rows[0])
      .toMatchObject({ reserved_micro: 0, held_micro: 100000, settled_micro: 0 });
    await pool.query("UPDATE provider_intents SET state='confirmed',confirmed_micro=17000 WHERE id=$1", [intentId]);
    await settleRun(pool, owner, runId, 0);
    await settleRun(pool, owner, runId, 0);
    expect((await pool.query("SELECT reserved_micro::int,held_micro::int,settled_micro::int FROM guest_sponsor_ledgers WHERE policy_id='norrow-guest-first.v1'")).rows[0])
      .toMatchObject({ reserved_micro: 0, held_micro: 0, settled_micro: 17000 });
    expect((await pool.query("SELECT state,settled_micro::int FROM guest_sponsor_reservations WHERE run_id=$1", [runId])).rows[0])
      .toMatchObject({ state: "settled", settled_micro: 17000 });
  });

  it("lets the exact guest read its first report and cited source, while denying unrelated routes and mixed credentials", async () => {
    const guest = await enabledGuest();
    await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers, payload: { grant: true } });
    const first = await app.inject({ method: "POST", url: "/v1/runs",
      headers: { ...guest.headers, "idempotency-key": crypto.randomUUID() },
      payload: { question: "What did ACME announce about Widget 4?", routeMode: "fixture",
        conversationId: guest.conversationId, consentPolicyVersion: CONSENT_POLICY_VERSION } });
    expect(first.statusCode).toBe(200);
    const runId = first.json().runId as string;
    await processRun(pool, loadConfig({ DATABASE_URL: url, NODE_ENV: "test", APP_AUTH_MODE: "development",
      DEV_ALLOW_FIXTURE_ROUTE: "true" }), runId);
    const run = await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers: guest.headers });
    expect(run.statusCode).toBe(200);
    const reportId = run.json().reportId as string;
    expect(reportId).toBeTruthy();
    const report = await app.inject({ method: "GET", url: `/v1/reports/${reportId}`, headers: guest.headers });
    expect(report.statusCode).toBe(200);
    const citationIds = (report.json().blocks as Array<{ citationIds?: string[] }>).flatMap((b) => b.citationIds ?? []);
    expect(citationIds.length).toBeGreaterThan(0);
    expect((await app.inject({ method: "GET", url: `/v1/sources/${citationIds[0]}`, headers: guest.headers })).statusCode)
      .toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/runs/${runId}/cost`, headers: guest.headers })).statusCode)
      .toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/library", headers: guest.headers })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/attachments", headers: guest.headers,
      payload: { filename: "x.txt", mime: "text/plain", text: "private" } })).statusCode).toBe(403);
    const member = (await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} })).json() as
      { token: string };
    for (const path of ["/v1/session", "/v1/settings", `/v1/runs/${runId}`]) {
      const mixed = await app.inject({ method: "GET", url: path,
        headers: { ...guest.headers, authorization: `Bearer ${member.token}` } });
      expect(mixed.statusCode).toBe(403);
      expect(mixed.json().code).toBe("authority_denied");
    }
    expect((await app.inject({ method: "GET", url: `/v1/reports/${reportId}`,
      headers: { authorization: `Bearer ${member.token}` } })).statusCode).toBe(404);
    const action = { kind: "new_research" as const, text: "Compare a different Widget" };
    const submissionId = crypto.randomUUID();
    const authAttemptId = crypto.randomUUID();
    await app.inject({ method: "POST", url: "/v1/guest/pending-actions", headers: guest.headers,
      payload: { submissionId, guestContextId: guest.guestContextId, conversationId: guest.conversationId,
        conversationVersion: 1, payload: action,
        payloadDigest: createHash("sha256").update(canonicalGuestPendingPayload(action)).digest("hex"),
        consentPolicyVersion: CONSENT_POLICY_VERSION } });
    expect((await app.inject({ method: "POST", url: "/v1/guest/pending-actions/attempts/begin",
      headers: guest.headers, payload: { submissionId, authAttemptId, provider: "email_code" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/guest/claim",
      headers: { ...guest.headers, authorization: `Bearer ${member.token}` },
      payload: { claimRequestId: crypto.randomUUID(), submissionId, guestContextId: guest.guestContextId,
        conversationId: guest.conversationId, conversationVersion: 1, authAttemptId } })).statusCode).toBe(200);
    const claimedHeaders = { authorization: `Bearer ${member.token}` };
    expect((await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers: claimedHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/runs/${runId}/events`, headers: claimedHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/reports/${reportId}`, headers: claimedHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/sources/${citationIds[0]}`, headers: claimedHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/runs/${runId}/cost`, headers: claimedHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/reports/${reportId}/export`, headers: claimedHeaders })).statusCode).toBe(200);
    const library = await app.inject({ method: "GET", url: "/v1/library", headers: claimedHeaders });
    expect(library.statusCode).toBe(200);
    expect((library.json().items as Array<{ id: string }>).some((item) => item.id === runId)).toBe(true);
    expect((await app.inject({ method: "GET", url: `/v1/reports/${reportId}`, headers: guest.headers })).statusCode).toBe(401);
  });
});

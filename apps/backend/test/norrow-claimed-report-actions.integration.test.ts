import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { canonicalGuestPendingPayload, CONSENT_POLICY_VERSION, CorrectionRequestSchema } from "@deep/contracts";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";
import { insertClaimedReportChallenge, admitClaimedReportCorrection } from "../src/modules/claimed-report-actions.js";
import { insertSource, insertVersionAndPassage } from "../src/modules/evidence.js";
import { deleteSourceForAccount } from "../src/modules/source-deletion.js";
import { recordIntent, settleRun } from "../src/modules/billing.js";
import { deleteAccount, revokeConsent } from "../src/modules/access.js";
import { getBrief, getRun } from "../src/modules/runs.js";
import { guestExecutionAllowed } from "../src/modules/guest-execution-control.js";
import { prepareClaimedResearchContext } from "../src/modules/run-evidence.js";
import { cancelGuestConversationRun } from "../src/modules/guest-auth.js";

const url = process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
const config = loadConfig({ DATABASE_URL: url, NODE_ENV: "test", APP_AUTH_MODE: "development",
  NORROW_GUEST_BOOTSTRAP_ENABLED: "true",
  NORROW_GUEST_PROOF_PEPPER: "nonsecret-isolated-test-pepper-1234567890",
  LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true", LIVE_RETRIEVAL_ENABLED: "true",
  OPENROUTER_API_KEY: "synthetic-test-never-sent", LIVE_SPEND_CAP_MICRO: "10000000",
  LIVE_KEY_SPEND_CAP_MICRO: "10000000", DEV_ALLOW_FIXTURE_ROUTE: "true" });
const question = "Compare local AI laptops under two thousand dollars.";
let pool: pg.Pool;
let boss: PgBoss;
let app: FastifyInstance;

beforeAll(async () => {
  pool = createPool(url);
  await migrate(pool);
  boss = await createQueue(url);
  app = await buildApp({ pool, boss, config });
});
beforeEach(async () => {
  await pool.query("TRUNCATE accounts CASCADE");
  await pool.query("TRUNCATE guest_bootstrap_limits");
  await pool.query(`UPDATE guest_sponsor_policies SET enabled=true,killed=false,expires_at=now()+interval '1 day',
    exposure_cap_micro=100000,per_guest_cap_micro=100000,bootstrap_limit_per_risk=10
    WHERE id='norrow-guest-first.v1'`);
  await pool.query(`UPDATE guest_sponsor_ledgers SET settled_micro=0,reserved_micro=0,held_micro=0
    WHERE policy_id='norrow-guest-first.v1'`);
});
afterAll(async () => {
  await app.close();
  await boss.stop({ graceful: false, timeout: 2000 });
  await pool.end();
});

async function member() {
  const session = await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} });
  expect(session.statusCode).toBe(200);
  const data = session.json() as { accountId: string; token: string };
  const headers = { authorization: `Bearer ${data.token}` };
  expect((await app.inject({ method: "POST", url: "/v1/consent", headers,
    payload: { grant: true } })).statusCode).toBe(200);
  return { ...data, headers };
}

async function claimedReport(dispatch: boolean) {
  const bootstrap = await app.inject({ method: "POST", url: "/v1/guest/bootstrap", payload: {} });
  expect(bootstrap.statusCode).toBe(201);
  const guest = bootstrap.json() as { guestContextId: string; conversationId: string; proof: string };
  const guestHeaders = { "x-norrow-guest-proof": guest.proof };
  expect((await app.inject({ method: "POST", url: "/v1/consent", headers: guestHeaders,
    payload: { grant: true } })).statusCode).toBe(200);
  const first = await app.inject({ method: "POST", url: "/v1/runs",
    headers: { ...guestHeaders, "idempotency-key": crypto.randomUUID() },
    payload: { question, routeMode: "controlled-research", conversationId: guest.conversationId,
      consentPolicyVersion: CONSENT_POLICY_VERSION } });
  expect(first.statusCode).toBe(200);
  const parentRunId = first.json().runId as string;
  const guestOwnerId = (await pool.query<{ execution_owner_account_id: string }>(
    "SELECT execution_owner_account_id FROM guest_contexts WHERE id=$1", [guest.guestContextId]))
    .rows[0]!.execution_owner_account_id;
  const sourceId = await insertSource(pool, { accountId: guestOwnerId, runId: parentRunId,
    locator: "https://example.test/claim12-source", title: "Synthetic source", publisher: "Synthetic",
    originCluster: "claim12-source" });
  const { passageId } = await insertVersionAndPassage(pool, { accountId: guestOwnerId,
    runId: parentRunId, sourceId, locator: "https://example.test/claim12-source",
    text: "Synthetic evidence for claimed report access.", accessLevel: "full-text" });
  const claimId = crypto.randomUUID(), reportId = crypto.randomUUID();
  await pool.query(`INSERT INTO claims(id,run_id,account_id,text,type,support_status)
    VALUES ($1,$2,$3,'Synthetic owned claim','external-fact','direct')`,
    [claimId, parentRunId, guestOwnerId]);
  await pool.query(`INSERT INTO reports(id,run_id,account_id,version,outcome,basis,blocks,claim_ids,
    limitations,source_access_summary,route_mode)
    VALUES($1,$2,$3,1,'completed_with_limitations','{}',$4,$5,'[]','[]','controlled-research')`,
    [reportId, parentRunId, guestOwnerId, JSON.stringify([{ id: "answer", kind: "text",
      text: "Synthetic claimed report answer.", citationIds: [passageId] }]), [claimId]]);
  const action = { kind: "follow_up" as const, text: "What about battery life?", parentRunId };
  const submissionId = crypto.randomUUID(), authAttemptId = crypto.randomUUID();
  const claimRequestId = crypto.randomUUID();
  const payloadDigest = createHash("sha256").update(canonicalGuestPendingPayload(action)).digest("hex");
  expect((await app.inject({ method: "POST", url: "/v1/guest/pending-actions", headers: guestHeaders,
    payload: { submissionId, guestContextId: guest.guestContextId, conversationId: guest.conversationId,
      conversationVersion: 1, payload: action, payloadDigest,
      consentPolicyVersion: CONSENT_POLICY_VERSION } })).statusCode).toBe(202);
  expect((await app.inject({ method: "POST", url: "/v1/guest/pending-actions/attempts/begin",
    headers: guestHeaders, payload: { submissionId, authAttemptId, provider: "email_code" } })).statusCode).toBe(200);
  const claimant = await member();
  const claim = await app.inject({ method: "POST", url: "/v1/guest/claim",
    headers: { ...claimant.headers, ...guestHeaders }, payload: { claimRequestId, submissionId,
      guestContextId: guest.guestContextId, conversationId: guest.conversationId,
      conversationVersion: 1, authAttemptId } });
  expect(claim.statusCode).toBe(200);
  let continuation: { runId: string; memberConversationId: string } | null = null;
  if (dispatch) {
    const resumed = await app.inject({ method: "POST", url: "/v1/guest/actions/resume",
      headers: claimant.headers, payload: { submissionId, claimRequestId,
        controlVersion: claim.json().controlVersion, payloadDigest } });
    expect(resumed.statusCode).toBe(200);
    continuation = resumed.json();
  }
  return { guest, guestOwnerId, parentRunId, sourceId, passageId, claimId, reportId,
    claimant, submissionId, claimRequestId, payloadDigest,
    controlVersion: claim.json().controlVersion as number, continuation };
}

function correction(expectedBriefRevision = 1) {
  return CorrectionRequestSchema.parse({ expectedBriefRevision,
    correctionText: "Raise the budget for a fresh member-owned check.",
    patch: { kind: "replace_question", question: "Compare local AI laptops under three thousand dollars.",
      evidencePolicy: "refresh" } });
}

describe("CLAIM-12 claimed report actions", () => {
  it("rechecks claimed cancellation after a competing binding revocation commits", async () => {
    const x = await claimedReport(false);
    const original = (await pool.query("SELECT lifecycle FROM runs WHERE id=$1",
      [x.parentRunId])).rows[0].lifecycle as string;
    const control = new pg.Client({ connectionString: url });
    await control.connect();
    let locked = false;
    try {
      await control.query("BEGIN");
      await control.query("SELECT id FROM conversation_control_bindings WHERE guest_context_id=$1 FOR UPDATE",
        [x.guest.guestContextId]);
      locked = true;
      const cancelling = cancelGuestConversationRun(pool, x.parentRunId,
        { kind: "claimed", memberAccountId: x.claimant.accountId }).catch((error: unknown) => error);
      let waiting = false;
      for (let i = 0; i < 200; i++) {
        const activity = await control.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND pid<>pg_backend_pid() AND wait_event_type='Lock'
          AND (query LIKE '%conversation_control_bindings%' OR query LIKE '%guest_contexts%')`);
        if (activity.rowCount) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(waiting).toBe(true);
      await control.query(`UPDATE conversation_control_bindings SET revoked_at=now(),
        revocation_reason='member_revoked' WHERE guest_context_id=$1`, [x.guest.guestContextId]);
      await control.query("COMMIT");
      locked = false;
      expect(await cancelling).toMatchObject({ statusCode: 404, code: "authority_denied" });
      expect((await app.inject({ method: "POST", url: `/v1/runs/${x.parentRunId}/cancel`,
        headers: x.claimant.headers, payload: {} })).statusCode).toBe(404);
      expect((await pool.query("SELECT lifecycle FROM runs WHERE id=$1",
        [x.parentRunId])).rows[0].lifecycle).toBe(original);
    } finally {
      if (locked) await control.query("ROLLBACK");
      await control.end();
    }
  });
  it("guest account deletion redacts exact claimed member descendants and copied challenge excerpts", async () => {
    const x = await claimedReport(true);
    const challenge = await insertClaimedReportChallenge(pool, x.claimant.accountId,
      x.parentRunId, x.reportId, { idempotencyKey: crypto.randomUUID(), category: "claim",
        claimId: x.claimId, includeExcerpt: true });
    const corrected = await admitClaimedReportCorrection(pool, config, x.claimant.accountId,
      x.parentRunId, correction());
    const continuationRunId = x.continuation!.runId;
    const continuationBriefId = (await pool.query("SELECT brief_id FROM runs WHERE id=$1",
      [continuationRunId])).rows[0].brief_id as string;
    await pool.query(`UPDATE research_briefs SET payload=jsonb_set(payload,'{desiredOutcome}',
      to_jsonb('Synthetic claimed report answer.'::text)) WHERE id=$1`, [continuationBriefId]);
    const copiedReportId = crypto.randomUUID();
    await pool.query(`INSERT INTO reports(id,run_id,account_id,version,outcome,basis,blocks,claim_ids,
      limitations,source_access_summary,route_mode)
      VALUES($1,$2,$3,1,'completed_with_limitations','{}',$4,'{}','[]','[]','controlled-research')`,
      [copiedReportId,continuationRunId,x.claimant.accountId,
        JSON.stringify([{ id: "answer", kind: "text", text: "Synthetic claimed report answer.", citationIds: [] }])]);
    const childSourceId = await insertSource(pool, { accountId: x.claimant.accountId,
      runId: continuationRunId, locator: "https://example.test/claimed-derived-literal",
      title: "Synthetic claimed report answer.", publisher: "Synthetic", originCluster: "claimed-derived" });
    const { passageId: childPassageId } = await insertVersionAndPassage(pool, {
      accountId: x.claimant.accountId, runId: continuationRunId, sourceId: childSourceId,
      locator: "https://example.test/claimed-derived-literal",
      text: "Synthetic claimed report answer.", accessLevel: "full-text" });
    const independent = await app.inject({ method: "POST", url: "/v1/runs",
      headers: { ...x.claimant.headers, "idempotency-key": crypto.randomUUID() },
      payload: { question: "Independently research garden plants", routeMode: "fixture",
        consentPolicyVersion: CONSENT_POLICY_VERSION } });
    expect(independent.statusCode).toBe(200);
    const independentId = independent.json().runId as string;
    await recordIntent(pool, x.parentRunId, { correlationId: crypto.randomUUID(),
      route: "openrouter:synthetic", digest: "unknown-cost-guest-delete", reserved: 20000,
      state: "outcome-unknown" });
    await withTx(pool, db => settleRun(db, x.guestOwnerId, x.parentRunId, 0));
    expect((await pool.query("SELECT state FROM guest_sponsor_reservations WHERE run_id=$1",
      [x.parentRunId])).rows[0].state).toBe("held");

    await deleteAccount(pool, x.guestOwnerId);
    expect((await pool.query("SELECT count(*)::integer AS n FROM challenges WHERE id=$1",
      [challenge.challengeId])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT payload FROM research_briefs WHERE id=$1",
      [continuationBriefId])).rows[0].payload).toEqual({});
    expect((await pool.query("SELECT blocks,redacted_at FROM reports WHERE id=$1",
      [copiedReportId])).rows[0]).toMatchObject({ blocks: [], redacted_at: expect.any(Date) });
    expect((await pool.query("SELECT canonical_locator,title FROM sources WHERE id=$1",
      [childSourceId])).rows[0]).toMatchObject({ canonical_locator: "[deleted]", title: "[deleted]" });
    expect((await app.inject({ method: "GET", url: `/v1/sources/${childPassageId}`,
      headers: x.claimant.headers })).statusCode).toBe(404);
    expect(await guestExecutionAllowed(pool, continuationRunId, x.claimant.accountId)).toBe(false);
    expect(await guestExecutionAllowed(pool, corrected.runId, x.claimant.accountId)).toBe(false);
    expect((await pool.query("SELECT state FROM reservations WHERE run_id=$1",
      [corrected.runId])).rows[0].state).toBe("settled");
    expect((await pool.query("SELECT state FROM guest_sponsor_reservations WHERE run_id=$1",
      [x.parentRunId])).rows[0].state).toBe("held");
    expect((await pool.query("SELECT original_question FROM research_briefs WHERE id=(SELECT brief_id FROM runs WHERE id=$1)",
      [independentId])).rows[0].original_question).toBe("Independently research garden plants");
    expect((await pool.query("SELECT deleted_at FROM accounts WHERE id=$1",
      [x.claimant.accountId])).rows[0].deleted_at).toBeNull();
  });
  it("delegates only the exact recorded second follow-up through the parent route", async () => {
    const x = await claimedReport(false);
    const saved = { submissionId: x.submissionId, claimRequestId: x.claimRequestId,
      controlVersion: x.controlVersion, payloadDigest: x.payloadDigest };
    const route = `/v1/runs/${x.parentRunId}/follow-up`;
    expect((await app.inject({ method: "POST", url: route, headers: x.claimant.headers,
      payload: { message: "An unsaved different follow-up" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/v1/runs/${x.parentRunId}/continue`,
      headers: x.claimant.headers, payload: saved })).statusCode).toBe(409);
    const outsider = await member();
    expect((await app.inject({ method: "POST", url: route, headers: outsider.headers,
      payload: saved })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: route,
      headers: { "x-norrow-guest-proof": x.guest.proof }, payload: saved })).statusCode).toBe(403);
    const first = await app.inject({ method: "POST", url: route, headers: x.claimant.headers, payload: saved });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ type: "continuation_dispatched", kind: "follow_up", reused: false });
    const replay = await app.inject({ method: "POST", url: route, headers: x.claimant.headers, payload: saved });
    expect(replay.json()).toMatchObject({ runId: first.json().runId, reused: true });
    expect((await pool.query("SELECT count(*)::integer AS n FROM runs WHERE claimed_parent_run_id=$1",
      [x.parentRunId])).rows[0].n).toBe(1);
  });
  it("serves claimed challenge and correction through HTTP, denying unrelated authority", async () => {
    const x = await claimedReport(true);
    const key = crypto.randomUUID();
    const challenge = () => app.inject({ method: "POST", url: `/v1/reports/${x.reportId}/challenges`,
      headers: { ...x.claimant.headers, "idempotency-key": key },
      payload: { claimId: x.claimId, category: "claim", note: "Please check this claim.", includeExcerpt: true } });
    const first = await challenge();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ submitted: true, includedExcerpt: true, reused: false });
    expect((await challenge()).json()).toMatchObject({ challengeId: first.json().challengeId, reused: true });
    const outsider = await member();
    expect((await app.inject({ method: "POST", url: `/v1/reports/${x.reportId}/challenges`,
      headers: { ...outsider.headers, "idempotency-key": key }, payload: { category: "other" } })).statusCode).toBe(404);
    const corrected = await app.inject({ method: "POST", url: `/v1/runs/${x.parentRunId}/corrections`,
      headers: x.claimant.headers, payload: correction() });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json()).toMatchObject({ parentRunId: x.parentRunId, reused: false, fullRerun: true });
    expect((await app.inject({ method: "POST", url: `/v1/runs/${x.parentRunId}/corrections`,
      headers: x.claimant.headers, payload: correction() })).json())
      .toMatchObject({ runId: corrected.json().runId, reused: true });
    const resolved = await app.inject({ method: "POST",
      url: `/v1/runs/${x.parentRunId}/corrections/resolve`,
      headers: x.claimant.headers, payload: correction() });
    expect(resolved.json()).toMatchObject({ status: "accepted",
      run: { runId: corrected.json().runId } });
    const absent = { ...correction(), correctionText: "A different saved correction identity." };
    expect((await app.inject({ method: "POST", url: `/v1/runs/${x.parentRunId}/corrections/resolve`,
      headers: x.claimant.headers, payload: absent })).json()).toMatchObject({ status: "withdrawn" });
    expect((await app.inject({ method: "POST", url: `/v1/runs/${x.parentRunId}/corrections`,
      headers: x.claimant.headers, payload: absent })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/v1/runs/${x.parentRunId}/corrections`,
      headers: outsider.headers, payload: correction() })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/runs/${x.parentRunId}/corrections`,
      headers: { "x-norrow-guest-proof": x.guest.proof }, payload: correction() })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/runs/${x.parentRunId}/corrections/resolve`,
      headers: { "x-norrow-guest-proof": x.guest.proof }, payload: correction() })).statusCode).toBe(403);
  });
  it("requires the original pending second action to have actually dispatched", async () => {
    const x = await claimedReport(false);
    await expect(insertClaimedReportChallenge(pool, x.claimant.accountId, x.parentRunId,
      x.reportId, { idempotencyKey: crypto.randomUUID(), category: "claim", claimId: x.claimId }))
      .rejects.toMatchObject({ code: "authority_denied", statusCode: 404 });
    await expect(admitClaimedReportCorrection(pool, config, x.claimant.accountId, x.parentRunId,
      correction())).rejects.toMatchObject({ code: "authority_denied", statusCode: 404 });
    expect((await pool.query("SELECT count(*)::int AS n FROM challenges")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM research_change_sets")).rows[0].n).toBe(0);
  });

  it("keeps the guest report and payer immutable while member challenge and refresh correction replay once", async () => {
    const x = await claimedReport(true);
    const read = await app.inject({ method: "GET", url: `/v1/reports/${x.reportId}`,
      headers: x.claimant.headers });
    expect(read.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/sources/${x.passageId}`,
      headers: x.claimant.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/reports/${x.reportId}/export`,
      headers: x.claimant.headers })).statusCode).toBe(200);
    const challengeKey = crypto.randomUUID();
    const challengeArgs = { idempotencyKey: challengeKey, category: "claim" as const,
      claimId: x.claimId, note: "Please review this exact claim.", includeExcerpt: true };
    const challenge = await insertClaimedReportChallenge(pool, x.claimant.accountId,
      x.parentRunId, x.reportId, challengeArgs);
    expect(challenge.reused).toBe(false);
    expect(await insertClaimedReportChallenge(pool, x.claimant.accountId,
      x.parentRunId, x.reportId, challengeArgs)).toMatchObject({ challengeId: challenge.challengeId,
      reused: true });
    await expect(insertClaimedReportChallenge(pool, x.claimant.accountId,
      x.parentRunId, x.reportId, { ...challengeArgs, note: "Changed note" }))
      .rejects.toMatchObject({ code: "idempotency_conflict", statusCode: 409 });
    expect((await pool.query("SELECT account_id,report_id,include_excerpt,excerpt_text FROM challenges WHERE id=$1",
      [challenge.challengeId])).rows[0]).toMatchObject({ account_id: x.claimant.accountId,
      report_id: x.reportId, include_excerpt: true,
      excerpt_text: "Synthetic claimed report answer." });
    const input = correction();
    const children = await Promise.all([admitClaimedReportCorrection(pool, config,
      x.claimant.accountId, x.parentRunId, input), admitClaimedReportCorrection(pool, config,
      x.claimant.accountId, x.parentRunId, input)]);
    expect(new Set(children.map(child => child.runId)).size).toBe(1);
    expect(children.filter(child => !child.reused)).toHaveLength(1);
    const runId = children[0]!.runId;
    const row = (await pool.query(`SELECT account_id,parent_run_id,claimed_parent_run_id,
      claimed_parent_conversation_id,claimed_control_binding_id,claimed_control_version,
      guest_pending_action_id,conversation_id FROM runs WHERE id=$1`, [runId])).rows[0];
    expect(row).toMatchObject({ account_id: x.claimant.accountId, parent_run_id: null,
      claimed_parent_run_id: x.parentRunId, guest_pending_action_id: null,
      conversation_id: x.continuation!.memberConversationId });
    const proof = (await pool.query(`SELECT account_id,parent_run_id,patch,reused_passages,
      reopen_discovery,dependency_completeness FROM research_change_sets WHERE run_id=$1`, [runId])).rows[0];
    expect(proof).toMatchObject({ account_id: x.claimant.accountId, parent_run_id: x.parentRunId,
      patch: { version: "research-correction.v1", patch: input.patch,
        claimedParentRunId: x.parentRunId, claimedControlBindingId: row.claimed_control_binding_id,
        claimedControlVersion: Number(row.claimed_control_version),
        originalPendingSubmissionId: x.submissionId }, reused_passages: 0,
      reopen_discovery: true, dependency_completeness: "unknown" });
    expect((await getBrief(pool, (await getRun(pool, runId))!.brief_id)).originalQuestion)
      .toBe("Compare local AI laptops under three thousand dollars.");
    expect((await pool.query("SELECT count(*)::int AS n FROM run_evidence_membership WHERE run_id=$1",
      [runId])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM run_dispatch_outbox WHERE run_id=$1",
      [runId])).rows[0].n).toBe(1);
    expect(await guestExecutionAllowed(pool, runId, x.claimant.accountId)).toBe(true);
    expect(await withTx(pool, db => prepareClaimedResearchContext(db, { runId,
      accountId: x.claimant.accountId, briefRevision: children[0]!.briefRevision }))).toBeNull();
    expect((await pool.query("SELECT count(*)::int AS n FROM reservations WHERE run_id=$1",
      [runId])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT account_id FROM reports WHERE id=$1", [x.reportId])).rows[0].account_id)
      .toBe(x.guestOwnerId);
    expect((await pool.query("SELECT run_id FROM guest_sponsor_reservations WHERE run_id=$1",
      [x.parentRunId])).rowCount).toBe(1);
  });

  it("rejects cross-member, forged claim and invalid patches without a child or challenge", async () => {
    const x = await claimedReport(true), outsider = await member();
    await expect(insertClaimedReportChallenge(pool, outsider.accountId, x.parentRunId,
      x.reportId, { idempotencyKey: crypto.randomUUID(), category: "claim", claimId: x.claimId }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(admitClaimedReportCorrection(pool, config, outsider.accountId,
      x.parentRunId, correction())).rejects.toMatchObject({ statusCode: 404 });
    await expect(insertClaimedReportChallenge(pool, x.claimant.accountId, x.parentRunId,
      x.reportId, { idempotencyKey: crypto.randomUUID(), category: "claim", claimId: crypto.randomUUID() }))
      .rejects.toMatchObject({ statusCode: 404 });
    const reuse = CorrectionRequestSchema.parse({ ...correction(), patch: {
      kind: "replace_question", question: "Another question", evidencePolicy: "reuse_snapshot" } });
    await expect(admitClaimedReportCorrection(pool, config, x.claimant.accountId,
      x.parentRunId, reuse)).rejects.toMatchObject({ statusCode: 400 });
    const wrongSpan = CorrectionRequestSchema.parse({ ...correction(), patch: {
      kind: "replace_question_span", originalQuestionSha256: "0".repeat(64), start: 0,
      end: 7, quote: "Compare", replacement: "Assess", evidencePolicy: "refresh" } });
    await expect(admitClaimedReportCorrection(pool, config, x.claimant.accountId,
      x.parentRunId, wrongSpan)).rejects.toMatchObject({ statusCode: 409 });
    expect((await pool.query("SELECT count(*)::int AS n FROM research_change_sets")).rows[0].n).toBe(0);
  });

  it("accepts a digest-bound Unicode-safe span only as a fresh member child", async () => {
    const x = await claimedReport(true);
    const start = question.indexOf("two"), end = start + "two".length;
    const input = CorrectionRequestSchema.parse({ expectedBriefRevision: 1,
      correctionText: "Change only the quoted budget word.",
      patch: { kind: "replace_question_span", evidencePolicy: "refresh",
        originalQuestionSha256: createHash("sha256").update(question).digest("hex"),
        start, end, quote: "two", replacement: "three" } });
    const created = await admitClaimedReportCorrection(pool, config, x.claimant.accountId,
      x.parentRunId, input);
    const child = (await getRun(pool, created.runId))!;
    expect((await getBrief(pool, child.brief_id)).originalQuestion)
      .toBe("Compare local AI laptops under three thousand dollars.");
    expect(child.account_id).toBe(x.claimant.accountId);
    expect((await getRun(pool, x.parentRunId))!.account_id).toBe(x.guestOwnerId);
    expect((await pool.query("SELECT count(*)::int AS n FROM run_evidence_membership WHERE run_id=$1",
      [created.runId])).rows[0].n).toBe(0);
  });

  it("rejects replay after member consent revocation and admits no extra reservation", async () => {
    const x = await claimedReport(true), input = correction();
    const child = await admitClaimedReportCorrection(pool, config, x.claimant.accountId,
      x.parentRunId, input);
    await revokeConsent(pool, x.claimant.accountId);
    await expect(admitClaimedReportCorrection(pool, config, x.claimant.accountId,
      x.parentRunId, input)).rejects.toMatchObject({ code: "consent_required", statusCode: 403 });
    await expect(insertClaimedReportChallenge(pool, x.claimant.accountId, x.parentRunId,
      x.reportId, { idempotencyKey: crypto.randomUUID(), category: "other" }))
      .rejects.toMatchObject({ code: "consent_required", statusCode: 403 });
    expect((await pool.query("SELECT count(*)::int AS n FROM reservations WHERE run_id=$1",
      [child.runId])).rows[0].n).toBe(1);
  });

  it("rejects replay after an exact binding revocation, even with a valid member account", async () => {
    const x = await claimedReport(true), input = correction();
    const child = await admitClaimedReportCorrection(pool, config, x.claimant.accountId,
      x.parentRunId, input);
    await pool.query(`UPDATE conversation_control_bindings SET revoked_at=now(),
      revocation_reason='member_revoked' WHERE member_account_id=$1`, [x.claimant.accountId]);
    expect(await guestExecutionAllowed(pool, child.runId, x.claimant.accountId)).toBe(false);
    await expect(admitClaimedReportCorrection(pool, config, x.claimant.accountId,
      x.parentRunId, input)).rejects.toMatchObject({ code: "authority_denied", statusCode: 404 });
    await expect(insertClaimedReportChallenge(pool, x.claimant.accountId, x.parentRunId,
      x.reportId, { idempotencyKey: crypto.randomUUID(), category: "other" }))
      .rejects.toMatchObject({ code: "authority_denied", statusCode: 404 });
    expect((await pool.query("SELECT count(*)::int AS n FROM reservations WHERE run_id=$1",
      [child.runId])).rows[0].n).toBe(1);
  });

  it("denies deleted sources and tampered replay proof; preserves original unknown financial HOLD", async () => {
    const x = await claimedReport(true);
    const input = correction();
    const created = await admitClaimedReportCorrection(pool, config, x.claimant.accountId,
      x.parentRunId, input);
    await pool.query("UPDATE research_change_sets SET patch='{}'::jsonb WHERE run_id=$1", [created.runId]);
    await expect(admitClaimedReportCorrection(pool, config, x.claimant.accountId,
      x.parentRunId, input)).rejects.toMatchObject({ code: "correction_recovery_basis_unavailable",
        statusCode: 409 });
    await recordIntent(pool, x.parentRunId, { correlationId: crypto.randomUUID(),
      route: "openrouter:synthetic", digest: "unknown-cost-claim12", reserved: 20000,
      state: "outcome-unknown" });
    await withTx(pool, db => settleRun(db, x.guestOwnerId, x.parentRunId, 0));
    expect((await pool.query("SELECT state FROM guest_sponsor_reservations WHERE run_id=$1",
      [x.parentRunId])).rows[0].state).toBe("held");
    await deleteSourceForAccount(pool, x.guestOwnerId, x.sourceId,
      { kind: "claimed", memberAccountId: x.claimant.accountId, runId: x.parentRunId });
    await expect(insertClaimedReportChallenge(pool, x.claimant.accountId, x.parentRunId,
      x.reportId, { idempotencyKey: crypto.randomUUID(), category: "other" }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(admitClaimedReportCorrection(pool, config, x.claimant.accountId,
      x.parentRunId, input)).rejects.toMatchObject({ statusCode: 404 });
    expect((await pool.query("SELECT state FROM guest_sponsor_reservations WHERE run_id=$1",
      [x.parentRunId])).rows[0].state).toBe("held");
    expect((await pool.query("SELECT state FROM provider_intents WHERE run_id=$1",
      [x.parentRunId])).rows[0].state).toBe("outcome-unknown");
    expect((await pool.query("SELECT account_id FROM reports WHERE id=$1", [x.reportId])).rows[0].account_id)
      .toBe(x.guestOwnerId);
  });

  it("fails closed when the member allowance is exhausted, without a partial outbox or receipt", async () => {
    const x = await claimedReport(true);
    await pool.query(`UPDATE allowance_accounts SET limit_micro=reserved_micro+settled_micro
      WHERE account_id=$1`, [x.claimant.accountId]);
    await expect(admitClaimedReportCorrection(pool, config, x.claimant.accountId,
      x.parentRunId, correction())).rejects.toMatchObject({ code: "allowance_exhausted" });
    expect((await pool.query("SELECT count(*)::int AS n FROM research_change_sets")).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM runs WHERE account_id=$1
      AND claimed_parent_run_id=$2 AND guest_pending_action_id IS NULL`,
      [x.claimant.accountId, x.parentRunId])).rows[0].n).toBe(0);
  });
});

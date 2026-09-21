import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import {
  canonicalGuestPendingPayload,
  CONSENT_POLICY_VERSION,
  DEFAULT_RUN_BUDGET_MICRO,
} from "@deep/contracts";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { createPool, migrate } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";

/**
 * AUD04 held-out regression: new-member entitlement.
 *
 * A real newly-mapped member starts with ZERO spendable budget (identity.ts:
 * "Authentication is not a grant of paid allowance"). The intended second action
 * — the claimed-continuation resume (POST /v1/guest/actions/resume) — works
 * exactly once only after BOTH explicit member-scoped prerequisites hold:
 *   1. an explicit authorized BOUNDED grant (limit_micro set to a finite value
 *      >= one run by the operator/customer funding path), and
 *   2. a member-specific consent grant (POST /v1/consent {grant:true} as that
 *      member on the current CONSENT_POLICY_VERSION).
 *
 * Member sessions below are minted via POST /v1/dev/session ONLY as identity
 * stand-ins; every case immediately zeroes the dev fixture allowance
 * (10_000_000) to the production-equivalent zero-state before the case begins,
 * and the bounded grant is applied explicitly per case. No unlimited credit is
 * ever minted, guest consent never transfers, HOLD is never bypassed, and no
 * payer/owner identity is ever rewritten. Live-spend variants are stubbed as
 * operator-blocked (E-HOLD-12 tail); no live provider call is attempted.
 */
const baseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";

function scratchUrl(): { adminUrl: string; url: string; dbName: string } {
  const parsed = new URL(baseUrl);
  const dbName = `deep_norrow_entitle_${process.pid}_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
  const adminUrl = baseUrl;
  parsed.pathname = `/${dbName}`;
  return { adminUrl, url: parsed.toString(), dbName };
}

const scratch = scratchUrl();
const url = scratch.url;
let pool: pg.Pool;
let boss: PgBoss;
let app: FastifyInstance;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: scratch.adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${scratch.dbName}"`);
  } finally {
    await admin.end();
  }
  pool = createPool(url);
  await migrate(pool);
  boss = await createQueue(url);
  app = await buildApp({
    pool,
    boss,
    config: loadConfig({
      DATABASE_URL: url,
      NODE_ENV: "test",
      APP_AUTH_MODE: "development",
      NORROW_GUEST_BOOTSTRAP_ENABLED: "true",
      NORROW_GUEST_PROOF_PEPPER: "nonsecret-isolated-test-pepper-1234567890",
      DEV_ALLOW_FIXTURE_ROUTE: "true",
    }),
  });
}, 120_000);

beforeEach(async () => {
  await pool.query("TRUNCATE accounts CASCADE");
  await pool.query("TRUNCATE guest_bootstrap_limits");
  await pool.query(`UPDATE guest_sponsor_policies SET enabled=true,killed=false,
    expires_at=now()+interval '1 day',exposure_cap_micro=100000,per_guest_cap_micro=100000,
    bootstrap_limit_per_risk=10 WHERE id='norrow-guest-first.v1'`);
  await pool.query(
    "UPDATE guest_sponsor_ledgers SET settled_micro=0,reserved_micro=0,held_micro=0 WHERE policy_id='norrow-guest-first.v1'",
  );
});

afterAll(async () => {
  await app.close();
  await boss.stop({ graceful: false, timeout: 2000 });
  await pool.end();
  const admin = new pg.Client({ connectionString: scratch.adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE "${scratch.dbName}"`);
  } finally {
    await admin.end();
  }
}, 60_000);

async function enabledGuest() {
  const bootstrap = await app.inject({ method: "POST", url: "/v1/guest/bootstrap", payload: {} });
  expect(bootstrap.statusCode).toBe(201);
  const guest = bootstrap.json() as { guestContextId: string; conversationId: string; proof: string };
  return { ...guest, headers: { "x-norrow-guest-proof": guest.proof } };
}

/** Identity stand-in only: dev sessions mint fixture allowance, so zero it to the production zero-state. */
async function newZeroedMember() {
  const session = await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} });
  expect(session.statusCode).toBe(200);
  const member = session.json() as { token: string; accountId: string };
  await pool.query(
    "UPDATE allowance_accounts SET limit_micro=0,settled_micro=0,reserved_micro=0 WHERE account_id=$1",
    [member.accountId],
  );
  const row = (
    await pool.query<{ limit_micro: string; settled_micro: string; reserved_micro: string }>(
      "SELECT limit_micro,settled_micro,reserved_micro FROM allowance_accounts WHERE account_id=$1",
      [member.accountId],
    )
  ).rows[0]!;
  expect(row).toMatchObject({ limit_micro: "0", settled_micro: "0", reserved_micro: "0" });
  return { ...member, headers: { authorization: `Bearer ${member.token}` } };
}

/**
 * The ONLY grant mechanism in this suite: an explicit authorized bounded
 * UPDATE of the one member row, with the bound asserted before applying and
 * read back exactly afterwards. Rejects unlimited (NULL/huge), zero, and
 * negative amounts at the harness — the bound the funding path must enforce.
 */
async function boundedGrant(memberAccountId: string, amountMicro: number) {
  if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0 || amountMicro > 1_000_000) {
    throw Object.assign(new Error("unbounded_or_invalid_grant"), { code: "unbounded_or_invalid_grant" });
  }
  await pool.query("UPDATE allowance_accounts SET limit_micro=$2 WHERE account_id=$1", [
    memberAccountId,
    amountMicro,
  ]);
  const row = (
    await pool.query<{ limit_micro: string }>(
      "SELECT limit_micro FROM allowance_accounts WHERE account_id=$1",
      [memberAccountId],
    )
  ).rows[0]!;
  expect(Number(row.limit_micro)).toBe(amountMicro);
}

async function grantMemberConsent(memberHeaders: { authorization: string }) {
  const consent = await app.inject({
    method: "POST",
    url: "/v1/consent",
    headers: memberHeaders,
    payload: { grant: true },
  });
  expect(consent.statusCode).toBe(200);
  expect(consent.json()).toMatchObject({ granted: true });
}

async function readAllowance(memberAccountId: string) {
  const row = (
    await pool.query<{ limit_micro: string; settled_micro: string; reserved_micro: string }>(
      "SELECT limit_micro,settled_micro,reserved_micro FROM allowance_accounts WHERE account_id=$1",
      [memberAccountId],
    )
  ).rows[0]!;
  return {
    limit: Number(row.limit_micro),
    settled: Number(row.settled_micro),
    reserved: Number(row.reserved_micro),
  };
}

async function readSponsorLedger() {
  const row = (
    await pool.query<{ settled_micro: string; reserved_micro: string; held_micro: string }>(
      "SELECT settled_micro,reserved_micro,held_micro FROM guest_sponsor_ledgers WHERE policy_id='norrow-guest-first.v1'",
    )
  ).rows[0]!;
  return {
    settled: Number(row.settled_micro),
    reserved: Number(row.reserved_micro),
    held: Number(row.held_micro),
  };
}

async function memberRunCount(memberAccountId: string) {
  return (
    await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM runs WHERE account_id=$1", [
      memberAccountId,
    ])
  ).rows[0]!.n;
}

async function memberReservationCount(memberAccountId: string) {
  return (
    await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM reservations WHERE account_id=$1",
      [memberAccountId],
    )
  ).rows[0]!.n;
}

/** Guest bootstrap → guest consent → fixture first run → follow_up pending → auth attempt → member claim. */
async function driveGuestToClaimed() {
  const guest = await enabledGuest();
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/consent",
        headers: guest.headers,
        payload: { grant: true },
      })
    ).statusCode,
  ).toBe(200);
  const first = await app.inject({
    method: "POST",
    url: "/v1/runs",
    headers: { ...guest.headers, "idempotency-key": randomUUID() },
    payload: {
      question: "Which laptop runs local AI well under two thousand dollars?",
      routeMode: "fixture",
      conversationId: guest.conversationId,
      consentPolicyVersion: CONSENT_POLICY_VERSION,
    },
  });
  expect(first.statusCode).toBe(200);
  const guestRunId = first.json().runId as string;
  const action = { kind: "follow_up" as const, text: "What about battery life?", parentRunId: guestRunId };
  const submissionId = randomUUID();
  const authAttemptId = randomUUID();
  const payloadDigest = createHash("sha256").update(canonicalGuestPendingPayload(action)).digest("hex");
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/guest/pending-actions",
        headers: guest.headers,
        payload: {
          submissionId,
          guestContextId: guest.guestContextId,
          conversationId: guest.conversationId,
          conversationVersion: 1,
          payload: action,
          payloadDigest,
          consentPolicyVersion: CONSENT_POLICY_VERSION,
        },
      })
    ).statusCode,
  ).toBe(202);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/guest/pending-actions/attempts/begin",
        headers: guest.headers,
        payload: { submissionId, authAttemptId, provider: "email_code" },
      })
    ).statusCode,
  ).toBe(200);
  const member = await newZeroedMember();
  const claimRequestId = randomUUID();
  const claim = await app.inject({
    method: "POST",
    url: "/v1/guest/claim",
    headers: { ...member.headers, ...guest.headers },
    payload: {
      claimRequestId,
      submissionId,
      guestContextId: guest.guestContextId,
      conversationId: guest.conversationId,
      conversationVersion: 1,
      authAttemptId,
    },
  });
  expect(claim.statusCode).toBe(200);
  expect(claim.json()).toMatchObject({ type: "claim_accepted", accountId: member.accountId });
  const controlVersion = claim.json().controlVersion as number;
  const resumePayload = { submissionId, claimRequestId, controlVersion, payloadDigest };
  return { guest, member, submissionId, claimRequestId, controlVersion, payloadDigest, guestRunId, resumePayload };
}

describe("AUD04 new-member entitlement: zero default, explicit bounded grant, member consent", () => {
  it("E-ZERO-01 zero-state deny: no grant, no consent fails closed", async () => {
    const ctx = await driveGuestToClaimed();
    const denied = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("consent_required");
    expect(await readAllowance(ctx.member.accountId)).toEqual({ limit: 0, settled: 0, reserved: 0 });
    expect(await memberRunCount(ctx.member.accountId)).toBe(0);
    expect(await memberReservationCount(ctx.member.accountId)).toBe(0);
    expect(
      (await pool.query("SELECT state FROM guest_pending_actions WHERE submission_id=$1", [ctx.submissionId]))
        .rows[0]!.state,
    ).toBe("claimed");
  });

  it("E-ZERO-02 zero-state budget deny with consent but no grant", async () => {
    const ctx = await driveGuestToClaimed();
    await grantMemberConsent(ctx.member.headers);
    const denied = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(denied.statusCode).toBe(402);
    expect(denied.json().code).toBe("allowance_exhausted");
    expect(await memberRunCount(ctx.member.accountId)).toBe(0);
    expect(await memberReservationCount(ctx.member.accountId)).toBe(0);
    const resolve = await app.inject({
      method: "POST",
      url: "/v1/guest/claims/resolve",
      headers: ctx.member.headers,
      payload: { claimRequestId: ctx.claimRequestId, submissionId: ctx.submissionId },
    });
    expect(resolve.json()).toMatchObject({ type: "claim_accepted", budgetAllowed: false });
  });

  it("E-GRANT-03 explicit bounded grant plus member consent allows the second action exactly once", async () => {
    const ctx = await driveGuestToClaimed();
    await boundedGrant(ctx.member.accountId, DEFAULT_RUN_BUDGET_MICRO);
    await grantMemberConsent(ctx.member.headers);
    const resumed = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(resumed.statusCode).toBe(200);
    const receipt = resumed.json() as {
      runId: string;
      memberConversationId: string;
      receiptId: string;
      reused: boolean;
    };
    expect(resumed.json()).toMatchObject({ type: "continuation_dispatched", reused: false });
    expect(receipt.runId).toBeTruthy();
    expect(receipt.memberConversationId).toBeTruthy();
    expect(await readAllowance(ctx.member.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO,
      settled: 0,
      reserved: DEFAULT_RUN_BUDGET_MICRO,
    });
    const memberRun = (
      await pool.query<{
        account_id: string;
        claimed_parent_run_id: string | null;
        guest_pending_action_id: string | null;
      }>("SELECT account_id,claimed_parent_run_id,guest_pending_action_id FROM runs WHERE id=$1", [
        receipt.runId,
      ])
    ).rows[0]!;
    expect(memberRun).toMatchObject({
      account_id: ctx.member.accountId,
      claimed_parent_run_id: ctx.guestRunId,
      guest_pending_action_id: ctx.submissionId,
    });
    expect(
      (await pool.query("SELECT account_id FROM runs WHERE id=$1", [ctx.guestRunId])).rows[0]!
        .account_id,
    ).not.toBe(ctx.member.accountId);
    expect(await readSponsorLedger()).toEqual({ settled: 0, reserved: DEFAULT_RUN_BUDGET_MICRO, held: 0 });
    expect(
      (
        await pool.query("SELECT count(*)::int AS n FROM guest_sponsor_reservations WHERE run_id=$1", [
          receipt.runId,
        ])
      ).rows[0]!.n,
    ).toBe(0);
  });

  it("E-REPLAY-04 idempotent replay reuses the dispatch without double spend", async () => {
    const ctx = await driveGuestToClaimed();
    await boundedGrant(ctx.member.accountId, DEFAULT_RUN_BUDGET_MICRO);
    await grantMemberConsent(ctx.member.headers);
    const first = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(first.statusCode).toBe(200);
    const before = await readAllowance(ctx.member.accountId);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      type: "continuation_dispatched",
      reused: true,
      runId: first.json().runId,
      receiptId: first.json().receiptId,
    });
    expect(await memberRunCount(ctx.member.accountId)).toBe(1);
    expect(await readAllowance(ctx.member.accountId)).toEqual(before);
  });

  it("E-EXHAUST-05 bounded grant covers exactly one action: a distinct second send is denied", async () => {
    const ctx = await driveGuestToClaimed();
    await boundedGrant(ctx.member.accountId, DEFAULT_RUN_BUDGET_MICRO);
    await grantMemberConsent(ctx.member.headers);
    const resumed = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(resumed.statusCode).toBe(200);
    const memberConversationId = resumed.json().memberConversationId as string;
    const second = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { ...ctx.member.headers, "idempotency-key": randomUUID() },
      payload: {
        question: "A distinct second research question",
        routeMode: "fixture",
        conversationId: memberConversationId,
        consentPolicyVersion: CONSENT_POLICY_VERSION,
      },
    });
    expect(second.statusCode).toBe(402);
    expect(second.json().code).toBe("allowance_exhausted");
    expect(await memberRunCount(ctx.member.accountId)).toBe(1);
    expect((await readAllowance(ctx.member.accountId)).limit).toBe(DEFAULT_RUN_BUDGET_MICRO);
  });

  it("E-CONSENT-06 grant without member consent denies", async () => {
    const ctx = await driveGuestToClaimed();
    await boundedGrant(ctx.member.accountId, DEFAULT_RUN_BUDGET_MICRO);
    const denied = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("consent_required");
    expect(await memberRunCount(ctx.member.accountId)).toBe(0);
    expect(await memberReservationCount(ctx.member.accountId)).toBe(0);
  });

  it("E-CONSENT-07 guest consent never transfers to the member", async () => {
    const ctx = await driveGuestToClaimed();
    await boundedGrant(ctx.member.accountId, DEFAULT_RUN_BUDGET_MICRO);
    const denied = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("consent_required");
    const resolve = await app.inject({
      method: "POST",
      url: "/v1/guest/claims/resolve",
      headers: ctx.member.headers,
      payload: { claimRequestId: ctx.claimRequestId, submissionId: ctx.submissionId },
    });
    expect(resolve.json()).toMatchObject({ type: "claim_accepted", consentPolicyVersion: null });
  });

  it("E-CONSENT-08 revoked member consent denies; re-grant re-allows with a new epoch", async () => {
    const ctx = await driveGuestToClaimed();
    await boundedGrant(ctx.member.accountId, DEFAULT_RUN_BUDGET_MICRO);
    await grantMemberConsent(ctx.member.headers);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/consent",
          headers: ctx.member.headers,
          payload: { grant: false },
        })
      ).statusCode,
    ).toBe(200);
    const denied = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("consent_required");
    expect(await memberRunCount(ctx.member.accountId)).toBe(0);
    await grantMemberConsent(ctx.member.headers);
    const resumed = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({ type: "continuation_dispatched", reused: false });
  });

  it("E-BUDGET-09 grant below one run denies at the exact boundary", async () => {
    const ctx = await driveGuestToClaimed();
    await boundedGrant(ctx.member.accountId, DEFAULT_RUN_BUDGET_MICRO - 1);
    await grantMemberConsent(ctx.member.headers);
    const denied = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(denied.statusCode).toBe(402);
    expect(denied.json().code).toBe("allowance_exhausted");
    expect(await memberRunCount(ctx.member.accountId)).toBe(0);
  });

  it("E-BUDGET-10 grant is bounded, never unlimited: two runs fit, the third is denied", async () => {
    await expect(boundedGrant(randomUUID(), 0)).rejects.toMatchObject({
      code: "unbounded_or_invalid_grant",
    });
    await expect(boundedGrant(randomUUID(), -1)).rejects.toMatchObject({
      code: "unbounded_or_invalid_grant",
    });
    await expect(boundedGrant(randomUUID(), 1_000_001)).rejects.toMatchObject({
      code: "unbounded_or_invalid_grant",
    });
    const ctx = await driveGuestToClaimed();
    await boundedGrant(ctx.member.accountId, 2 * DEFAULT_RUN_BUDGET_MICRO);
    await grantMemberConsent(ctx.member.headers);
    const resumed = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(resumed.statusCode).toBe(200);
    const memberConversationId = resumed.json().memberConversationId as string;
    const second = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { ...ctx.member.headers, "idempotency-key": randomUUID() },
      payload: {
        question: "A second funded research question",
        routeMode: "fixture",
        conversationId: memberConversationId,
        consentPolicyVersion: CONSENT_POLICY_VERSION,
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().runId).not.toBe(resumed.json().runId);
    const third = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { ...ctx.member.headers, "idempotency-key": randomUUID() },
      payload: {
        question: "A third unfunded research question",
        routeMode: "fixture",
        conversationId: memberConversationId,
        consentPolicyVersion: CONSENT_POLICY_VERSION,
      },
    });
    expect(third.statusCode).toBe(402);
    expect(third.json().code).toBe("allowance_exhausted");
    const final = await readAllowance(ctx.member.accountId);
    expect(final.limit).toBe(2 * DEFAULT_RUN_BUDGET_MICRO);
    expect(final.settled + final.reserved).toBeLessThanOrEqual(2 * DEFAULT_RUN_BUDGET_MICRO);
    expect(await memberRunCount(ctx.member.accountId)).toBe(2);
  });

  it("E-OWNER-11 grant, consent, claim, and resume never rewrite payer or owner identity", async () => {
    const ctx = await driveGuestToClaimed();
    const guestOwner = (
      await pool.query("SELECT account_id FROM runs WHERE id=$1", [ctx.guestRunId])
    ).rows[0]!.account_id as string;
    const accountsBefore = (
      await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts")
    ).rows[0]!.n;
    const identitiesBefore = (
      await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM external_identities")
    ).rows[0]!.n;
    await boundedGrant(ctx.member.accountId, DEFAULT_RUN_BUDGET_MICRO);
    await grantMemberConsent(ctx.member.headers);
    const resumed = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(resumed.statusCode).toBe(200);
    expect((await pool.query("SELECT account_id FROM runs WHERE id=$1", [ctx.guestRunId])).rows[0]!)
      .toMatchObject({ account_id: guestOwner });
    expect(
      (await pool.query("SELECT account_id FROM runs WHERE id=$1", [resumed.json().runId])).rows[0]!,
    ).toMatchObject({ account_id: ctx.member.accountId });
    expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts")).rows[0]!.n).toBe(
      accountsBefore,
    );
    expect(
      (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM external_identities")).rows[0]!.n,
    ).toBe(identitiesBefore);
    const binding = (
      await pool.query<{
        member_account_id: string;
        control_version: string;
        revoked_at: Date | null;
        id: string;
      }>(
        "SELECT id,member_account_id,control_version,revoked_at FROM conversation_control_bindings WHERE guest_context_id=$1 AND member_account_id=$2",
        [ctx.guest.guestContextId, ctx.member.accountId],
      )
    ).rows[0]!;
    expect(binding.member_account_id).toBe(ctx.member.accountId);
    expect(Number(binding.control_version)).toBe(ctx.controlVersion);
    expect(binding.revoked_at).toBeNull();
    expect(
      (
        await pool.query("SELECT binding_id FROM guest_claim_requests WHERE request_id=$1", [
          ctx.claimRequestId,
        ])
      ).rows[0]!.binding_id,
    ).toBe(binding.id);
  });

  it("E-HOLD-12 member grant never touches sponsor money; live spend stays operator-blocked", async () => {
    const ctx = await driveGuestToClaimed();
    const sponsorBefore = await readSponsorLedger();
    expect(sponsorBefore).toEqual({ settled: 0, reserved: DEFAULT_RUN_BUDGET_MICRO, held: 0 });
    await boundedGrant(ctx.member.accountId, DEFAULT_RUN_BUDGET_MICRO);
    await grantMemberConsent(ctx.member.headers);
    const resumed = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(resumed.statusCode).toBe(200);
    expect(await readSponsorLedger()).toEqual(sponsorBefore);
    expect(
      (
        await pool.query("SELECT count(*)::int AS n FROM guest_sponsor_reservations WHERE run_id=$1", [
          resumed.json().runId,
        ])
      ).rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await pool.query("SELECT state FROM guest_sponsor_reservations WHERE run_id=$1", [ctx.guestRunId])
      ).rows[0]!.state,
    ).toBe("reserved");
    // Operator-blocked stub: controlled-research needs an operator authorization
    // packet (key, caps, kill-switch owner). This lane attempts no live call.
    const live = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { ...ctx.member.headers, "idempotency-key": randomUUID() },
      payload: {
        question: "A live research question without an operator packet",
        routeMode: "controlled-research",
        consentPolicyVersion: CONSENT_POLICY_VERSION,
      },
    });
    expect(live.statusCode).toBe(403);
    expect(live.json().code).toBe("permission_denied");
    expect(
      (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM provider_intents")).rows[0]!.n,
    ).toBe(0);
  });

  it("E-PROOF-13 guest proof is dead after claim; resume is member-only", async () => {
    const ctx = await driveGuestToClaimed();
    await boundedGrant(ctx.member.accountId, DEFAULT_RUN_BUDGET_MICRO);
    await grantMemberConsent(ctx.member.headers);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/guest/actions/resume",
          headers: ctx.member.headers,
          payload: ctx.resumePayload,
        })
      ).statusCode,
    ).toBe(200);
    const deadProof = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { ...ctx.guest.headers, "idempotency-key": randomUUID() },
      payload: {
        question: "Reuse of a destroyed guest proof",
        routeMode: "fixture",
        conversationId: ctx.guest.conversationId,
        consentPolicyVersion: CONSENT_POLICY_VERSION,
      },
    });
    expect(deadProof.statusCode).toBe(401);
    const guestResume = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.guest.headers,
      payload: ctx.resumePayload,
    });
    expect(guestResume.statusCode).toBe(403);
    expect(guestResume.json().code).toBe("authority_denied");
  });

  it("E-CONC-14 sponsor ledger stays bounded under concurrent first admissions", async () => {
    await pool.query(`UPDATE guest_sponsor_policies SET enabled=true,killed=false,
      expires_at=now()+interval '1 day',exposure_cap_micro=300000,per_guest_cap_micro=100000,
      bootstrap_limit_per_risk=100 WHERE id='norrow-guest-first.v1'`);
    const guests: Awaited<ReturnType<typeof enabledGuest>>[] = [];
    for (let i = 0; i < 6; i++) {
      const guest = await enabledGuest();
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/consent",
            headers: guest.headers,
            payload: { grant: true },
          })
        ).statusCode,
      ).toBe(200);
      guests.push(guest);
    }
    const results = await Promise.all(
      guests.map((guest, index) =>
        app.inject({
          method: "POST",
          url: "/v1/runs",
          headers: { ...guest.headers, "idempotency-key": randomUUID() },
          payload: {
            question: `Concurrent guest research question number ${index}`,
            routeMode: "fixture",
            conversationId: guest.conversationId,
            consentPolicyVersion: CONSENT_POLICY_VERSION,
          },
        }),
      ),
    );
    const ok = results.filter((r) => r.statusCode === 200);
    const denied = results.filter(
      (r) => r.statusCode === 402 && r.json().code === "allowance_exhausted",
    );
    expect(ok).toHaveLength(3);
    expect(denied).toHaveLength(3);
    const ledger = await readSponsorLedger();
    expect(ledger.settled + ledger.reserved + ledger.held).toBe(300000);
    expect(ledger).toEqual({ settled: 0, reserved: 300000, held: 0 });
    expect(
      (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM guest_sponsor_reservations"))
        .rows[0]!.n,
    ).toBe(3);
    expect(
      (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM runs")).rows[0]!.n,
    ).toBe(3);
  });
});

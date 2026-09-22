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
import { accountForIdentity } from "../src/modules/identity.js";
import { hashToken } from "../src/modules/access.js";

/**
 * AUD04 held-out regression: new-member entitlement (F02 server grant path).
 *
 * A real newly-mapped member starts with ZERO spendable budget (identity.ts:
 * "Authentication is not a grant of paid allowance"). The intended second action
 * — the claimed-continuation resume (POST /v1/guest/actions/resume) — works
 * exactly once only after BOTH explicit member-scoped prerequisites hold:
 *   1. an explicit authorized BOUNDED grant via POST
 *      /v1/entitlements/new-member-grant { grantRequestId, amountMicro }
 *      (idempotent grant identity, per-grant bound, 1_000_000 aggregate cap), and
 *   2. a member-specific consent grant (POST /v1/consent/member {grant:true} as
 *      that member on the current CONSENT_POLICY_VERSION).
 *
 * Member sessions below are minted via POST /v1/dev/session ONLY as identity
 * stand-ins; every case immediately zeroes the dev fixture allowance
 * (10_000_000) to the production-equivalent zero-state before the case begins,
 * and the bounded grant is applied explicitly per case through the server route.
 * No unlimited credit is ever minted, guest consent never transfers, HOLD is
 * never bypassed, and no payer/owner identity is ever rewritten. Live-spend
 * variants are stubbed as operator-blocked (E-HOLD-12 tail); no live provider
 * call is attempted.
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
  await pool.query(`UPDATE new_member_trial_policies SET enabled=true,killed=false,
    expires_at=now()+interval '1 day',amount_micro=${DEFAULT_RUN_BUDGET_MICRO},exposure_cap_micro=1000000
    WHERE id='norrow-new-member-trial.v1'`);
  await pool.query(
    "UPDATE new_member_trial_ledgers SET settled_micro=0,reserved_micro=0,held_micro=0 WHERE policy_id='norrow-new-member-trial.v1'",
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
 * A genuinely newly-mapped identity: the real server mapping path
 * (`accountForIdentity`) creates the account and gives it ZERO allowance
 * ("Authentication is not a grant of paid allowance"). A dev bearer is then
 * attached only as the isolated-test authentication stand-in, so no fixture
 * allowance is ever minted for this account. This is the true fresh-member
 * zero-state the R02 journey must handle.
 */
async function newlyMappedZeroAllowanceMember() {
  const mapped = await accountForIdentity(pool, { issuer: "https://issuer.test/auth/v1", subject: randomUUID() });
  expect(mapped).not.toBeNull();
  const accountId = mapped!.accountId;
  const row = (
    await pool.query<{ limit_micro: string; settled_micro: string; reserved_micro: string }>(
      "SELECT limit_micro,settled_micro,reserved_micro FROM allowance_accounts WHERE account_id=$1",
      [accountId],
    )
  ).rows[0]!;
  expect(row).toMatchObject({ limit_micro: "0", settled_micro: "0", reserved_micro: "0" });
  const token = `dev_${randomUUID().replace(/-/g, "")}`;
  await pool.query(
    "INSERT INTO sessions (account_id, token_hash, expires_at) VALUES ($1,$2,now()+interval '1 day')",
    [accountId, hashToken(token)],
  );
  return { accountId, token, headers: { authorization: `Bearer ${token}` } };
}

/**
 * F02 server grant path: POST /v1/entitlements/new-member-grant.
 * No test SQL grants allowance; every grant goes through the real server path
 * with an idempotent grantRequestId, per-grant bound, and aggregate cap.
 * Zeroing in newZeroedMember is setup only (dev fixture 10M -> production 0).
 */
async function boundedGrant(
  member: { accountId: string; headers: { authorization: string } },
  amountMicro: number,
  grantRequestId: string = randomUUID(),
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/entitlements/new-member-grant",
    headers: member.headers,
    payload: { grantRequestId, amountMicro },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ grantRequestId, accountId: member.accountId, amountMicro });
  const row = (
    await pool.query<{ limit_micro: string }>(
      "SELECT limit_micro FROM allowance_accounts WHERE account_id=$1",
      [member.accountId],
    )
  ).rows[0]!;
  expect(Number(row.limit_micro)).toBeGreaterThanOrEqual(amountMicro);
  return response.json() as { grantRequestId: string; accountId: string;
    amountMicro: number; limitMicro: number; reused: boolean };
}

async function grantMemberConsent(memberHeaders: { authorization: string }) {
  const consent = await app.inject({
    method: "POST",
    url: "/v1/consent/member",
    headers: memberHeaders,
    payload: { grant: true },
  });
  expect(consent.statusCode).toBe(200);
  expect(consent.json()).toMatchObject({ granted: true, policyVersion: CONSENT_POLICY_VERSION });
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

async function readTrialLedger() {
  const row = (
    await pool.query<{ settled_micro: string; reserved_micro: string; held_micro: string }>(
      "SELECT settled_micro,reserved_micro,held_micro FROM new_member_trial_ledgers WHERE policy_id='norrow-new-member-trial.v1'",
    )
  ).rows[0]!;
  return {
    settled: Number(row.settled_micro),
    reserved: Number(row.reserved_micro),
    held: Number(row.held_micro),
  };
}

async function trialEntitlementCount(memberAccountId: string) {
  return (
    await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM entitlements WHERE account_id=$1 AND source='new-member-trial.v1'",
      [memberAccountId],
    )
  ).rows[0]!.n;
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
async function driveGuestToClaimed(
  existingMember?: { accountId: string; headers: { authorization: string } },
) {
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
  const member = existingMember ?? await newZeroedMember();
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
    await boundedGrant(ctx.member, DEFAULT_RUN_BUDGET_MICRO);
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
    await boundedGrant(ctx.member, DEFAULT_RUN_BUDGET_MICRO);
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
    await boundedGrant(ctx.member, DEFAULT_RUN_BUDGET_MICRO);
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
    await boundedGrant(ctx.member, DEFAULT_RUN_BUDGET_MICRO);
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
    await boundedGrant(ctx.member, DEFAULT_RUN_BUDGET_MICRO);
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
    await boundedGrant(ctx.member, DEFAULT_RUN_BUDGET_MICRO);
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

  it("E-BUDGET-09 R03: a caller amount below the policy cannot reduce credit; the server amount funds the trial", async () => {
    const ctx = await driveGuestToClaimed();
    const belowPolicy = DEFAULT_RUN_BUDGET_MICRO - 1;
    const granted = await app.inject({
      method: "POST",
      url: "/v1/entitlements/new-member-grant",
      headers: ctx.member.headers,
      payload: { grantRequestId: randomUUID(), amountMicro: belowPolicy },
    });
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toMatchObject({
      accountId: ctx.member.accountId,
      amountMicro: DEFAULT_RUN_BUDGET_MICRO,
      limitMicro: DEFAULT_RUN_BUDGET_MICRO,
    });
    expect(await readAllowance(ctx.member.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0 });
    await grantMemberConsent(ctx.member.headers);
    const resumed = await app.inject({
      method: "POST",
      url: "/v1/guest/actions/resume",
      headers: ctx.member.headers,
      payload: ctx.resumePayload,
    });
    expect(resumed.statusCode).toBe(200);
    expect(await memberRunCount(ctx.member.accountId)).toBe(1);
  });

  it("E-BUDGET-10 R03: a caller amount above the policy cannot inflate credit; the trial funds exactly one run", async () => {
    const probe = await newZeroedMember();
    for (const badAmount of [0, -1, 1_000_001]) {
      const denied = await app.inject({
        method: "POST",
        url: "/v1/entitlements/new-member-grant",
        headers: probe.headers,
        payload: { grantRequestId: randomUUID(), amountMicro: badAmount },
      });
      expect(denied.statusCode).toBe(400);
      expect(denied.json().code).toBe("invalid_input");
    }
    expect(await readAllowance(probe.accountId)).toEqual({ limit: 0, settled: 0, reserved: 0 });
    const ctx = await driveGuestToClaimed();
    const inflated = await app.inject({
      method: "POST",
      url: "/v1/entitlements/new-member-grant",
      headers: ctx.member.headers,
      payload: { grantRequestId: randomUUID(), amountMicro: 1_000_000 },
    });
    expect(inflated.statusCode).toBe(200);
    expect(inflated.json()).toMatchObject({ amountMicro: DEFAULT_RUN_BUDGET_MICRO });
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
        question: "A second unfunded research question",
        routeMode: "fixture",
        conversationId: memberConversationId,
        consentPolicyVersion: CONSENT_POLICY_VERSION,
      },
    });
    expect(second.statusCode).toBe(402);
    expect(second.json().code).toBe("allowance_exhausted");
    // A second, distinct grant identity is also refused: once-only business entitlement.
    const secondGrant = await app.inject({
      method: "POST",
      url: "/v1/entitlements/new-member-grant",
      headers: ctx.member.headers,
      payload: { grantRequestId: randomUUID(), amountMicro: 2 * DEFAULT_RUN_BUDGET_MICRO },
    });
    expect(secondGrant.statusCode).toBe(403);
    expect(secondGrant.json().code).toBe("permission_denied");
    const final = await readAllowance(ctx.member.accountId);
    expect(final.limit).toBe(DEFAULT_RUN_BUDGET_MICRO);
    expect(final.settled + final.reserved).toBeLessThanOrEqual(DEFAULT_RUN_BUDGET_MICRO);
    expect(await memberRunCount(ctx.member.accountId)).toBe(1);
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
    await boundedGrant(ctx.member, DEFAULT_RUN_BUDGET_MICRO);
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
    await boundedGrant(ctx.member, DEFAULT_RUN_BUDGET_MICRO);
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
    await boundedGrant(ctx.member, DEFAULT_RUN_BUDGET_MICRO);
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

  it("E-IDEM-15 same grant identity replays without double spend; conflicting replay is 409", async () => {
    const member = await newZeroedMember();
    const grantRequestId = randomUUID();
    const first = await app.inject({
      method: "POST",
      url: "/v1/entitlements/new-member-grant",
      headers: member.headers,
      payload: { grantRequestId, amountMicro: DEFAULT_RUN_BUDGET_MICRO },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ reused: false, limitMicro: DEFAULT_RUN_BUDGET_MICRO });
    const replay = await app.inject({
      method: "POST",
      url: "/v1/entitlements/new-member-grant",
      headers: member.headers,
      payload: { grantRequestId, amountMicro: DEFAULT_RUN_BUDGET_MICRO },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ reused: true, limitMicro: DEFAULT_RUN_BUDGET_MICRO });
    expect(await readAllowance(member.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0 });
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/entitlements/new-member-grant",
      headers: member.headers,
      payload: { grantRequestId, amountMicro: DEFAULT_RUN_BUDGET_MICRO + 1 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(await readAllowance(member.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0 });
  });

  it("E-SWITCH-16 grant identity cannot switch accounts", async () => {
    const first = await newZeroedMember();
    const second = await newZeroedMember();
    const grantRequestId = randomUUID();
    expect((await app.inject({ method: "POST", url: "/v1/entitlements/new-member-grant",
      headers: first.headers, payload: { grantRequestId, amountMicro: DEFAULT_RUN_BUDGET_MICRO } })).statusCode)
      .toBe(200);
    const switched = await app.inject({ method: "POST", url: "/v1/entitlements/new-member-grant",
      headers: second.headers, payload: { grantRequestId, amountMicro: DEFAULT_RUN_BUDGET_MICRO } });
    expect(switched.statusCode).toBe(403);
    expect(switched.json().code).toBe("authority_denied");
    expect(await readAllowance(second.accountId)).toEqual({ limit: 0, settled: 0, reserved: 0 });
    expect(await readAllowance(first.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0 });
  });

  it("E-CAP-17 R03: bounded once-only trial and aggregate cap hold; any top-up is denied without mutation", async () => {
    const member = await newZeroedMember();
    const first = await app.inject({ method: "POST", url: "/v1/entitlements/new-member-grant",
      headers: member.headers, payload: { grantRequestId: randomUUID(), amountMicro: 1_000_000 } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ amountMicro: DEFAULT_RUN_BUDGET_MICRO,
      limitMicro: DEFAULT_RUN_BUDGET_MICRO });
    const over = await app.inject({ method: "POST", url: "/v1/entitlements/new-member-grant",
      headers: member.headers, payload: { grantRequestId: randomUUID(), amountMicro: 1 } });
    expect(over.statusCode).toBe(403);
    expect(over.json().code).toBe("permission_denied");
    expect(await readAllowance(member.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0 });
  });

  it("E-CONSENT-MEMBER-18 explicit member consent route grants member consent and unblocks resume", async () => {
    const ctx = await driveGuestToClaimed();
    await boundedGrant(ctx.member, DEFAULT_RUN_BUDGET_MICRO);
    // Member consent absent: resume fails closed even via the explicit route check.
    const before = await app.inject({ method: "POST", url: "/v1/guest/actions/resume",
      headers: ctx.member.headers, payload: ctx.resumePayload });
    expect(before.statusCode).toBe(403);
    expect(before.json().code).toBe("consent_required");
    // Explicit member route works with member auth only ...
    const granted = await app.inject({ method: "POST", url: "/v1/consent/member",
      headers: ctx.member.headers, payload: { grant: true } });
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toMatchObject({ granted: true, policyVersion: CONSENT_POLICY_VERSION });
    // ... and also when a stale guest proof header is present (guest proof ignored).
    const grantedAgain = await app.inject({ method: "POST", url: "/v1/consent/member",
      headers: { ...ctx.member.headers, ...ctx.guest.headers }, payload: { grant: true } });
    expect(grantedAgain.statusCode).toBe(200);
    expect(grantedAgain.json()).toMatchObject({ granted: true });
    const resumed = await app.inject({ method: "POST", url: "/v1/guest/actions/resume",
      headers: ctx.member.headers, payload: ctx.resumePayload });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({ type: "continuation_dispatched" });
    // Revoking via the explicit route re-locks resume without dispatching.
    expect((await app.inject({ method: "POST", url: "/v1/consent/member",
      headers: ctx.member.headers, payload: { grant: false } })).statusCode).toBe(200);
    const replayDenied = await app.inject({ method: "POST", url: "/v1/guest/actions/resume",
      headers: ctx.member.headers, payload: ctx.resumePayload });
    expect(replayDenied.json().code).toBe("consent_required");
  });

  it("E-CONSENT-OUTDATED-19 outdated member consent denies resume until re-granted", async () => {
    const ctx = await driveGuestToClaimed();
    await boundedGrant(ctx.member, DEFAULT_RUN_BUDGET_MICRO);
    await grantMemberConsent(ctx.member.headers);
    // Simulate a policy rotation by backdating the member consent row.
    await pool.query(
      "UPDATE consent_records SET policy_version='v0-outdated' WHERE account_id=$1",
      [ctx.member.accountId],
    );
    const denied = await app.inject({ method: "POST", url: "/v1/guest/actions/resume",
      headers: ctx.member.headers, payload: ctx.resumePayload });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("consent_required");
    expect(await memberRunCount(ctx.member.accountId)).toBe(0);
    expect(await memberReservationCount(ctx.member.accountId)).toBe(0);
    await grantMemberConsent(ctx.member.headers);
    const resumed = await app.inject({ method: "POST", url: "/v1/guest/actions/resume",
      headers: ctx.member.headers, payload: ctx.resumePayload });
    expect(resumed.statusCode).toBe(200);
  });

  it("E-POLICY-AMOUNT-20 R03: a caller-supplied amount never determines credit; the server policy amount is used", async () => {
    const low = await newZeroedMember();
    const high = await newZeroedMember();
    const lowCall = await app.inject({ method: "POST", url: "/v1/entitlements/new-member-grant",
      headers: low.headers, payload: { grantRequestId: randomUUID(), amountMicro: 1 } });
    expect(lowCall.statusCode).toBe(200);
    expect(lowCall.json()).toMatchObject({
      amountMicro: DEFAULT_RUN_BUDGET_MICRO, limitMicro: DEFAULT_RUN_BUDGET_MICRO });
    const highCall = await app.inject({ method: "POST", url: "/v1/entitlements/new-member-grant",
      headers: high.headers, payload: { grantRequestId: randomUUID(), amountMicro: 1_000_000 } });
    expect(highCall.statusCode).toBe(200);
    expect(highCall.json()).toMatchObject({
      amountMicro: DEFAULT_RUN_BUDGET_MICRO, limitMicro: DEFAULT_RUN_BUDGET_MICRO });
    expect(await readAllowance(low.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0 });
    expect(await readAllowance(high.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0 });
    // The funded sponsor exposure is the policy amount per trial, not the caller value.
    expect(await readTrialLedger()).toEqual({
      settled: 0, reserved: 2 * DEFAULT_RUN_BUDGET_MICRO, held: 0 });
  });

  it("E-ONCE-21 R03: two different request UUIDs for one business entitlement cannot earn two trials", async () => {
    const ctx = await driveGuestToClaimed();
    // The mobile business identity is the claimed continuation request id.
    const first = await app.inject({ method: "POST", url: "/v1/entitlements/new-member-grant",
      headers: ctx.member.headers, payload: { grantRequestId: ctx.claimRequestId, amountMicro: DEFAULT_RUN_BUDGET_MICRO } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ reused: false, limitMicro: DEFAULT_RUN_BUDGET_MICRO });
    const second = await app.inject({ method: "POST", url: "/v1/entitlements/new-member-grant",
      headers: ctx.member.headers, payload: { grantRequestId: randomUUID(), amountMicro: DEFAULT_RUN_BUDGET_MICRO } });
    expect(second.statusCode).toBe(403);
    expect(second.json().code).toBe("permission_denied");
    expect(await readAllowance(ctx.member.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0 });
    expect(await trialEntitlementCount(ctx.member.accountId)).toBe(1);
    expect((await readTrialLedger()).reserved).toBe(DEFAULT_RUN_BUDGET_MICRO);
    // The real business identity still replays idempotently with no second trial.
    const replay = await app.inject({ method: "POST", url: "/v1/entitlements/new-member-grant",
      headers: ctx.member.headers, payload: { grantRequestId: ctx.claimRequestId, amountMicro: DEFAULT_RUN_BUDGET_MICRO } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ reused: true, limitMicro: DEFAULT_RUN_BUDGET_MICRO });
    expect(await trialEntitlementCount(ctx.member.accountId)).toBe(1);
    // A different member cannot borrow another member's claim identity.
    const foreign = await newZeroedMember();
    const stolen = await app.inject({ method: "POST", url: "/v1/entitlements/new-member-grant",
      headers: foreign.headers, payload: { grantRequestId: ctx.claimRequestId, amountMicro: DEFAULT_RUN_BUDGET_MICRO } });
    expect(stolen.statusCode).toBe(403);
    expect(stolen.json().code).toBe("authority_denied");
    expect(await readAllowance(foreign.accountId)).toEqual({ limit: 0, settled: 0, reserved: 0 });
  });

  it("E-EXPOSURE-22 R03: concurrent first claims cannot exceed the approved global subsidy total", async () => {
    await pool.query(`UPDATE new_member_trial_policies SET exposure_cap_micro=300000
      WHERE id='norrow-new-member-trial.v1'`);
    const members = [];
    for (let i = 0; i < 6; i++) members.push(await newZeroedMember());
    const results = await Promise.all(members.map((member, index) => app.inject({
      method: "POST",
      url: "/v1/entitlements/new-member-grant",
      headers: member.headers,
      payload: { grantRequestId: randomUUID(), amountMicro: DEFAULT_RUN_BUDGET_MICRO + index },
    })));
    const ok = results.filter((r) => r.statusCode === 200);
    const denied = results.filter(
      (r) => r.statusCode === 402 && r.json().code === "allowance_exhausted",
    );
    expect(ok).toHaveLength(3);
    expect(denied).toHaveLength(3);
    expect(await readTrialLedger()).toEqual({ settled: 0, reserved: 300000, held: 0 });
    let credited = 0;
    for (const member of members) credited += (await readAllowance(member.accountId)).limit;
    expect(credited).toBe(300000);
  });

  it("E-POLICY-HOLD-23 R03: disabled, killed, expired policy and unknown receipts deny without credit and hold the reservation", async () => {
    const member = await newZeroedMember();
    const baseline = await readTrialLedger();
    const call = (grantRequestId: string) => app.inject({ method: "POST",
      url: "/v1/entitlements/new-member-grant", headers: member.headers,
      payload: { grantRequestId, amountMicro: DEFAULT_RUN_BUDGET_MICRO } });
    for (const state of ["enabled=false,killed=false", "enabled=true,killed=true",
      "enabled=true,killed=false,expires_at=now()-interval '1 hour'"]) {
      await pool.query(`UPDATE new_member_trial_policies SET ${state}
        WHERE id='norrow-new-member-trial.v1'`);
      const denied = await call(randomUUID());
      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe("permission_denied");
    }
    expect(await readAllowance(member.accountId)).toEqual({ limit: 0, settled: 0, reserved: 0 });
    expect(await readTrialLedger()).toEqual(baseline);
    await pool.query(`UPDATE new_member_trial_policies SET enabled=true,killed=false,
      expires_at=now()+interval '1 day' WHERE id='norrow-new-member-trial.v1'`);
    expect((await call(randomUUID())).statusCode).toBe(200);
    const held = await readTrialLedger();
    expect(held.reserved).toBe(DEFAULT_RUN_BUDGET_MICRO);
    // Unknown receipt: the identity exists under an unrecognized source. Held, never re-credited.
    const unknownId = randomUUID();
    await pool.query(`INSERT INTO entitlements(id,account_id,product,source,amount_micro)
      VALUES($1,$2,'operator-unknown.v1','operator-unknown.v1',123)`, [unknownId, member.accountId]);
    const unknown = await call(unknownId);
    expect(unknown.statusCode).toBe(409);
    expect(await readAllowance(member.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0 });
    expect(await readTrialLedger()).toEqual(held);
    // Deleted identity: no new credit, reservation preserved.
    await pool.query(`UPDATE accounts SET deleted_at=now(), deletion_epoch=deletion_epoch+1 WHERE id=$1`,
      [member.accountId]);
    const dead = await call(randomUUID());
    expect(dead.statusCode).toBe(401);
    expect(await readAllowance(member.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0 });
    expect(await readTrialLedger()).toEqual(held);
  });

  it("E-GUEST-UNTOUCHED-24 R03: the member trial never writes guest payer ledgers or reservations", async () => {
    expect(await readSponsorLedger()).toEqual({ settled: 0, reserved: 0, held: 0 });
    const member = await newZeroedMember();
    expect((await app.inject({ method: "POST", url: "/v1/entitlements/new-member-grant",
      headers: member.headers, payload: { grantRequestId: randomUUID(), amountMicro: DEFAULT_RUN_BUDGET_MICRO } }))
      .statusCode).toBe(200);
    expect(await readSponsorLedger()).toEqual({ settled: 0, reserved: 0, held: 0 });
    expect((await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM guest_sponsor_reservations")).rows[0]!.n).toBe(0);
    // A guest first turn still uses only the guest sponsor ledger.
    const guest = await enabledGuest();
    expect((await app.inject({ method: "POST", url: "/v1/consent", headers: guest.headers,
      payload: { grant: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/runs",
      headers: { ...guest.headers, "idempotency-key": randomUUID() },
      payload: { question: "Guest research after a member trial", routeMode: "fixture",
        conversationId: guest.conversationId, consentPolicyVersion: CONSENT_POLICY_VERSION } })).statusCode).toBe(200);
    expect(await readSponsorLedger()).toEqual({
      settled: 0, reserved: DEFAULT_RUN_BUDGET_MICRO, held: 0 });
  });
});

/**
 * R02: the connected fresh-member allowance journey. A genuinely
 * newly-mapped, zero-allowance identity takes a guest first message, holds a
 * second Send, signs in, grants member consent, and receives the server-owned
 * bounded trial; the exact second action then continues once and the member
 * conversation accepts a third message. Exhaustion, replay, account-switch,
 * cancel, and lost grant/continuation responses are covered as separate
 * failure states. Every grant goes through the real server path.
 */
describe("R02 fresh-member allowance journey via the server-owned new-member trial", () => {
  const resume = (member: { headers: { authorization: string } }, ctx: Awaited<ReturnType<typeof driveGuestToClaimed>>) =>
    app.inject({ method: "POST", url: "/v1/guest/actions/resume", headers: member.headers, payload: ctx.resumePayload });
  const createMemberRun = (member: { headers: { authorization: string } }, conversationId: string, question: string) =>
    app.inject({
      method: "POST", url: "/v1/runs",
      headers: { ...member.headers, "idempotency-key": randomUUID() },
      payload: { question, routeMode: "fixture", conversationId, consentPolicyVersion: CONSENT_POLICY_VERSION },
    });
  const grant = (member: { headers: { authorization: string } }, grantRequestId: string) =>
    app.inject({
      method: "POST", url: "/v1/entitlements/new-member-grant", headers: member.headers,
      payload: { grantRequestId, amountMicro: DEFAULT_RUN_BUDGET_MICRO },
    });

  it("E-FRESH-01 zero-allowance mapped member: consent + server trial continues the exact second action once, then a third message works", async () => {
    await pool.query(`UPDATE new_member_trial_policies SET enabled=true,killed=false,
      expires_at=now()+interval '2 days',amount_micro=${2 * DEFAULT_RUN_BUDGET_MICRO},exposure_cap_micro=500000
      WHERE id='norrow-new-member-trial.v1'`);
    const member = await newlyMappedZeroAllowanceMember();
    const ctx = await driveGuestToClaimed(member);
    // Fresh zero state: no member consent yet -> fail closed, no run.
    const preConsent = await resume(member, ctx);
    expect(preConsent.statusCode).toBe(403);
    expect(preConsent.json().code).toBe("consent_required");
    expect(await memberRunCount(member.accountId)).toBe(0);
    // Member consent granted, but the funding prerequisite is still missing:
    // definitive 402, no run/reservation, exact claim retained.
    await grantMemberConsent(member.headers);
    const preGrant = await resume(member, ctx);
    expect(preGrant.statusCode).toBe(402);
    expect(preGrant.json().code).toBe("allowance_exhausted");
    expect(await memberRunCount(member.accountId)).toBe(0);
    expect(await memberReservationCount(member.accountId)).toBe(0);
    expect(
      (await pool.query("SELECT state FROM guest_pending_actions WHERE submission_id=$1", [ctx.submissionId]))
        .rows[0]!.state,
    ).toBe("claimed");
    // Eligible server trial: the credited amount is the policy row's, not the
    // caller's requested amount.
    const granted = await grant(member, ctx.claimRequestId);
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toMatchObject({
      grantRequestId: ctx.claimRequestId, accountId: member.accountId,
      amountMicro: 2 * DEFAULT_RUN_BUDGET_MICRO, reused: false,
    });
    expect(await readAllowance(member.accountId)).toEqual({
      limit: 2 * DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0,
    });
    // The exact second action continues once; a replay resolves the same dispatch.
    const resumed = await resume(member, ctx);
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({ type: "continuation_dispatched", reused: false });
    const child = resumed.json() as { runId: string; memberConversationId: string };
    const replay = await resume(member, ctx);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      type: "continuation_dispatched", reused: true, runId: child.runId, receiptId: resumed.json().receiptId,
    });
    expect(await memberRunCount(member.accountId)).toBe(1);
    // The continued member conversation accepts a distinct third message.
    const third = await createMemberRun(member, child.memberConversationId, "How does the warranty compare?");
    expect(third.statusCode).toBe(200);
    expect(await memberRunCount(member.accountId)).toBe(2);
    const binding = (
      await pool.query<{ claim_request_id: string }>(
        "SELECT claim_request_id FROM guest_pending_actions WHERE submission_id=$1",
        [ctx.submissionId],
      )
    ).rows[0]!;
    expect(binding.claim_request_id).toBe(ctx.claimRequestId);
  });

  it("E-FRESH-02 exhaustion: the bounded trial funds exactly one action; a distinct third send is denied without mutation", async () => {
    const member = await newlyMappedZeroAllowanceMember();
    const ctx = await driveGuestToClaimed(member);
    await grantMemberConsent(member.headers);
    const granted = await grant(member, ctx.claimRequestId);
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toMatchObject({ amountMicro: DEFAULT_RUN_BUDGET_MICRO });
    const resumed = await resume(member, ctx);
    expect(resumed.statusCode).toBe(200);
    const memberConversationId = resumed.json().memberConversationId as string;
    const before = await readAllowance(member.accountId);
    const third = await createMemberRun(member, memberConversationId, "A distinct third question");
    expect(third.statusCode).toBe(402);
    expect(third.json().code).toBe("allowance_exhausted");
    expect(await readAllowance(member.accountId)).toEqual(before);
    expect(await memberRunCount(member.accountId)).toBe(1);
  });

  it("E-FRESH-03 lost grant response: replaying the same claim-keyed grant grants once", async () => {
    const member = await newlyMappedZeroAllowanceMember();
    const ctx = await driveGuestToClaimed(member);
    await grantMemberConsent(member.headers);
    const first = await grant(member, ctx.claimRequestId);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ reused: false });
    const lost = await grant(member, ctx.claimRequestId);
    expect(lost.statusCode).toBe(200);
    expect(lost.json()).toMatchObject({ reused: true, amountMicro: DEFAULT_RUN_BUDGET_MICRO });
    expect(await trialEntitlementCount(member.accountId)).toBe(1);
    expect(await readAllowance(member.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0,
    });
  });

  it("E-FRESH-04 lost continuation response: replay resolves the original dispatch, never a second run", async () => {
    const member = await newlyMappedZeroAllowanceMember();
    const ctx = await driveGuestToClaimed(member);
    await grantMemberConsent(member.headers);
    expect((await grant(member, ctx.claimRequestId)).statusCode).toBe(200);
    const first = await resume(member, ctx);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ reused: false });
    const replay = await resume(member, ctx);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      reused: true, runId: first.json().runId, receiptId: first.json().receiptId,
    });
    expect(await memberRunCount(member.accountId)).toBe(1);
  });

  it("E-FRESH-05 different account cannot resume or fund another member's claimed action", async () => {
    const member = await newlyMappedZeroAllowanceMember();
    const ctx = await driveGuestToClaimed(member);
    const foreign = await newlyMappedZeroAllowanceMember();
    const stolen = await resume(foreign, ctx);
    expect(stolen.statusCode).toBe(403);
    expect(stolen.json().code).toBe("authority_denied");
    await grantMemberConsent(foreign.headers);
    const stolenGrant = await app.inject({
      method: "POST", url: "/v1/entitlements/new-member-grant", headers: foreign.headers,
      payload: { grantRequestId: ctx.claimRequestId, amountMicro: DEFAULT_RUN_BUDGET_MICRO },
    });
    expect(stolenGrant.statusCode).toBe(403);
    expect(stolenGrant.json().code).toBe("authority_denied");
    // The foreign member's own independent trial still works.
    const own = await grant(foreign, randomUUID());
    expect(own.statusCode).toBe(200);
    expect(await readAllowance(foreign.accountId)).toEqual({
      limit: DEFAULT_RUN_BUDGET_MICRO, settled: 0, reserved: 0,
    });
    expect(await readAllowance(member.accountId)).toEqual({ limit: 0, settled: 0, reserved: 0 });
  });

  it("E-FRESH-06 cancel: an abandoned exact action cannot continue", async () => {
    const member = await newlyMappedZeroAllowanceMember();
    const ctx = await driveGuestToClaimed(member);
    const abandoned = await app.inject({
      method: "POST", url: "/v1/guest/actions/abandon", headers: member.headers,
      payload: { claimRequestId: ctx.claimRequestId, submissionId: ctx.submissionId },
    });
    expect(abandoned.statusCode).toBe(200);
    expect(abandoned.json()).toMatchObject({ type: "action_abandoned" });
    await grantMemberConsent(member.headers);
    expect((await grant(member, ctx.claimRequestId)).statusCode).toBe(200);
    const denied = await resume(member, ctx);
    expect(denied.statusCode).toBe(409);
    expect(await memberRunCount(member.accountId)).toBe(0);
  });
});

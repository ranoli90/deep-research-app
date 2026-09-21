import { createHash, createHmac, randomBytes } from "node:crypto";
import pg from "pg";
import {
  CONSENT_POLICY_VERSION, DEFAULT_RUN_BUDGET_MICRO,
  canonicalGuestPendingPayload,
  type CreateRunRequest, type GuestPendingPayload,
} from "@deep/contracts";
import { withTx, type Queryable } from "../platform/db.js";
import type { AppConfig } from "../platform/config.js";
import { currentConsent, revokeConsent } from "./access.js";
import { admitRun } from "./run-admission.js";
import { getBrief, getRun, insertConversation } from "./runs.js";
import { constraintFromClarificationAnswer } from "@deep/research-core";
import { admittedRunOptions, assertRouteAdmission } from "./run-route-admission.js";

const GUEST_LIFETIME_HOURS = 24;
const PENDING_LIFETIME_MINUTES = 30;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function fail(code: string, statusCode: number): never {
  throw Object.assign(new Error(code), { code, statusCode });
}
async function lockAccountsOrdered(db: pg.PoolClient, ids: string[]) {
  const rows = new Map<string, { deletion_epoch: string; deleted_at: Date | null }>();
  for (const id of [...new Set(ids)].sort()) {
    const row = (await db.query<{ deletion_epoch: string; deleted_at: Date | null }>(
      "SELECT deletion_epoch,deleted_at FROM accounts WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row || row.deleted_at) fail("authority_denied", 403);
    rows.set(id, row);
  }
  return rows;
}
function pepper(config: AppConfig): string {
  if (!config.guestProofPepper) fail("authority_denied", 403);
  return config.guestProofPepper;
}
function proofDigest(config: AppConfig, proof: string): string {
  return createHmac("sha256", pepper(config)).update(`guest-proof-v1:${proof}`).digest("hex");
}
function riskDigest(config: AppConfig, remoteAddress: string): string {
  return createHmac("sha256", pepper(config)).update(`guest-risk-v1:${remoteAddress}`).digest("hex");
}

export type GuestContext = {
  id: string; accountId: string; conversationId: string; status: string;
  acceptedTurnCount: number; controlVersion: number; expiresAt: Date; sponsorPolicyId: string;
};

/** An opaque 256-bit bearer proof is accepted only by the explicit guest route allowlist. */
export async function guestFromProof(db: Queryable, config: AppConfig, proof: unknown): Promise<GuestContext | null> {
  if (typeof proof !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof) || !config.guestProofPepper) return null;
  const row = await db.query<{
    id: string; execution_owner_account_id: string; conversation_id: string; status: string;
    accepted_turn_count: number; control_version: string; expires_at: Date; sponsor_policy_id: string;
  }>(`SELECT g.id,g.execution_owner_account_id,g.conversation_id,g.status,g.accepted_turn_count,
       g.control_version,g.expires_at,g.sponsor_policy_id
       FROM guest_contexts g JOIN accounts a ON a.id=g.execution_owner_account_id
       WHERE g.proof_digest=$1 AND a.deleted_at IS NULL`, [proofDigest(config, proof)]);
  const r = row.rows[0];
  if (!r || r.status !== "active" || r.expires_at <= new Date()) return null;
  return { id: r.id, accountId: r.execution_owner_account_id, conversationId: r.conversation_id,
    status: r.status, acceptedTurnCount: Number(r.accepted_turn_count), controlVersion: Number(r.control_version),
    expiresAt: r.expires_at, sponsorPolicyId: r.sponsor_policy_id };
}

/** Guest proof resolves only the one execution admitted for this exact conversation. */
export async function guestCanAccessRun(db: Queryable, guest: GuestContext, runId: string): Promise<boolean> {
  const allowed = await db.query(`SELECT 1 FROM guest_contexts g
    JOIN guest_first_request_receipts f ON f.guest_context_id=g.id
    JOIN runs r ON r.id=f.run_id
    JOIN accounts a ON a.id=g.execution_owner_account_id
    WHERE g.id=$1 AND f.run_id=$2 AND r.account_id=g.execution_owner_account_id
      AND r.conversation_id=g.conversation_id AND g.conversation_id=$3
      AND g.status='active' AND g.proof_digest IS NOT NULL AND g.expires_at>now()
      AND a.deleted_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.account_id=a.id
        AND t.object_kind='run' AND t.object_id=r.id AND t.reason='source_deletion')`,
      [guest.id, runId, guest.conversationId]);
  return Boolean(allowed.rowCount);
}

export type ClaimedConversationScope = { actorKind: "member"; actorAccountId: string;
  conversationId: string; parentExecutionOwnerId: string; controlBindingId: string; controlVersion: number };

/** Exact live member-to-guest-parent binding, never a generic account owner alias. */
export async function claimedConversationScope(db: Queryable, memberAccountId: string,
  parentRunId: string): Promise<ClaimedConversationScope | null> {
  const row = (await db.query<{ conversation_id: string; execution_owner_account_id: string;
    binding_id: string; control_version: string }>(`SELECT g.conversation_id,g.execution_owner_account_id,
      b.id AS binding_id,b.control_version
      FROM guest_first_request_receipts f
      JOIN guest_contexts g ON g.id=f.guest_context_id
      JOIN conversation_control_bindings b ON b.guest_context_id=g.id AND b.guest_conversation_id=g.conversation_id
      JOIN runs r ON r.id=f.run_id
      JOIN accounts m ON m.id=b.member_account_id
      JOIN accounts owner ON owner.id=g.execution_owner_account_id
      WHERE f.run_id=$1 AND b.member_account_id=$2 AND b.revoked_at IS NULL
        AND g.status='claimed' AND b.control_version=g.control_version
        AND b.member_deletion_epoch=m.deletion_epoch AND m.deleted_at IS NULL AND owner.deleted_at IS NULL
        AND r.account_id=g.execution_owner_account_id AND r.conversation_id=g.conversation_id
        AND NOT EXISTS(SELECT 1 FROM guest_control_tombstones t WHERE t.guest_context_id=g.id
          AND t.reason IN ('expired','guest_deleted','member_deletion','member_revoked','consent_revoked'))
        AND NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.account_id=owner.id
          AND t.object_kind='run' AND t.object_id=r.id AND t.reason='source_deletion')`,
    [parentRunId, memberAccountId])).rows[0];
  return row ? { actorKind: "member", actorAccountId: memberAccountId, conversationId: row.conversation_id,
    parentExecutionOwnerId: row.execution_owner_account_id, controlBindingId: row.binding_id,
    controlVersion: Number(row.control_version) } : null;
}

export async function listClaimedGuestParents(db: Queryable, memberAccountId: string) {
  const bindings = await db.query<{ run_id: string }>(`SELECT f.run_id FROM conversation_control_bindings b
    JOIN guest_contexts g ON g.id=b.guest_context_id
    JOIN guest_first_request_receipts f ON f.guest_context_id=g.id
    WHERE b.member_account_id=$1 AND b.revoked_at IS NULL AND g.status='claimed'`, [memberAccountId]);
  const items: { id: string; title: string; status: string; created_at: Date; report_id: string | null }[] = [];
  for (const binding of bindings.rows) {
    const scope = await claimedConversationScope(db, memberAccountId, binding.run_id);
    if (!scope) continue;
    const row = (await db.query<{ id: string; title: string; status: string; created_at: Date;
      report_id: string | null }>(`SELECT r.id,COALESCE(c.title,'Untitled') AS title,
        COALESCE(r.terminal_outcome,r.lifecycle) AS status,r.created_at,
        (SELECT rp.id FROM reports rp WHERE rp.run_id=r.id AND rp.account_id=r.account_id
          AND rp.redacted_at IS NULL ORDER BY rp.version DESC LIMIT 1) AS report_id
        FROM runs r JOIN conversations c ON c.id=r.conversation_id
        WHERE r.id=$1 AND r.account_id=$2 AND r.conversation_id=$3`,
      [binding.run_id, scope.parentExecutionOwnerId, scope.conversationId])).rows[0];
    if (row) items.push(row);
  }
  return items;
}

export async function revokeGuestConsent(pool: pg.Pool, guest: GuestContext) {
  return withTx(pool, async (db) => {
    await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [guest.accountId]);
    const context = (await db.query<{ status: string; control_version: string }>(
      "SELECT status,control_version FROM guest_contexts WHERE id=$1 FOR UPDATE", [guest.id])).rows[0];
    if (!context || context.status !== "active") fail("authority_denied", 403);
    const epoch = await revokeConsent(db, guest.accountId);
    const version = Number(context.control_version) + 1;
    await db.query("UPDATE guest_contexts SET control_version=$2 WHERE id=$1", [guest.id, version]);
    await db.query(`UPDATE guest_pending_actions SET state='rejected'
      WHERE guest_context_id=$1 AND state IN ('pending_auth','authenticating','dismissed','cancelled')`, [guest.id]);
    await db.query(`INSERT INTO guest_control_tombstones(guest_context_id,control_version,reason)
      VALUES ($1,$2,'consent_revoked')`, [guest.id, version]);
    return { epoch, controlVersion: version };
  });
}

export async function bootstrapGuest(pool: pg.Pool, config: AppConfig, remoteAddress: string) {
  if (!config.guestBootstrapEnabled) fail("authority_denied", 403);
  const proof = randomBytes(32).toString("base64url");
  return withTx(pool, async (db) => {
    const policy = (await db.query<{
      id: string; enabled: boolean; killed: boolean; expires_at: Date; exposure_cap_micro: string;
      per_guest_cap_micro: string; bootstrap_limit_per_risk: number;
    }>(`SELECT * FROM guest_sponsor_policies WHERE id=$1 FOR UPDATE`, [config.guestSponsorPolicyId])).rows[0];
    if (!policy || !policy.enabled || policy.killed || policy.expires_at <= new Date() ||
        Number(policy.exposure_cap_micro) < DEFAULT_RUN_BUDGET_MICRO ||
        Number(policy.per_guest_cap_micro) < DEFAULT_RUN_BUDGET_MICRO) fail("allowance_exhausted", 402);
    const risk = riskDigest(config, remoteAddress);
    const issued = (await db.query<{ issued: number }>(`INSERT INTO guest_bootstrap_limits(policy_id,risk_digest,day_utc,issued)
      VALUES ($1,$2,(now() AT TIME ZONE 'UTC')::date,1)
      ON CONFLICT (policy_id,risk_digest,day_utc)
      DO UPDATE SET issued=guest_bootstrap_limits.issued+1 RETURNING issued`, [policy.id, risk])).rows[0]?.issued;
    if (!issued || issued > policy.bootstrap_limit_per_risk) fail("authority_denied", 429);
    const accountId = crypto.randomUUID();
    await db.query("INSERT INTO accounts(id) VALUES ($1)", [accountId]);
    await db.query("INSERT INTO allowance_accounts(account_id,limit_micro) VALUES ($1,$2)",
      [accountId, Number(policy.per_guest_cap_micro)]);
    const conversationId = await insertConversation(db, accountId, "Research conversation");
    const id = crypto.randomUUID();
    const expiresAt = new Date(Math.min(Date.now() + GUEST_LIFETIME_HOURS * 3600_000, policy.expires_at.getTime()));
    await db.query(`INSERT INTO guest_contexts(id,execution_owner_account_id,conversation_id,proof_digest,sponsor_policy_id,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6)`, [id, accountId, conversationId, proofDigest(config, proof), policy.id, expiresAt]);
    return { guestContextId: id, conversationId, conversationVersion: 1, proof,
      expiresAt: expiresAt.toISOString(), consentPolicyVersion: CONSENT_POLICY_VERSION, firstTurnAvailable: true };
  });
}

export async function admitGuestFirst(pool: pg.Pool, config: AppConfig, guest: GuestContext,
  key: string, input: CreateRunRequest) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(key)) fail("invalid_input", 400);
  if (input.conversationId !== guest.conversationId || input.parentRunId || input.attachmentIds.length ||
      input.expectedBriefRevision !== undefined) fail("authority_denied", 403);
  const requestDigest = sha256(JSON.stringify({ ...input, attachmentIds: [] }));
  return withTx(pool, async (db) => {
    // Account -> context -> existing admission account/conversation/run/allowance locks.
    const account = (await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [guest.accountId])).rows[0];
    if (!account) fail("guest_deleted", 403);
    const context = (await db.query<{ status: string; accepted_turn_count: number; expires_at: Date; sponsor_policy_id: string }>(
      "SELECT status,accepted_turn_count,expires_at,sponsor_policy_id FROM guest_contexts WHERE id=$1 FOR UPDATE", [guest.id])).rows[0];
    if (!context || context.status !== "active" || context.expires_at <= new Date()) fail("guest_expired", 403);
    if (context.accepted_turn_count === 1) {
      const receipt = (await db.query<{ request_digest: string; run_id: string }>(
        "SELECT request_digest,run_id FROM guest_first_request_receipts WHERE guest_context_id=$1 AND request_id=$2",
        [guest.id, key])).rows[0];
      if (!receipt) fail("AUTH_REQUIRED_NEXT_TURN", 403);
      if (receipt.request_digest !== requestDigest) fail("idempotency_conflict", 409);
      const existing = await admitRun(db, guest.accountId, key, input);
      return { ...existing, firstTurnAvailable: false };
    }
    if (context.accepted_turn_count !== 0) fail("AUTH_REQUIRED_NEXT_TURN", 403);
    const consent = await currentConsent(db, guest.accountId);
    if (!consent || consent.revoked || consent.policyVersion !== CONSENT_POLICY_VERSION ||
        input.consentPolicyVersion !== CONSENT_POLICY_VERSION) fail("consent_required", 403);
    const created = await admitRun(db, guest.accountId, key, input, {
      strategy: config.structuredStrategy,
      modelPolicyId: config.structuredModelPolicyId,
      beforeReservation: async (tx) => {
        const policy = (await tx.query<{ enabled: boolean; killed: boolean; expires_at: Date; exposure_cap_micro: string; per_guest_cap_micro: string }>(
          "SELECT enabled,killed,expires_at,exposure_cap_micro,per_guest_cap_micro FROM guest_sponsor_policies WHERE id=$1 FOR UPDATE",
          [context.sponsor_policy_id])).rows[0];
        if (!policy || !policy.enabled || policy.killed || policy.expires_at <= new Date() ||
            Number(policy.per_guest_cap_micro) < DEFAULT_RUN_BUDGET_MICRO) fail("allowance_exhausted", 402);
        const ledger = (await tx.query<{ settled_micro: string; reserved_micro: string; held_micro: string }>(
          "SELECT settled_micro,reserved_micro,held_micro FROM guest_sponsor_ledgers WHERE policy_id=$1 FOR UPDATE",
          [context.sponsor_policy_id])).rows[0];
        if (!ledger || Number(ledger.settled_micro) + Number(ledger.reserved_micro) + Number(ledger.held_micro) +
          DEFAULT_RUN_BUDGET_MICRO > Number(policy.exposure_cap_micro)) fail("allowance_exhausted", 402);
        await tx.query("UPDATE guest_sponsor_ledgers SET reserved_micro=reserved_micro+$2,updated_at=now() WHERE policy_id=$1",
          [context.sponsor_policy_id, DEFAULT_RUN_BUDGET_MICRO]);
      },
      afterReservation: async (tx, runId, reservationId) => {
        await tx.query(`INSERT INTO guest_sponsor_reservations(run_id,guest_context_id,policy_id,reservation_id,amount_micro)
          VALUES ($1,$2,$3,$4,$5)`, [runId, guest.id, context.sponsor_policy_id, reservationId, DEFAULT_RUN_BUDGET_MICRO]);
      },
    });
    await db.query(`INSERT INTO guest_first_request_receipts(guest_context_id,request_id,request_digest,run_id)
      VALUES ($1,$2,$3,$4)`, [guest.id, key, requestDigest, created.runId]);
    await db.query("UPDATE guest_contexts SET accepted_turn_count=1 WHERE id=$1 AND accepted_turn_count=0", [guest.id]);
    return { ...created, firstTurnAvailable: false };
  });
}

/** Observation only: an unknown first POST is never converted into a new admission here. */
export async function resolveGuestFirstRequest(pool: pg.Pool, guest: GuestContext, key: string) {
  return withTx(pool, async (db) => {
    await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [guest.accountId]);
    const context = (await db.query<{ status: string; expires_at: Date }>(
      "SELECT status,expires_at FROM guest_contexts WHERE id=$1 FOR UPDATE", [guest.id])).rows[0];
    if (!context || context.status !== "active" || context.expires_at <= new Date()) fail("guest_expired", 403);
    const receipt = (await db.query<{ run_id: string }>(
      "SELECT run_id FROM guest_first_request_receipts WHERE guest_context_id=$1 AND request_id=$2", [guest.id, key])).rows[0];
    if (!receipt) return { status: "not_found" as const };
    const run = await getRun(db, receipt.run_id);
    if (!run || run.account_id !== guest.accountId) fail("authority_denied", 403);
    return { status: "accepted" as const, run: { runId: run.id, lifecycle: run.lifecycle,
      phase: run.phase, labeledDemo: run.route_mode === "fixture" } };
  });
}

export async function registerGuestPendingAction(pool: pg.Pool, guest: GuestContext, input: {
  submissionId: string; guestContextId: string; conversationId: string; conversationVersion: number;
  payload: GuestPendingPayload; payloadDigest: string; consentPolicyVersion: string;
}) {
  if (input.guestContextId !== guest.id || input.conversationId !== guest.conversationId ||
    input.conversationVersion !== 1 || input.consentPolicyVersion !== CONSENT_POLICY_VERSION ||
    sha256(canonicalGuestPendingPayload(input.payload)) !== input.payloadDigest) fail("intent_stale", 409);
  return withTx(pool, async (db) => {
    await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [guest.accountId]);
    const ctx = (await db.query<{ status: string; accepted_turn_count: number; expires_at: Date; control_version: string }>(
      "SELECT status,accepted_turn_count,expires_at,control_version FROM guest_contexts WHERE id=$1 FOR UPDATE", [guest.id])).rows[0];
    if (!ctx || ctx.status !== "active" || ctx.expires_at <= new Date()) fail("guest_expired", 403);
    if (ctx.accepted_turn_count !== 1) fail("intent_stale", 409);
    const consent = await currentConsent(db, guest.accountId);
    if (!consent || consent.revoked || consent.policyVersion !== CONSENT_POLICY_VERSION) fail("consent_required", 403);
    const first = (await db.query<{ run_id: string }>(
      "SELECT run_id FROM guest_first_request_receipts WHERE guest_context_id=$1", [guest.id])).rows[0];
    const parent = first ? await getRun(db, first.run_id) : null;
    if (!parent || parent.account_id !== guest.accountId || parent.conversation_id !== guest.conversationId) fail("intent_stale", 409);
    if (input.payload.kind === "follow_up" && input.payload.parentRunId !== parent.id) fail("intent_stale", 409);
    if (input.payload.kind === "clarification" && (parent.lifecycle !== "awaiting_input" ||
      parent.pending_input_type !== "clarification" || parent.pending_input_id !== input.payload.pendingInputId ||
      parent.brief_revision !== input.payload.briefRevision || parent.pending_input_field !== input.payload.field))
      fail("intent_stale", 409);
    const prior = (await db.query<{ payload_digest: string; state: string; expires_at: Date }>(
      "SELECT payload_digest,state,expires_at FROM guest_pending_actions WHERE submission_id=$1 FOR UPDATE", [input.submissionId])).rows[0];
    if (prior) {
      if (prior.payload_digest !== input.payloadDigest || prior.state !== "pending_auth") fail("idempotency_conflict", 409);
      return { code: "AUTH_REQUIRED_NEXT_TURN" as const, submissionId: input.submissionId,
        expiresAt: prior.expires_at.toISOString(), controlVersion: Number(ctx.control_version) };
    }
    const active = (await db.query("SELECT 1 FROM guest_pending_actions WHERE guest_context_id=$1 AND state='pending_auth'", [guest.id])).rowCount;
    if (active) fail("intent_stale", 409);
    const expiresAt = new Date(Math.min(Date.now() + PENDING_LIFETIME_MINUTES * 60_000, ctx.expires_at.getTime()));
    await db.query(`INSERT INTO guest_pending_actions(submission_id,guest_context_id,conversation_id,conversation_version,
      payload_digest,payload,consent_policy_version,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.submissionId, guest.id, guest.conversationId, 1, input.payloadDigest, JSON.stringify(input.payload),
        CONSENT_POLICY_VERSION, expiresAt]);
    return { code: "AUTH_REQUIRED_NEXT_TURN" as const, submissionId: input.submissionId,
      expiresAt: expiresAt.toISOString(), controlVersion: Number(ctx.control_version) };
  });
}

type ClaimInput = { claimRequestId: string; submissionId: string; guestContextId: string;
  conversationId: string; conversationVersion: number; authAttemptId: string };

type AttemptInput = { submissionId: string; authAttemptId: string };

export async function beginGuestAuthAttempt(pool: pg.Pool, guest: GuestContext, input: AttemptInput & {
  provider: "apple" | "google" | "email_code";
}) {
  return withTx(pool, async (db) => {
    await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [guest.accountId]);
    const context = (await db.query<{ status: string; expires_at: Date; accepted_turn_count: number;
      control_version: string }>(
      "SELECT status,expires_at,accepted_turn_count,control_version FROM guest_contexts WHERE id=$1 FOR UPDATE", [guest.id])).rows[0];
    if (!context || context.status !== "active" || context.expires_at <= new Date() ||
      context.accepted_turn_count !== 1) fail("guest_expired", 403);
    if ((await db.query("SELECT 1 FROM guest_control_tombstones WHERE guest_context_id=$1 AND reason='consent_revoked'",
      [guest.id])).rowCount) fail("consent_required", 403);
    const pending = (await db.query<{ state: string; auth_attempt_id: string | null; auth_provider: string | null;
      attempt_revision: string; expires_at: Date }>(
        "SELECT state,auth_attempt_id,auth_provider,attempt_revision,expires_at FROM guest_pending_actions WHERE submission_id=$1 AND guest_context_id=$2 FOR UPDATE",
        [input.submissionId, guest.id])).rows[0];
    if (!pending || pending.expires_at <= new Date()) fail("intent_stale", 409);
    if (pending.state === "authenticating" && pending.auth_attempt_id === input.authAttemptId &&
      pending.auth_provider === input.provider) return { submissionId: input.submissionId,
        authAttemptId: input.authAttemptId, attemptRevision: Number(pending.attempt_revision), state: "authenticating" as const };
    if (!["pending_auth", "dismissed", "cancelled"].includes(pending.state) ||
      pending.auth_attempt_id === input.authAttemptId) fail("intent_stale", 409);
    const consent = await currentConsent(db, guest.accountId);
    if (!consent || consent.revoked || consent.policyVersion !== CONSENT_POLICY_VERSION) fail("consent_required", 403);
    const next = Number(pending.attempt_revision) + 1;
    await db.query(`UPDATE guest_pending_actions SET state='authenticating',auth_attempt_id=$2,
      auth_provider=$3,attempt_revision=$4,auth_control_version=$5,auth_guest_consent_epoch=$6
      WHERE submission_id=$1`,
      [input.submissionId, input.authAttemptId, input.provider, next, Number(context.control_version), consent.epoch]);
    return { submissionId: input.submissionId, authAttemptId: input.authAttemptId,
      attemptRevision: next, state: "authenticating" as const };
  });
}

export async function endGuestAuthAttempt(pool: pg.Pool, guest: GuestContext, input: AttemptInput & {
  reason: "cancelled" | "dismissed";
}) {
  return withTx(pool, async (db) => {
    await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [guest.accountId]);
    const context = (await db.query<{ status: string }>(
      "SELECT status FROM guest_contexts WHERE id=$1 FOR UPDATE", [guest.id])).rows[0];
    if (!context || context.status !== "active") fail("guest_expired", 403);
    const pending = (await db.query<{ state: string; auth_attempt_id: string | null; attempt_revision: string }>(
      "SELECT state,auth_attempt_id,attempt_revision FROM guest_pending_actions WHERE submission_id=$1 AND guest_context_id=$2 FOR UPDATE",
      [input.submissionId, guest.id])).rows[0];
    if (!pending || pending.auth_attempt_id !== input.authAttemptId) fail("intent_stale", 409);
    if (pending.state === input.reason) return { submissionId: input.submissionId,
      authAttemptId: input.authAttemptId, attemptRevision: Number(pending.attempt_revision), state: input.reason };
    if (pending.state !== "authenticating") fail("intent_stale", 409);
    await db.query("UPDATE guest_pending_actions SET state=$2 WHERE submission_id=$1",
      [input.submissionId, input.reason]);
    return { submissionId: input.submissionId, authAttemptId: input.authAttemptId,
      attemptRevision: Number(pending.attempt_revision), state: input.reason };
  });
}

export async function resolveGuestAuthAttempt(pool: pg.Pool, guest: GuestContext, input: AttemptInput) {
  const pending = (await pool.query<{ state: string; auth_attempt_id: string | null; attempt_revision: string }>(
    `SELECT p.state,p.auth_attempt_id,p.attempt_revision FROM guest_pending_actions p
     JOIN guest_contexts g ON g.id=p.guest_context_id
     WHERE p.submission_id=$1 AND g.id=$2 AND g.status='active' AND g.expires_at>now()`,
    [input.submissionId, guest.id])).rows[0];
  if (!pending || pending.auth_attempt_id !== input.authAttemptId) fail("intent_stale", 409);
  return { submissionId: input.submissionId, authAttemptId: input.authAttemptId,
    attemptRevision: Number(pending.attempt_revision), state: pending.state };
}

async function memberBudgetAllowed(db: Queryable, accountId: string) {
  const row = (await db.query<{ available: string }>(`SELECT limit_micro-settled_micro-reserved_micro AS available
    FROM allowance_accounts WHERE account_id=$1`, [accountId])).rows[0];
  return Boolean(row && Number(row.available) >= DEFAULT_RUN_BUDGET_MICRO);
}

async function claimReceipt(db: Queryable, memberAccountId: string, claimRequestId: string, submissionId: string) {
  const row = (await db.query<{ guest_context_id: string; member_account_id: string; control_version: string;
    conversation_id: string; conversation_version: string; deletion_epoch: string; revoked_at: Date | null;
    guest_status: string; guest_expires_at: Date; guest_deleted_at: Date | null; pending_state: string }>(
      `SELECT c.guest_context_id,c.member_account_id,c.control_version,g.conversation_id,
        p.conversation_version,a.deletion_epoch,b.revoked_at,g.status AS guest_status,
        g.expires_at AS guest_expires_at,ga.deleted_at AS guest_deleted_at,p.state AS pending_state
       FROM guest_claim_requests c JOIN guest_pending_actions p ON p.submission_id=c.submission_id
       JOIN guest_contexts g ON g.id=c.guest_context_id
       JOIN conversation_control_bindings b ON b.id=c.binding_id
       JOIN accounts a ON a.id=c.member_account_id
       JOIN accounts ga ON ga.id=g.execution_owner_account_id
       WHERE c.request_id=$1 AND c.submission_id=$2 AND c.member_account_id=$3`,
      [claimRequestId, submissionId, memberAccountId])).rows[0];
  if (!row || row.revoked_at || row.guest_status !== "claimed" || row.guest_expires_at <= new Date() ||
      row.guest_deleted_at || row.pending_state === "deleted" ||
      Number(row.deletion_epoch) !== Number((await db.query(
    "SELECT member_deletion_epoch FROM conversation_control_bindings WHERE guest_context_id=$1",
    [row.guest_context_id])).rows[0]?.member_deletion_epoch)) fail("authority_denied", 403);
  const guestConsent = (await db.query<{ revoked_at: Date | null; policy_version: string }>(
    `SELECT cr.revoked_at,cr.policy_version FROM consent_records cr JOIN guest_contexts g
     ON g.execution_owner_account_id=cr.account_id WHERE g.id=$1
     ORDER BY cr.consent_epoch DESC LIMIT 1`, [row.guest_context_id])).rows[0];
  if (!guestConsent || guestConsent.revoked_at || guestConsent.policy_version !== CONSENT_POLICY_VERSION ||
    (await db.query(`SELECT 1 FROM guest_control_tombstones WHERE guest_context_id=$1
      AND reason IN ('expired','guest_deleted','member_deletion','member_revoked','consent_revoked')`,
      [row.guest_context_id])).rowCount) fail("authority_denied", 403);
  const consent = await currentConsent(db, memberAccountId);
  return { type: "claim_accepted" as const, submissionId, claimRequestId, requestId: claimRequestId,
    accountId: memberAccountId, guestContextId: row.guest_context_id, conversationId: row.conversation_id,
    conversationVersion: Number(row.conversation_version), controlVersion: Number(row.control_version),
    authorityAllowed: true, budgetAllowed: await memberBudgetAllowed(db, memberAccountId),
    consentPolicyVersion: consent && !consent.revoked ? consent.policyVersion : null };
}

/** Both independent proofs are required. The guest proof is destroyed in the same transaction as the binding. */
export async function claimGuestAction(pool: pg.Pool, guest: GuestContext, memberAccountId: string,
  memberDeletionEpoch: number, input: ClaimInput) {
  if (guest.id !== input.guestContextId || guest.conversationId !== input.conversationId ||
      input.conversationVersion !== 1 || guest.accountId === memberAccountId) fail("authority_denied", 403);
  return withTx(pool, async (db) => {
    const locked = await lockAccountsOrdered(db, [memberAccountId, guest.accountId]);
    const member = locked.get(memberAccountId);
    if (!member || Number(member.deletion_epoch) !== memberDeletionEpoch) fail("authority_denied", 403);
    const context = (await db.query<{ status: string; proof_digest: string | null; accepted_turn_count: number;
      control_version: string; expires_at: Date }>(
        "SELECT status,proof_digest,accepted_turn_count,control_version,expires_at FROM guest_contexts WHERE id=$1 FOR UPDATE",
        [guest.id])).rows[0];
    if (!context || context.status !== "active" || !context.proof_digest || context.expires_at <= new Date() ||
        context.accepted_turn_count !== 1) fail("guest_expired", 403);
    const pending = (await db.query<{ state: string; expires_at: Date; conversation_id: string;
      conversation_version: string; consent_policy_version: string; auth_attempt_id: string | null;
      auth_control_version: string | null; auth_guest_consent_epoch: string | null }>(
        `SELECT state,expires_at,conversation_id,conversation_version,consent_policy_version,
          auth_attempt_id,auth_control_version,auth_guest_consent_epoch
         FROM guest_pending_actions WHERE submission_id=$1 AND guest_context_id=$2 FOR UPDATE`,
        [input.submissionId, guest.id])).rows[0];
    if (!pending || pending.state !== "authenticating" || pending.auth_attempt_id !== input.authAttemptId ||
      pending.expires_at <= new Date() || Number(pending.auth_control_version) !== Number(context.control_version) ||
      pending.conversation_id !== guest.conversationId || Number(pending.conversation_version) !== 1 ||
      pending.consent_policy_version !== CONSENT_POLICY_VERSION) fail("intent_stale", 409);
    const guestConsent = await currentConsent(db, guest.accountId);
    if (!guestConsent || guestConsent.revoked || guestConsent.policyVersion !== CONSENT_POLICY_VERSION ||
      Number(pending.auth_guest_consent_epoch) !== guestConsent.epoch ||
      (await db.query("SELECT 1 FROM guest_control_tombstones WHERE guest_context_id=$1 AND reason='consent_revoked'",
        [guest.id])).rowCount) fail("consent_required", 403);
    // Proof of a guest action does not grant consent to a separate authenticated account.
    // The member must explicitly grant the current policy before resume; prior revocation remains a deny.
    const controlVersion = Number(context.control_version) + 1;
    const bindingId = crypto.randomUUID();
    await db.query(`INSERT INTO conversation_control_bindings(id,guest_context_id,guest_conversation_id,
      member_account_id,control_version,member_deletion_epoch) VALUES ($1,$2,$3,$4,$5,$6)`,
      [bindingId, guest.id, guest.conversationId, memberAccountId, controlVersion, memberDeletionEpoch]);
    const requestDigest = sha256(JSON.stringify([input.claimRequestId, input.submissionId, input.guestContextId,
      input.conversationId, input.conversationVersion, memberAccountId]));
    await db.query(`INSERT INTO guest_claim_requests(request_id,submission_id,guest_context_id,member_account_id,
      request_digest,binding_id,control_version) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [input.claimRequestId, input.submissionId, guest.id, memberAccountId, requestDigest, bindingId, controlVersion]);
    await db.query(`UPDATE guest_pending_actions SET state='claimed',member_account_id=$2,claim_request_id=$3
      WHERE submission_id=$1`, [input.submissionId, memberAccountId, input.claimRequestId]);
    await db.query(`UPDATE guest_contexts SET status='claimed',proof_digest=NULL,claimed_at=now(),control_version=$2
      WHERE id=$1`, [guest.id, controlVersion]);
    await db.query("INSERT INTO guest_control_tombstones(guest_context_id,control_version,reason) VALUES ($1,$2,'claimed')",
      [guest.id, controlVersion]);
    return claimReceipt(db, memberAccountId, input.claimRequestId, input.submissionId);
  });
}

export async function resolveGuestClaim(pool: pg.Pool, memberAccountId: string, claimRequestId: string,
  submissionId: string) {
  return claimReceipt(pool, memberAccountId, claimRequestId, submissionId);
}

type ResumeInput = { submissionId: string; claimRequestId: string; controlVersion: number; payloadDigest: string };

export async function resumeClaimedGuestAction(pool: pg.Pool, memberAccountId: string, input: ResumeInput, config: AppConfig) {
  return withTx(pool, async (db) => {
    const identified = (await db.query<{ guest_context_id: string; execution_owner_account_id: string }>(
      `SELECT p.guest_context_id,g.execution_owner_account_id FROM guest_pending_actions p
       JOIN guest_contexts g ON g.id=p.guest_context_id WHERE p.submission_id=$1`, [input.submissionId])).rows[0];
    if (!identified) fail("authority_denied", 403);
    const locked = await lockAccountsOrdered(db, [memberAccountId, identified.execution_owner_account_id]);
    const member = locked.get(memberAccountId);
    if (!member) fail("authority_denied", 403);
    const context = (await db.query<{ status: string; expires_at: Date }>(
      "SELECT status,expires_at FROM guest_contexts WHERE id=$1 FOR UPDATE", [identified.guest_context_id])).rows[0];
    if (!context || context.status !== "claimed" || context.expires_at <= new Date() ||
      (await db.query(`SELECT 1 FROM guest_control_tombstones WHERE guest_context_id=$1
        AND reason IN ('expired','guest_deleted','member_deletion','member_revoked','consent_revoked')`,
        [identified.guest_context_id])).rowCount) fail("authority_denied", 403);
    const guestConsent = await currentConsent(db, identified.execution_owner_account_id);
    if (!guestConsent || guestConsent.revoked || guestConsent.policyVersion !== CONSENT_POLICY_VERSION)
      fail("consent_required", 403);
    const pending = (await db.query<{ state: string; payload: GuestPendingPayload; payload_digest: string;
      guest_context_id: string; member_account_id: string; claim_request_id: string; member_conversation_id: string | null;
      member_run_id: string | null; dispatch_receipt_id: string | null; expires_at: Date }>(
        "SELECT * FROM guest_pending_actions WHERE submission_id=$1 FOR UPDATE", [input.submissionId])).rows[0];
    if (!pending || pending.member_account_id !== memberAccountId || pending.claim_request_id !== input.claimRequestId ||
        pending.payload_digest !== input.payloadDigest) fail("authority_denied", 403);
    const binding = (await db.query<{ id: string; control_version: string; member_deletion_epoch: string;
      revoked_at: Date | null; guest_conversation_id: string }>(
        `SELECT id,control_version,member_deletion_epoch,revoked_at,guest_conversation_id
         FROM conversation_control_bindings WHERE guest_context_id=$1 AND member_account_id=$2 FOR UPDATE`,
        [pending.guest_context_id, memberAccountId])).rows[0];
    if (!binding || binding.revoked_at || Number(binding.control_version) !== input.controlVersion ||
        Number(binding.member_deletion_epoch) !== Number(member.deletion_epoch)) fail("authority_denied", 403);
    const consent = await currentConsent(db, memberAccountId);
    if (!consent || consent.revoked || consent.policyVersion !== CONSENT_POLICY_VERSION) fail("consent_required", 403);
    if (pending.state === "dispatched" && pending.member_run_id && pending.member_conversation_id && pending.dispatch_receipt_id)
      return { type: "continuation_dispatched" as const, submissionId: input.submissionId,
        claimRequestId: input.claimRequestId, accountId: memberAccountId,
        conversationId: binding.guest_conversation_id, conversationVersion: 1,
        receiptId: pending.dispatch_receipt_id, runId: pending.member_run_id,
        memberConversationId: pending.member_conversation_id, kind: pending.payload.kind, reused: true };
    if (pending.state !== "claimed" || pending.expires_at <= new Date()) fail("intent_stale", 409);
    const first = (await db.query<{ run_id: string; execution_owner_account_id: string }>(
      `SELECT r.run_id,g.execution_owner_account_id FROM guest_first_request_receipts r
       JOIN guest_contexts g ON g.id=r.guest_context_id WHERE r.guest_context_id=$1`,
       [pending.guest_context_id])).rows[0];
    if (!first) fail("intent_stale", 409);
    const guestRun = await getRun(db, first.run_id);
    if (!guestRun || guestRun.account_id !== first.execution_owner_account_id ||
      guestRun.conversation_id !== binding.guest_conversation_id) fail("intent_stale", 409);
    await assertRouteAdmission(db, config, guestRun.route_mode as "fixture" | "controlled-research");
    const payload = pending.payload;
    if (payload.kind === "follow_up" && payload.parentRunId !== guestRun.id) fail("intent_stale", 409);
    if (payload.kind === "clarification" && (guestRun.lifecycle !== "awaiting_input" ||
      guestRun.pending_input_type !== "clarification" || guestRun.pending_input_id !== payload.pendingInputId ||
      guestRun.brief_revision !== payload.briefRevision || guestRun.pending_input_field !== payload.field)) fail("intent_stale", 409);
    const guestBrief = payload.kind === "clarification" ? await getBrief(db, guestRun.brief_id) : null;
    const question = payload.kind === "clarification" ? guestBrief!.originalQuestion : payload.text;
    const memberConversationId = pending.member_conversation_id ?? await insertConversation(db, memberAccountId, question);
    const created = await admitRun(db, memberAccountId, input.submissionId, {
      question, routeMode: guestRun.route_mode as "fixture" | "controlled-research", attachmentIds: [],
      conversationId: memberConversationId, consentPolicyVersion: CONSENT_POLICY_VERSION,
    }, {
      ...admittedRunOptions(config),
      beforeReservation: async (tx, runId) => {
        await tx.query(`UPDATE runs SET claimed_parent_run_id=$2,claimed_parent_conversation_id=$3,
          claimed_control_binding_id=$4,claimed_control_version=$5,guest_pending_action_id=$6 WHERE id=$1`,
          [runId, guestRun.id, guestRun.conversation_id, binding.id, input.controlVersion, input.submissionId]);
      },
    });
    if (payload.kind === "clarification") {
      const parsed = constraintFromClarificationAnswer(payload.field as Parameters<typeof constraintFromClarificationAnswer>[0], payload.text);
      if (!parsed.ok) fail("invalid_input", 400);
      const child = await getBrief(db, created.brief.id);
      const constraints = [...guestBrief!.constraints.filter((c) => c.field !== parsed.constraint.field), parsed.constraint];
      await db.query("UPDATE research_briefs SET payload=$2 WHERE id=$1 AND account_id=$3",
        [child.id, JSON.stringify({ ...child, constraints }), memberAccountId]);
    }
    const receiptId = crypto.randomUUID();
    await db.query(`UPDATE guest_pending_actions SET state='dispatched',member_conversation_id=$2,
      member_run_id=$3,dispatch_receipt_id=$4 WHERE submission_id=$1 AND state='claimed'`,
      [input.submissionId, memberConversationId, created.runId, receiptId]);
    return { type: "continuation_dispatched" as const, submissionId: input.submissionId,
      claimRequestId: input.claimRequestId, accountId: memberAccountId,
      conversationId: binding.guest_conversation_id, conversationVersion: 1,
      receiptId, runId: created.runId, memberConversationId, kind: payload.kind, reused: false };
  });
}

export async function resolveGuestAction(pool: pg.Pool, memberAccountId: string,
  claimRequestId: string, submissionId: string, config: AppConfig) {
  const row = (await pool.query<{ state: string; control_version: string; payload_digest: string }>(
    `SELECT p.state,c.control_version,p.payload_digest FROM guest_pending_actions p
     JOIN guest_claim_requests c ON c.request_id=p.claim_request_id
     WHERE p.submission_id=$1 AND p.claim_request_id=$2 AND p.member_account_id=$3`,
    [submissionId, claimRequestId, memberAccountId])).rows[0];
  if (!row) fail("authority_denied", 403);
  if (row.state !== "dispatched") return claimReceipt(pool, memberAccountId, claimRequestId, submissionId);
  return resumeClaimedGuestAction(pool, memberAccountId, { submissionId, claimRequestId,
    controlVersion: Number(row.control_version), payloadDigest: row.payload_digest }, config);
}

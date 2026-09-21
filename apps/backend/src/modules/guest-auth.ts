import { createHash, createHmac, randomBytes } from "node:crypto";
import pg from "pg";
import {
  CONSENT_POLICY_VERSION, DEFAULT_RUN_BUDGET_MICRO,
  canonicalGuestPendingPayload,
  type CreateRunRequest, type GuestPendingPayload,
} from "@deep/contracts";
import { withTx, type Queryable } from "../platform/db.js";
import type { AppConfig } from "../platform/config.js";
import { currentConsent } from "./access.js";
import { admitRun } from "./run-admission.js";
import { getBrief, getRun, insertConversation } from "./runs.js";
import { constraintFromClarificationAnswer } from "@deep/research-core";

const GUEST_LIFETIME_HOURS = 24;
const PENDING_LIFETIME_MINUTES = 30;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function fail(code: string, statusCode: number): never {
  throw Object.assign(new Error(code), { code, statusCode });
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
  conversationId: string; conversationVersion: number };

async function memberBudgetAllowed(db: Queryable, accountId: string) {
  const row = (await db.query<{ available: string }>(`SELECT limit_micro-settled_micro-reserved_micro AS available
    FROM allowance_accounts WHERE account_id=$1`, [accountId])).rows[0];
  return Boolean(row && Number(row.available) >= DEFAULT_RUN_BUDGET_MICRO);
}

async function claimReceipt(db: Queryable, memberAccountId: string, claimRequestId: string, submissionId: string) {
  const row = (await db.query<{ guest_context_id: string; member_account_id: string; control_version: string;
    conversation_id: string; conversation_version: string; deletion_epoch: string; revoked_at: Date | null }>(
      `SELECT c.guest_context_id,c.member_account_id,c.control_version,g.conversation_id,
        p.conversation_version,a.deletion_epoch,b.revoked_at
       FROM guest_claim_requests c JOIN guest_pending_actions p ON p.submission_id=c.submission_id
       JOIN guest_contexts g ON g.id=c.guest_context_id
       JOIN conversation_control_bindings b ON b.id=c.binding_id
       JOIN accounts a ON a.id=c.member_account_id
       WHERE c.request_id=$1 AND c.submission_id=$2 AND c.member_account_id=$3`,
      [claimRequestId, submissionId, memberAccountId])).rows[0];
  if (!row || row.revoked_at || Number(row.deletion_epoch) !== Number((await db.query(
    "SELECT member_deletion_epoch FROM conversation_control_bindings WHERE guest_context_id=$1",
    [row.guest_context_id])).rows[0]?.member_deletion_epoch)) fail("authority_denied", 403);
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
    const member = (await db.query<{ deletion_epoch: string }>(
      "SELECT deletion_epoch FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [memberAccountId])).rows[0];
    if (!member || Number(member.deletion_epoch) !== memberDeletionEpoch) fail("authority_denied", 403);
    const owner = (await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [guest.accountId])).rows[0];
    if (!owner) fail("guest_deleted", 403);
    const context = (await db.query<{ status: string; proof_digest: string | null; accepted_turn_count: number;
      control_version: string; expires_at: Date }>(
        "SELECT status,proof_digest,accepted_turn_count,control_version,expires_at FROM guest_contexts WHERE id=$1 FOR UPDATE",
        [guest.id])).rows[0];
    if (!context || context.status !== "active" || !context.proof_digest || context.expires_at <= new Date() ||
        context.accepted_turn_count !== 1) fail("guest_expired", 403);
    const pending = (await db.query<{ state: string; expires_at: Date; conversation_id: string;
      conversation_version: string; consent_policy_version: string }>(
        "SELECT state,expires_at,conversation_id,conversation_version,consent_policy_version FROM guest_pending_actions WHERE submission_id=$1 AND guest_context_id=$2 FOR UPDATE",
        [input.submissionId, guest.id])).rows[0];
    if (!pending || pending.state !== "pending_auth" || pending.expires_at <= new Date() ||
      pending.conversation_id !== guest.conversationId || Number(pending.conversation_version) !== 1 ||
      pending.consent_policy_version !== CONSENT_POLICY_VERSION) fail("intent_stale", 409);
    const guestConsent = await currentConsent(db, guest.accountId);
    if (!guestConsent || guestConsent.revoked || guestConsent.policyVersion !== CONSENT_POLICY_VERSION) fail("consent_required", 403);
    const memberConsent = await currentConsent(db, memberAccountId);
    if (memberConsent?.revoked || (memberConsent && memberConsent.policyVersion !== CONSENT_POLICY_VERSION)) fail("consent_required", 403);
    if (!memberConsent) {
      await db.query(`INSERT INTO consent_records(account_id,policy_version,processors,consent_epoch)
        SELECT $1,policy_version,processors,1 FROM consent_records
        WHERE account_id=$2 AND consent_epoch=$3`, [memberAccountId, guest.accountId, guestConsent.epoch]);
    }
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

export async function resumeClaimedGuestAction(pool: pg.Pool, memberAccountId: string, input: ResumeInput) {
  return withTx(pool, async (db) => {
    const member = (await db.query<{ deletion_epoch: string }>(
      "SELECT deletion_epoch FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [memberAccountId])).rows[0];
    if (!member) fail("authority_denied", 403);
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
    if (pending.state === "dispatched" && pending.member_run_id && pending.member_conversation_id && pending.dispatch_receipt_id)
      return { type: "continuation_dispatched" as const, submissionId: input.submissionId,
        claimRequestId: input.claimRequestId, accountId: memberAccountId,
        conversationId: binding.guest_conversation_id, conversationVersion: 1,
        receiptId: pending.dispatch_receipt_id, runId: pending.member_run_id,
        memberConversationId: pending.member_conversation_id, kind: pending.payload.kind };
    if (pending.state !== "claimed" || pending.expires_at <= new Date()) fail("intent_stale", 409);
    const consent = await currentConsent(db, memberAccountId);
    if (!consent || consent.revoked || consent.policyVersion !== CONSENT_POLICY_VERSION) fail("consent_required", 403);
    const first = (await db.query<{ run_id: string; execution_owner_account_id: string }>(
      `SELECT r.run_id,g.execution_owner_account_id FROM guest_first_request_receipts r
       JOIN guest_contexts g ON g.id=r.guest_context_id WHERE r.guest_context_id=$1`,
       [pending.guest_context_id])).rows[0];
    if (!first) fail("intent_stale", 409);
    const guestRun = await getRun(db, first.run_id);
    if (!guestRun || guestRun.account_id !== first.execution_owner_account_id ||
      guestRun.conversation_id !== binding.guest_conversation_id) fail("intent_stale", 409);
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
      receiptId, runId: created.runId, memberConversationId, kind: payload.kind };
  });
}

export async function resolveGuestAction(pool: pg.Pool, memberAccountId: string,
  claimRequestId: string, submissionId: string) {
  const row = (await pool.query<{ state: string; control_version: string; payload_digest: string }>(
    `SELECT p.state,c.control_version,p.payload_digest FROM guest_pending_actions p
     JOIN guest_claim_requests c ON c.request_id=p.claim_request_id
     WHERE p.submission_id=$1 AND p.claim_request_id=$2 AND p.member_account_id=$3`,
    [submissionId, claimRequestId, memberAccountId])).rows[0];
  if (!row) fail("authority_denied", 403);
  if (row.state !== "dispatched") return claimReceipt(pool, memberAccountId, claimRequestId, submissionId);
  return resumeClaimedGuestAction(pool, memberAccountId, { submissionId, claimRequestId,
    controlVersion: Number(row.control_version), payloadDigest: row.payload_digest });
}

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
import { insertConversation } from "./runs.js";

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

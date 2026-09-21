import { createHash } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import { CONSENT_POLICY_VERSION, CorrectionRequestSchema, OUTPUT_REPORT_CATEGORIES,
  type CorrectionRequest } from "@deep/contracts";
import { applyQuestionPatch } from "@deep/research-core";
import type { AppConfig } from "../platform/config.js";
import { withTx } from "../platform/db.js";
import { currentConsent, lockActiveAccount } from "./access.js";
import { admissionKeyHash } from "./admission-recovery.js";
import { claimedConversationScope } from "./guest-auth.js";
import { getReportForAccount, reportOwnsClaim, excerptFromReport } from "./reports.js";
import { researchCorrectionIdentity } from "./research-corrections.js";
import { admitRun } from "./run-admission.js";
import { admittedRunOptions, assertRouteAdmission } from "./run-route-admission.js";
import { findRunByIdempotency, getBrief, getRun } from "./runs.js";
import { claimedCorrectionProofAllowed } from "./guest-execution-control.js";

function deny(code: string, statusCode: number): never {
  throw Object.assign(new Error(code), { code, statusCode });
}

type ClaimedActionBasis = {
  guestOwnerId: string;
  guestConversationId: string;
  bindingId: string;
  bindingVersion: number;
  originalSubmissionId: string;
  memberConversationId: string;
  parentBriefId: string;
  parentBriefRevision: number;
};

/** Account locks match claim, deletion and source removal; no unlocked read grants authority. */
async function claimedActionBasis(db: pg.PoolClient, memberAccountId: string,
  parentRunId: string): Promise<ClaimedActionBasis> {
  const candidate = (await db.query<{ guest_context_id: string; execution_owner_account_id: string }>(`
    SELECT f.guest_context_id,g.execution_owner_account_id FROM guest_first_request_receipts f
    JOIN guest_contexts g ON g.id=f.guest_context_id WHERE f.run_id=$1`, [parentRunId])).rows[0];
  if (!candidate || candidate.execution_owner_account_id === memberAccountId)
    deny("authority_denied", 404);
  for (const id of [candidate.execution_owner_account_id, memberAccountId].sort())
    await lockActiveAccount(db, id);
  await db.query("SELECT id FROM guest_contexts WHERE id=$1 FOR UPDATE", [candidate.guest_context_id]);
  const binding = (await db.query<{ id: string }>(`
    SELECT id FROM conversation_control_bindings WHERE guest_context_id=$1
      AND member_account_id=$2 FOR UPDATE`, [candidate.guest_context_id, memberAccountId])).rows[0];
  if (!binding) deny("authority_denied", 404);
  const scope = await claimedConversationScope(db, memberAccountId, parentRunId);
  if (!scope || scope.parentExecutionOwnerId !== candidate.execution_owner_account_id ||
      scope.controlBindingId !== binding.id) deny("authority_denied", 404);
  const original = (await db.query<{ submission_id: string; state: string; member_account_id: string;
    member_run_id: string | null; member_conversation_id: string | null;
    dispatch_receipt_id: string | null; control_version: string }>(`
    SELECT p.submission_id,p.state,p.member_account_id,p.member_run_id,p.member_conversation_id,
      p.dispatch_receipt_id,c.control_version FROM guest_claim_requests c
    JOIN guest_pending_actions p ON p.submission_id=c.submission_id
    WHERE c.binding_id=$1 AND c.member_account_id=$2 AND c.guest_context_id=$3
    FOR UPDATE OF p,c`, [binding.id, memberAccountId, candidate.guest_context_id])).rows[0];
  if (!original || original.state !== "dispatched" || original.member_account_id !== memberAccountId ||
      !original.member_run_id || !original.member_conversation_id || !original.dispatch_receipt_id ||
      Number(original.control_version) !== scope.controlVersion) deny("authority_denied", 404);
  const first = await getRun(db, parentRunId, { forUpdate: true });
  const continuation = (await db.query<{ account_id: string; conversation_id: string;
    claimed_parent_run_id: string | null; claimed_parent_conversation_id: string | null;
    claimed_control_binding_id: string | null; claimed_control_version: string | null;
    guest_pending_action_id: string | null }>(`SELECT account_id,conversation_id,claimed_parent_run_id,
      claimed_parent_conversation_id,claimed_control_binding_id,claimed_control_version,
      guest_pending_action_id FROM runs WHERE id=$1 FOR UPDATE`, [original.member_run_id])).rows[0];
  if (!first || first.account_id !== candidate.execution_owner_account_id ||
      first.conversation_id !== scope.conversationId || first.route_mode !== "controlled-research" ||
      first.lifecycle === "cancelling" || first.terminal_outcome === "cancelled" ||
      !continuation || continuation.account_id !== memberAccountId ||
      continuation.conversation_id !== original.member_conversation_id ||
      continuation.claimed_parent_run_id !== parentRunId ||
      continuation.claimed_parent_conversation_id !== scope.conversationId ||
      continuation.claimed_control_binding_id !== binding.id ||
      Number(continuation.claimed_control_version) !== scope.controlVersion ||
      continuation.guest_pending_action_id !== original.submission_id)
    deny("authority_denied", 404);
  const guestConsent = await currentConsent(db, candidate.execution_owner_account_id);
  const memberConsent = await currentConsent(db, memberAccountId);
  if (!guestConsent || guestConsent.revoked || guestConsent.policyVersion !== CONSENT_POLICY_VERSION ||
      !memberConsent || memberConsent.revoked || memberConsent.policyVersion !== CONSENT_POLICY_VERSION)
    deny("consent_required", 403);
  if ((await db.query(`SELECT 1 FROM tombstones WHERE object_kind='run' AND reason='source_deletion'
    AND ((account_id=$1 AND object_id=$2) OR (account_id=$3 AND object_id=$4))`,
    [candidate.execution_owner_account_id, parentRunId, memberAccountId, original.member_run_id])).rowCount)
    deny("source_deleted", 409);
  return { guestOwnerId: candidate.execution_owner_account_id, guestConversationId: scope.conversationId,
    bindingId: binding.id, bindingVersion: scope.controlVersion,
    originalSubmissionId: original.submission_id, memberConversationId: original.member_conversation_id,
    parentBriefId: first.brief_id, parentBriefRevision: first.brief_revision };
}

const ChallengeInput = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  claimId: z.string().uuid().optional(),
  category: z.enum([...OUTPUT_REPORT_CATEGORIES, "claim"]),
  note: z.string().trim().min(1).max(4000).optional(),
  includeExcerpt: z.boolean().optional(),
}).strict();

function challengeId(memberAccountId: string, reportId: string, key: string): string {
  const bytes = createHash("sha256").update(JSON.stringify(["claimed-report-challenge.v1",
    memberAccountId, reportId, key])).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Feedback is member-owned, but its guest report FK remains at the immutable guest owner. */
export async function insertClaimedReportChallenge(pool: pg.Pool, memberAccountId: string,
  parentRunId: string, reportId: string, raw: z.input<typeof ChallengeInput>) {
  const parsed = ChallengeInput.safeParse(raw);
  if (!parsed.success || !z.string().uuid().safeParse(parentRunId).success ||
      !z.string().uuid().safeParse(reportId).success) deny("invalid_input", 400);
  const input = parsed.data;
  return withTx(pool, async (db) => {
    const basis = await claimedActionBasis(db, memberAccountId, parentRunId);
    const report = await getReportForAccount(db, reportId, basis.guestOwnerId);
    if (!report || report.run_id !== parentRunId) deny("authority_denied", 404);
    if (input.claimId && !await reportOwnsClaim(db, reportId, basis.guestOwnerId, input.claimId))
      deny("authority_denied", 404);
    const includeExcerpt = input.includeExcerpt === true;
    const excerptText = includeExcerpt ? excerptFromReport(report) : null;
    const id = challengeId(memberAccountId, reportId, input.idempotencyKey);
    const inserted = await db.query(`INSERT INTO challenges
      (id,account_id,report_id,claim_id,category,note,include_excerpt,excerpt_text)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id, memberAccountId, reportId, input.claimId ?? null, input.category, input.note ?? null,
        includeExcerpt, excerptText]);
    if (!inserted.rowCount) {
      const prior = (await db.query<{ account_id: string; report_id: string; claim_id: string | null;
        category: string; note: string | null; include_excerpt: boolean; excerpt_text: string | null }>(`
        SELECT account_id,report_id,claim_id,category,note,include_excerpt,excerpt_text
        FROM challenges WHERE id=$1`, [id])).rows[0];
      if (!prior || prior.account_id !== memberAccountId || prior.report_id !== reportId ||
          prior.claim_id !== (input.claimId ?? null) || prior.category !== input.category ||
          prior.note !== (input.note ?? null) || prior.include_excerpt !== includeExcerpt ||
          prior.excerpt_text !== excerptText) deny("idempotency_conflict", 409);
    }
    return { challengeId: id, submitted: true as const, includedExcerpt: includeExcerpt,
      reused: !inserted.rowCount };
  });
}

/** A fresh member child references only the claim control proof, never guest passages or payer. */
export async function admitClaimedReportCorrection(pool: pg.Pool, config: AppConfig,
  memberAccountId: string, parentRunId: string, raw: CorrectionRequest) {
  const parsed = CorrectionRequestSchema.strict().safeParse(raw);
  if (!parsed.success || !parsed.data.patch ||
      !["replace_question", "replace_question_span"].includes(parsed.data.patch.kind) ||
      parsed.data.patch.evidencePolicy !== "refresh" ||
      !z.string().uuid().safeParse(parentRunId).success) deny("invalid_input", 400);
  const input = parsed.data;
  const { patch, accepted, key } = researchCorrectionIdentity(parentRunId, input);
  return withTx(pool, async (db) => {
    const basis = await claimedActionBasis(db, memberAccountId, parentRunId);
    if (basis.parentBriefRevision !== input.expectedBriefRevision) deny("stale_revision", 409);
    const parentBrief = await getBrief(db, basis.parentBriefId);
    if (parentBrief.attachmentIds.length) deny("authority_denied", 409);
    if (!(await db.query(`SELECT 1 FROM reports WHERE run_id=$1 AND account_id=$2
      AND redacted_at IS NULL LIMIT 1`, [parentRunId, basis.guestOwnerId])).rowCount)
      deny("authority_denied", 404);
    let question: string;
    try {
      question = applyQuestionPatch(parentBrief.originalQuestion,
        createHash("sha256").update(parentBrief.originalQuestion).digest("hex"), patch);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("question_patch_"))
        deny(error.message, 409);
      throw error;
    }
    const proof = { ...accepted, claimedParentRunId: parentRunId,
      claimedParentConversationId: basis.guestConversationId,
      claimedControlBindingId: basis.bindingId, claimedControlVersion: basis.bindingVersion,
      originalPendingSubmissionId: basis.originalSubmissionId };
    if ((await db.query("SELECT 1 FROM admission_withdrawals WHERE account_id=$1 AND key_hash=$2",
      [memberAccountId, admissionKeyHash(key)])).rowCount) deny("idempotency_withdrawn", 409);
    const existing = await findRunByIdempotency(db, memberAccountId, key);
    if (!existing) await assertRouteAdmission(db, config, "controlled-research");
    const created = await admitRun(db, memberAccountId, key, {
      question, routeMode: "controlled-research", attachmentIds: [],
      conversationId: basis.memberConversationId, consentPolicyVersion: CONSENT_POLICY_VERSION,
    }, {
      ...admittedRunOptions(config),
      beforeReservation: async (tx, runId) => {
        await tx.query(`UPDATE runs SET claimed_parent_run_id=$2,claimed_parent_conversation_id=$3,
          claimed_control_binding_id=$4,claimed_control_version=$5,guest_pending_action_id=NULL
          WHERE id=$1`, [runId, parentRunId, basis.guestConversationId,
          basis.bindingId, basis.bindingVersion]);
        await tx.query(`INSERT INTO research_change_sets
          (run_id,account_id,parent_run_id,patch,dependency_completeness,reused_passages,reopen_discovery)
          VALUES ($1,$2,$3,$4,'unknown',0,true)`,
          [runId, memberAccountId, parentRunId, JSON.stringify(proof)]);
      },
    });
    const saved = (await db.query<{ parent_run_id: string | null; conversation_id: string;
      claimed_parent_run_id: string | null; claimed_parent_conversation_id: string | null;
      claimed_control_binding_id: string | null; claimed_control_version: string | null;
      guest_pending_action_id: string | null; proof_matches: boolean; reused_passages: number;
      reopen_discovery: boolean; dependency_completeness: string; outbox: string | null }>(`
      SELECT r.parent_run_id,r.conversation_id,r.claimed_parent_run_id,
        r.claimed_parent_conversation_id,r.claimed_control_binding_id,
        r.claimed_control_version,r.guest_pending_action_id,c.patch=$3::jsonb AS proof_matches,c.reused_passages,
        c.reopen_discovery,c.dependency_completeness,o.run_id AS outbox
      FROM runs r LEFT JOIN research_change_sets c ON c.run_id=r.id AND c.account_id=$2
      LEFT JOIN run_dispatch_outbox o ON o.run_id=r.id WHERE r.id=$1 AND r.account_id=$2`,
      [created.runId, memberAccountId, JSON.stringify(proof)])).rows[0];
    if (!saved || saved.parent_run_id !== null || saved.conversation_id !== basis.memberConversationId ||
        saved.claimed_parent_run_id !== parentRunId ||
        saved.claimed_parent_conversation_id !== basis.guestConversationId ||
        saved.claimed_control_binding_id !== basis.bindingId ||
        Number(saved.claimed_control_version) !== basis.bindingVersion ||
        saved.guest_pending_action_id !== null ||
        !saved.proof_matches || saved.reused_passages !== 0 ||
        !saved.reopen_discovery || saved.dependency_completeness !== "unknown" ||
        saved.outbox !== created.runId) deny("correction_recovery_basis_unavailable", 409);
    return { runId: created.runId, parentRunId, briefRevision: created.brief.revision,
      fullRerun: true as const, reused: created.reused };
  });
}

/** Resolve an uncertain claimed correction by exact identity; absence withdraws that identity. */
export async function resolveClaimedReportCorrection(pool: pg.Pool, memberAccountId: string,
  parentRunId: string, raw: CorrectionRequest) {
  const parsed = CorrectionRequestSchema.strict().safeParse(raw);
  if (!parsed.success || !parsed.data.patch ||
      !["replace_question", "replace_question_span"].includes(parsed.data.patch.kind) ||
      parsed.data.patch.evidencePolicy !== "refresh" ||
      !z.string().uuid().safeParse(parentRunId).success) deny("invalid_input", 400);
  const { key } = researchCorrectionIdentity(parentRunId, parsed.data);
  return withTx(pool, async (db) => {
    const basis = await claimedActionBasis(db, memberAccountId, parentRunId);
    if (basis.parentBriefRevision !== parsed.data.expectedBriefRevision) deny("stale_revision", 409);
    const hash = admissionKeyHash(key);
    if ((await db.query("SELECT 1 FROM admission_withdrawals WHERE account_id=$1 AND key_hash=$2",
      [memberAccountId,hash])).rowCount) return { status: "withdrawn" as const };
    const run = await findRunByIdempotency(db, memberAccountId, key);
    if (run) {
      if (!await claimedCorrectionProofAllowed(db, { runId: run.id,
        memberAccountId, parentRunId, parentConversationId: basis.guestConversationId,
        bindingId: basis.bindingId, bindingVersion: basis.bindingVersion }) ||
        (await db.query(`SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='run'
          AND object_id=$2 AND reason='source_deletion'`, [memberAccountId,run.id])).rowCount)
        deny("correction_recovery_basis_unavailable", 409);
      return { status: "accepted" as const, run: { runId: run.id, lifecycle: run.lifecycle,
        phase: run.phase, labeledDemo: false } };
    }
    await db.query("INSERT INTO admission_withdrawals(account_id,key_hash) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [memberAccountId,hash]);
    return { status: "withdrawn" as const };
  });
}

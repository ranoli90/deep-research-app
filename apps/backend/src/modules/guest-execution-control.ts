import { CONSENT_POLICY_VERSION, ResearchCorrectionPatchSchema } from "@deep/contracts";
import { z } from "zod";
import type { Queryable } from "../platform/db.js";
import { currentConsent } from "./access.js";
import { researchCorrectionIdentity } from "./research-corrections.js";

const ClaimedCorrectionProof = z.object({
  version: z.literal("research-correction.v1"),
  patch: ResearchCorrectionPatchSchema,
  acceptedText: z.string().min(1).max(20_000),
  expectedBriefRevision: z.number().int().positive(),
  claimedParentRunId: z.string().uuid(),
  claimedParentConversationId: z.string().uuid(),
  claimedControlBindingId: z.string().uuid(),
  claimedControlVersion: z.number().int().positive(),
  originalPendingSubmissionId: z.string().uuid(),
}).strict();

/** Correction children have an exact change-set proof instead of a guest pending-action ID. */
export async function claimedCorrectionProofAllowed(db: Queryable, args: {
  runId: string; memberAccountId: string; parentRunId: string; parentConversationId: string;
  bindingId: string; bindingVersion: number;
}): Promise<boolean> {
  const row = (await db.query<{ patch: unknown; reused_passages: number; reopen_discovery: boolean;
    dependency_completeness: string; idempotency_key: string | null; parent_brief_revision: number;
    original_state: string; original_member_run_id: string | null;
    original_member_conversation_id: string | null; original_binding_id: string | null;
    continuation_parent_run_id: string | null; continuation_binding_id: string | null;
    continuation_version: string | null; continuation_action_id: string | null;
    continuation_account_id: string | null }>(`SELECT c.patch,c.reused_passages,c.reopen_discovery,c.dependency_completeness,
      r.idempotency_key,parent.brief_revision AS parent_brief_revision,
      p.state AS original_state,p.member_run_id AS original_member_run_id,
      p.member_conversation_id AS original_member_conversation_id,
      cr.binding_id AS original_binding_id,
      first_child.claimed_parent_run_id AS continuation_parent_run_id,
      first_child.claimed_control_binding_id AS continuation_binding_id,
      first_child.claimed_control_version AS continuation_version,
      first_child.guest_pending_action_id AS continuation_action_id,
      first_child.account_id AS continuation_account_id
    FROM runs r JOIN research_change_sets c ON c.run_id=r.id AND c.account_id=r.account_id
      AND c.parent_run_id=$3
    JOIN runs parent ON parent.id=c.parent_run_id
    JOIN guest_pending_actions p ON p.submission_id::text=c.patch->>'originalPendingSubmissionId'
    JOIN guest_claim_requests cr ON cr.submission_id=p.submission_id
      AND cr.member_account_id=$2 AND cr.binding_id=$5
    JOIN runs first_child ON first_child.id=p.member_run_id
    WHERE r.id=$1 AND r.account_id=$2 AND r.parent_run_id IS NULL
      AND r.claimed_parent_run_id=$3 AND r.claimed_parent_conversation_id=$4
      AND r.claimed_control_binding_id=$5 AND r.claimed_control_version=$6
      AND r.guest_pending_action_id IS NULL AND p.state='dispatched'
      AND p.member_account_id=$2 AND p.guest_context_id=cr.guest_context_id
      AND p.member_conversation_id=r.conversation_id`,
    [args.runId,args.memberAccountId,args.parentRunId,args.parentConversationId,
      args.bindingId,args.bindingVersion])).rows[0];
  if (!row || row.reused_passages !== 0 || !row.reopen_discovery ||
      row.dependency_completeness !== "unknown" || row.original_state !== "dispatched" ||
      row.original_binding_id !== args.bindingId || !row.original_member_run_id ||
      !row.original_member_conversation_id ||
      row.continuation_parent_run_id !== args.parentRunId ||
      row.continuation_binding_id !== args.bindingId ||
      Number(row.continuation_version) !== args.bindingVersion ||
      row.continuation_action_id === null ||
      row.continuation_account_id !== args.memberAccountId) return false;
  const proof = ClaimedCorrectionProof.safeParse(row.patch);
  if (!proof.success || proof.data.claimedParentRunId !== args.parentRunId ||
      proof.data.claimedParentConversationId !== args.parentConversationId ||
      proof.data.claimedControlBindingId !== args.bindingId ||
      proof.data.claimedControlVersion !== args.bindingVersion ||
      proof.data.expectedBriefRevision !== row.parent_brief_revision ||
      proof.data.originalPendingSubmissionId !== row.continuation_action_id ||
      !["replace_question", "replace_question_span"].includes(proof.data.patch.kind) ||
      proof.data.patch.evidencePolicy !== "refresh") return false;
  const identity = researchCorrectionIdentity(args.parentRunId, {
    patch: proof.data.patch, expectedBriefRevision: proof.data.expectedBriefRevision,
    correctionText: proof.data.acceptedText,
  });
  return row.idempotency_key === identity.key;
}

/** Read-only current control fence for an execution's immutable owner and any exact claim binding. */
export async function guestExecutionAllowed(db: Queryable, runId: string, executionOwnerId: string): Promise<boolean> {
  const run = (await db.query<{ account_id: string; claimed_control_binding_id: string | null;
    claimed_control_version: string | null; claimed_parent_run_id: string | null;
    claimed_parent_conversation_id: string | null; guest_pending_action_id: string | null }>(`SELECT account_id,
      claimed_control_binding_id,claimed_control_version,claimed_parent_run_id,
      claimed_parent_conversation_id,guest_pending_action_id FROM runs WHERE id=$1`, [runId])).rows[0];
  if (!run || run.account_id !== executionOwnerId) return false;
  if ((await db.query(`SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='run'
    AND object_id=$2 AND reason='source_deletion'`, [executionOwnerId, runId])).rowCount) return false;
  const parent = (await db.query<{ guest_context_id: string }>(
    "SELECT guest_context_id FROM guest_first_request_receipts WHERE run_id=$1", [runId])).rows[0];
  if (!parent && !run.claimed_control_binding_id && !run.claimed_parent_run_id && !run.guest_pending_action_id)
    return true;
  const context = (await db.query<{ id: string; status: string; expires_at: Date; proof_digest: string | null;
    control_version: string; execution_owner_account_id: string; guest_deleted_at: Date | null;
    member_account_id: string | null; binding_id: string | null; binding_version: string | null;
    member_deletion_epoch: string | null; member_current_epoch: string | null;
    member_deleted_at: Date | null; binding_revoked_at: Date | null; conversation_id: string }>(`SELECT g.id,g.status,g.expires_at,g.proof_digest,g.control_version,g.conversation_id,
      g.execution_owner_account_id,owner.deleted_at AS guest_deleted_at,
      b.member_account_id,b.id AS binding_id,b.control_version AS binding_version,
      b.member_deletion_epoch,m.deletion_epoch AS member_current_epoch,
      m.deleted_at AS member_deleted_at,b.revoked_at AS binding_revoked_at
      FROM guest_contexts g
      JOIN accounts owner ON owner.id=g.execution_owner_account_id
      LEFT JOIN conversation_control_bindings b ON b.guest_context_id=g.id
      LEFT JOIN accounts m ON m.id=b.member_account_id
      WHERE g.id=$1`, [parent?.guest_context_id ?? (await db.query<{ guest_context_id: string }>(
        "SELECT guest_context_id FROM conversation_control_bindings WHERE id=$1",
        [run.claimed_control_binding_id])).rows[0]?.guest_context_id ?? null])).rows[0];
  if (!context || context.guest_deleted_at || context.status === "deleted" || context.status === "expired") return false;
  if (run.claimed_parent_run_id && (await db.query(`SELECT 1 FROM tombstones WHERE account_id=$1
    AND object_kind='run' AND object_id=$2 AND reason='source_deletion'`,
    [context.execution_owner_account_id, run.claimed_parent_run_id])).rowCount) return false;
  if ((await db.query(`SELECT 1 FROM guest_control_tombstones WHERE guest_context_id=$1
    AND reason IN ('expired','guest_deleted','member_deletion','member_revoked','consent_revoked') LIMIT 1`,
    [context.id])).rowCount) return false;
  const consent = await currentConsent(db, context.execution_owner_account_id);
  if (!consent || consent.revoked || consent.policyVersion !== CONSENT_POLICY_VERSION) return false;
  if (context.status === "active") {
    return Boolean(parent && context.proof_digest && context.expires_at > new Date() &&
      context.execution_owner_account_id === executionOwnerId);
  }
  if (context.status !== "claimed" || !context.binding_id || context.binding_revoked_at ||
      context.member_deleted_at || !context.member_account_id ||
      Number(context.control_version) !== Number(context.binding_version) ||
      Number(context.member_deletion_epoch) !== Number(context.member_current_epoch)) return false;
  if (parent) return context.execution_owner_account_id === executionOwnerId;
  if (context.member_account_id !== executionOwnerId ||
      run.claimed_control_binding_id !== context.binding_id ||
      Number(run.claimed_control_version) !== Number(context.binding_version) ||
      !run.claimed_parent_run_id || run.claimed_parent_conversation_id !== context.conversation_id) return false;
  const memberConsent = await currentConsent(db, executionOwnerId);
  if (!memberConsent || memberConsent.revoked || memberConsent.policyVersion !== CONSENT_POLICY_VERSION)
    return false;
  if (!run.guest_pending_action_id) return claimedCorrectionProofAllowed(db, {
    runId, memberAccountId: executionOwnerId, parentRunId: run.claimed_parent_run_id,
    parentConversationId: context.conversation_id, bindingId: context.binding_id,
    bindingVersion: Number(context.binding_version),
  });
  const pending = (await db.query<{ state: string; member_run_id: string | null; member_account_id: string | null }>(
    "SELECT state,member_run_id,member_account_id FROM guest_pending_actions WHERE submission_id=$1",
    [run.guest_pending_action_id])).rows[0];
  return Boolean(pending && pending.state === "dispatched" && pending.member_run_id === runId &&
    pending.member_account_id === executionOwnerId);
}

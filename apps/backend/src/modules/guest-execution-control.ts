import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import type { Queryable } from "../platform/db.js";
import { currentConsent } from "./access.js";

/** Read-only current control fence for an execution's immutable owner and any exact claim binding. */
export async function guestExecutionAllowed(db: Queryable, runId: string, executionOwnerId: string): Promise<boolean> {
  const run = (await db.query<{ account_id: string; claimed_control_binding_id: string | null;
    claimed_control_version: string | null; claimed_parent_run_id: string | null;
    guest_pending_action_id: string | null }>(`SELECT account_id,claimed_control_binding_id,claimed_control_version,
      claimed_parent_run_id,guest_pending_action_id FROM runs WHERE id=$1`, [runId])).rows[0];
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
    member_deleted_at: Date | null; binding_revoked_at: Date | null }>(`SELECT g.id,g.status,g.expires_at,g.proof_digest,g.control_version,
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
      !run.claimed_parent_run_id || !run.guest_pending_action_id) return false;
  const pending = (await db.query<{ state: string; member_run_id: string | null; member_account_id: string | null }>(
    "SELECT state,member_run_id,member_account_id FROM guest_pending_actions WHERE submission_id=$1",
    [run.guest_pending_action_id])).rows[0];
  return Boolean(pending && pending.state === "dispatched" && pending.member_run_id === runId &&
    pending.member_account_id === executionOwnerId);
}

import { createHash, randomBytes } from "node:crypto";
import { CONSENT_POLICY_VERSION, PROCESSOR_DISCLOSURE } from "@deep/contracts";
import { withTx, type Queryable } from "../platform/db.js";
import pg from "pg";

export class AccountUnavailable extends Error {
  readonly statusCode = 401;
  constructor() { super("Sign in required."); }
}

/** Hold until the caller commits; deletion uses this same lock before scrubbing content. */
export async function lockActiveAccount(db: pg.PoolClient, accountId: string): Promise<void> {
  const row = await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [accountId]);
  if (!row.rows[0]) throw new AccountUnavailable();
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createDevSession(db: Queryable, email?: string): Promise<{ accountId: string; token: string }> {
  const accountId = crypto.randomUUID();
  const token = `dev_${randomBytes(24).toString("hex")}`;
  await db.query(`INSERT INTO accounts (id, email) VALUES ($1, $2)`, [accountId, email ?? `dev-${accountId.slice(0, 8)}@localhost`]);
  await db.query(
    `INSERT INTO sessions (account_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '7 days')`,
    [accountId, hashToken(token)],
  );
  await db.query(
    `INSERT INTO allowance_accounts (account_id, limit_micro) VALUES ($1, $2)`,
    [accountId, 10_000_000],
  );
  return { accountId, token };
}

export async function accountFromBearer(db: Queryable, header: string | undefined): Promise<{
  accountId: string;
  deleted: boolean;
  deletionEpoch: number;
} | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  const row = await db.query<{ account_id: string; deleted_at: Date | null; deletion_epoch: string }>(
    `SELECT a.id AS account_id, a.deleted_at, a.deletion_epoch
     FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const r = row.rows[0];
  if (!r) return null;
  return { accountId: r.account_id, deleted: Boolean(r.deleted_at), deletionEpoch: Number(r.deletion_epoch) };
}

export async function currentConsent(db: Queryable, accountId: string): Promise<{ epoch: number; revoked: boolean; policyVersion: string } | null> {
  const res = await db.query<{ consent_epoch: string; revoked_at: Date | null; policy_version: string }>(
    `SELECT consent_epoch, revoked_at, policy_version FROM consent_records
     WHERE account_id = $1 ORDER BY consent_epoch DESC LIMIT 1`,
    [accountId],
  );
  const r = res.rows[0];
  if (!r) return null;
  return { epoch: Number(r.consent_epoch), revoked: Boolean(r.revoked_at), policyVersion: r.policy_version };
}

export async function grantConsent(db: Queryable, accountId: string): Promise<{ epoch: number; processors: string[] }> {
  if (db instanceof pg.Pool) return withTx(db, (client) => grantConsent(client, accountId));
  const account = await db.query("SELECT id FROM accounts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [accountId]);
  if (!account.rows[0]) throw new Error("account unavailable");
  const prev = await currentConsent(db, accountId);
  const epoch = (prev?.epoch ?? 0) + 1;
  await db.query(
    `INSERT INTO consent_records (account_id, policy_version, processors, consent_epoch)
     VALUES ($1, $2, $3, $4)`,
    [accountId, CONSENT_POLICY_VERSION, JSON.stringify(PROCESSOR_DISCLOSURE), epoch],
  );
  return { epoch, processors: [...PROCESSOR_DISCLOSURE] };
}

export async function revokeConsent(db: Queryable, accountId: string): Promise<number> {
  if (db instanceof pg.Pool) return withTx(db, (client) => revokeConsent(client, accountId));
  await db.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [accountId]);
  const prev = await currentConsent(db, accountId);
  const epoch = (prev?.epoch ?? 0) + 1;
  await db.query(
    `INSERT INTO consent_records (account_id, policy_version, processors, consent_epoch, revoked_at)
     VALUES ($1, $2, $3, $4, now())`,
    [accountId, CONSENT_POLICY_VERSION, JSON.stringify(PROCESSOR_DISCLOSURE), epoch],
  );
  // In-flight workers loaded the previous epoch; bump the run fence so late publication is consent_revoked.
  await db.query(
    `UPDATE runs SET consent_epoch = $2, updated_at = now()
     WHERE account_id = $1 AND lifecycle <> 'terminal'`,
    [accountId, epoch],
  );
  return epoch;
}

export async function consentAllowsProcessing(db: Queryable, accountId: string): Promise<boolean> {
  const c = await currentConsent(db, accountId);
  return Boolean(c && !c.revoked);
}

export async function deleteAccount(db: Queryable, accountId: string): Promise<void> {
  if (db instanceof pg.Pool) return withTx(db, (client) => deleteAccount(client, accountId));
  const account = await db.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [accountId]);
  if (!account.rows[0]) return;
  await db.query(`UPDATE accounts SET email=NULL, deleted_at = COALESCE(deleted_at,now()),
    deletion_epoch = deletion_epoch + CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END WHERE id = $1`, [accountId]);
  // Serialize with the worker's account -> run lock order before removing derived content.
  await db.query("SELECT id FROM runs WHERE account_id=$1 ORDER BY id FOR UPDATE", [accountId]);
  await db.query(`INSERT INTO file_deletion_outbox (attachment_id,account_id,storage_ptr)
    SELECT id,account_id,storage_ptr FROM attachments WHERE account_id=$1
      AND storage_ptr <> '' AND storage_ptr NOT LIKE 'db:%' ON CONFLICT DO NOTHING`, [accountId]);
  await db.query("DELETE FROM selection_inventory_checks WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM evidence_selections WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM query_authorizations WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM source_origin_links WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM criterion_freshness_policies WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM document_web_reconciliations WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM search_coverage WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM run_evidence_membership WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM research_change_sets WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM requested_verifications WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM counterevidence_checks WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM source_read_operations WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM search_operations WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM calculated_report_coverage WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM research_drafts WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM calculation_plans WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM calculation_claims WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM evidence_calculations WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM scope_comparisons WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM research_coverage WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM scoped_support_results WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM extracted_assertions WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM research_tasks WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM model_operation_attempts WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM model_operation_results WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM model_portfolio_resolutions WHERE account_id=$1", [accountId]);
  await db.query(`DELETE FROM extraction_receipts WHERE account_id = $1`, [accountId]);
  await db.query(`DELETE FROM evidence_artifacts WHERE account_id = $1`, [accountId]);
  await db.query(`DELETE FROM support_assessments WHERE account_id = $1`, [accountId]);
  await db.query(`DELETE FROM report_derivations WHERE account_id = $1`, [accountId]);
  await db.query(`DELETE FROM claim_revisions WHERE account_id = $1`, [accountId]);
  await db.query(`DELETE FROM claim_evidence WHERE claim_id IN (SELECT id FROM claims WHERE account_id = $1)`, [accountId]);
  await db.query(`UPDATE claims SET text = '[deleted]', support_status = 'unverified' WHERE account_id = $1`, [accountId]);
  for (const table of ["checkpoints", "coverage_items", "evidence_gaps", "candidates", "research_contradictions",
    "research_calculations", "research_disconfirmations", "notification_fanout", "completion_outbox", "run_dispatch_outbox"]) {
    await db.query(`DELETE FROM ${table} WHERE run_id IN (SELECT id FROM runs WHERE account_id=$1)`, [accountId]);
  }
  await db.query("DELETE FROM challenges WHERE account_id=$1", [accountId]);
  await db.query("DELETE FROM run_events WHERE account_id=$1", [accountId]);
  await db.query("UPDATE research_briefs SET original_question='[deleted]',payload='{}'::jsonb WHERE account_id=$1", [accountId]);
  await db.query("UPDATE conversations SET title=NULL WHERE account_id=$1", [accountId]);
  await db.query(`UPDATE runs SET controller_artifacts='{}'::jsonb,request_digest=NULL,idempotency_key=NULL WHERE account_id=$1`, [accountId]);
  // Keep the amount/state and opaque receipt identity needed to reconcile already-issued spend.
  // Historical request_digest/logical_key fields sometimes contained literal questions.
  await db.query(`UPDATE provider_intents SET request_digest='[deleted]' WHERE run_id IN (SELECT id FROM runs WHERE account_id=$1)`, [accountId]);
  await db.query(`UPDATE run_actions SET request_digest='[deleted]',logical_key=id::text WHERE run_id IN (SELECT id FROM runs WHERE account_id=$1)`, [accountId]);
  await db.query(`UPDATE sources SET canonical_locator='[deleted]',original_locator='[deleted]',publisher=NULL,
    title='[deleted]',language=NULL,origin_cluster=NULL,origin_relation=NULL,publication_date=NULL,population=NULL,rights_class=NULL WHERE account_id=$1`, [accountId]);
  await db.query(`UPDATE source_versions SET final_locator='[deleted]',content_hash=NULL,mime=NULL,
    quality_warnings='[]'::jsonb,text_coverage=NULL,artifact_ptr=NULL WHERE account_id=$1`, [accountId]);
  await db.query(
    `UPDATE runs SET lifecycle = 'cancelling', cancellation_epoch = cancellation_epoch + 1, updated_at = now()
     WHERE account_id = $1 AND lifecycle <> 'terminal'`,
    [accountId],
  );
  await db.query(
    `UPDATE passages SET exact_text = '[deleted]',locator='{}'::jsonb,content_hash='[deleted]' WHERE account_id = $1`,
    [accountId],
  );
  await db.query(
    `UPDATE reports SET
       blocks = '[]'::jsonb,
       basis = '{}'::jsonb,
       claim_ids = '{}',
       change_summary = NULL,
       source_access_summary = '[]'::jsonb,
       redacted_at = now(),
       limitations = '["private content deleted"]'::jsonb
     WHERE account_id = $1`,
    [accountId],
  );
  await db.query(
    `UPDATE attachments SET deleted_at = COALESCE(deleted_at,now()), filename='[deleted]',storage_ptr='',sha256=NULL,
      raw_bytes=NULL,extraction=NULL,extracted_text = NULL, processing_state = 'deleted' WHERE account_id = $1`,
    [accountId],
  );
  await db.query(
    `INSERT INTO tombstones (account_id, object_kind, object_id, reason)
     SELECT $1, 'account', $1, 'account_deletion'
     WHERE NOT EXISTS (SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='account')`,
    [accountId],
  );
  await db.query(`DELETE FROM sessions WHERE account_id = $1`, [accountId]);
  await db.query("UPDATE accounts SET deletion_cleanup_version=1 WHERE id=$1", [accountId]);
}

/** Resumable upgrade/restore replay. Version advances only in the same transaction as the full purge. */
export async function repairPendingDeletions(pool: pg.Pool, limit = 20): Promise<void> {
  const pending = await pool.query<{ id: string }>(`SELECT id FROM accounts WHERE deleted_at IS NOT NULL
    AND deletion_cleanup_version < 1 ORDER BY id LIMIT $1`, [limit]);
  for (const row of pending.rows) await deleteAccount(pool, row.id);
}

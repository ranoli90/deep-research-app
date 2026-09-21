import type pg from "pg";
import { admissionKeyHash } from "./admission-recovery.js";
import { settleRun } from "./billing.js";

/** Caller holds guest and all bound-member account locks in UUID order. */
export async function redactClaimedDescendantsForGuestDeletion(db: pg.PoolClient,
  guestAccountId: string, boundMemberIds: string[]): Promise<string[]> {
  // A challenge is member-owned feedback but may contain a copied guest answer.
  // Remove it even if no child run survived to this point.
  await db.query(`DELETE FROM challenges WHERE report_id IN
    (SELECT id FROM reports WHERE account_id=$1)`, [guestAccountId]);
  if (!boundMemberIds.length) return [];
  const affected = (await db.query<{ id: string; account_id: string; spent_micro: string;
    idempotency_key: string | null }>(`WITH RECURSIVE affected(id) AS (
      SELECT child.id FROM runs child
      JOIN guest_first_request_receipts first ON first.run_id=child.claimed_parent_run_id
      JOIN guest_contexts g ON g.id=first.guest_context_id
      WHERE g.execution_owner_account_id=$1 AND child.account_id=ANY($2::uuid[])
      UNION
      SELECT child.id FROM runs child JOIN affected parent ON
        (child.parent_run_id=parent.id OR child.claimed_parent_run_id=parent.id)
      WHERE child.account_id=ANY($2::uuid[]))
      SELECT r.id,r.account_id,r.spent_micro,r.idempotency_key FROM runs r
      JOIN affected a ON a.id=r.id ORDER BY r.id FOR UPDATE OF r`,
    [guestAccountId,boundMemberIds])).rows;
  const runIds = affected.map((run) => run.id);
  if (!runIds.length) return [];
  for (const ownerId of [...new Set(affected.map((run) => run.account_id))]) {
    const owned = affected.filter((run) => run.account_id === ownerId).map((run) => run.id);
    await db.query(`INSERT INTO tombstones(account_id,object_kind,object_id,reason)
      SELECT $1,'run',objects.object_id,'source_deletion' FROM unnest($2::uuid[]) AS objects(object_id)
      WHERE NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.account_id=$1 AND t.object_kind='run'
        AND t.object_id=objects.object_id AND t.reason='source_deletion')`, [ownerId,owned]);
  }
  for (const run of affected) if (run.idempotency_key)
    await db.query(`INSERT INTO admission_withdrawals(account_id,key_hash) VALUES($1,$2)
      ON CONFLICT DO NOTHING`, [run.account_id,admissionKeyHash(run.idempotency_key)]);
  const versions = (await db.query<{ id: string }>(`SELECT v.id FROM source_versions v JOIN sources s
    ON s.id=v.source_id WHERE s.account_id=ANY($1::uuid[]) AND s.run_id=ANY($2::uuid[])`,
    [boundMemberIds,runIds])).rows.map((row) => row.id);
  await db.query(`UPDATE runs SET lifecycle='terminal',terminal_outcome='cancelled',
    cancellation_epoch=cancellation_epoch+1,worker_lease_fence=worker_lease_fence+1,
    evidence_revision=evidence_revision+1,controller_artifacts='{}',request_digest=NULL,
    idempotency_key=NULL,pending_input_id=NULL,pending_input_type=NULL,
    pending_input_revision=NULL,pending_input_field=NULL,updated_at=now()
    WHERE account_id=ANY($1::uuid[]) AND id=ANY($2::uuid[])`, [boundMemberIds,runIds]);
  await db.query("DELETE FROM run_leases WHERE run_id=ANY($1::uuid[])", [runIds]);
  await db.query(`DELETE FROM run_evidence_membership WHERE account_id=ANY($1::uuid[])
    AND (run_id=ANY($2::uuid[]) OR source_version_id=ANY($3::uuid[]))`,
    [boundMemberIds,runIds,versions]);
  for (const table of ["source_policy_exclusions","research_iteration_actions","query_authorizations",
    "source_origin_links","criterion_freshness_policies","document_web_reconciliations","search_coverage",
    "selection_inventory_checks","evidence_selections","requested_verifications","research_change_sets",
    "conclusion_challenges","research_evidence_needs","candidate_ledgers","counterevidence_checks",
    "source_read_operations","search_operations","calculated_report_coverage","research_drafts",
    "calculation_plans","calculation_claims","evidence_calculations","scope_comparisons",
    "research_coverage","scoped_support_results","extracted_assertions","research_tasks",
    "model_operation_routes","model_operation_attempts","model_operation_results",
    "model_portfolio_resolutions","support_assessments","report_derivations","claim_revisions"])
    await db.query(`DELETE FROM ${table} WHERE account_id=ANY($1::uuid[]) AND run_id=ANY($2::uuid[])`,
      [boundMemberIds,runIds]);
  await db.query(`DELETE FROM claim_evidence WHERE claim_id IN
    (SELECT id FROM claims WHERE account_id=ANY($1::uuid[]) AND run_id=ANY($2::uuid[]))`,
    [boundMemberIds,runIds]);
  await db.query(`UPDATE claims SET text='[deleted]',support_status='unverified'
    WHERE account_id=ANY($1::uuid[]) AND run_id=ANY($2::uuid[])`, [boundMemberIds,runIds]);
  for (const table of ["checkpoints","coverage_items","evidence_gaps","candidates",
    "research_contradictions","research_calculations","research_disconfirmations",
    "notification_fanout","completion_outbox","run_dispatch_outbox"])
    await db.query(`DELETE FROM ${table} WHERE run_id=ANY($1::uuid[])`, [runIds]);
  await db.query(`DELETE FROM challenges WHERE report_id IN
    (SELECT id FROM reports WHERE run_id=ANY($1::uuid[]))`, [runIds]);
  await db.query(`DELETE FROM run_events WHERE account_id=ANY($1::uuid[]) AND run_id=ANY($2::uuid[])`,
    [boundMemberIds,runIds]);
  await db.query(`UPDATE reports SET blocks='[]',basis='{}',claim_ids='{}',change_summary=NULL,
    source_access_summary='[]',redacted_at=now(),limitations='["Private source deleted"]'
    WHERE account_id=ANY($1::uuid[]) AND run_id=ANY($2::uuid[])`, [boundMemberIds,runIds]);
  await db.query(`UPDATE research_briefs SET original_question='[deleted]',payload='{}'
    WHERE account_id=ANY($1::uuid[]) AND id IN
      (SELECT brief_id FROM runs WHERE id=ANY($2::uuid[]))`, [boundMemberIds,runIds]);
  await db.query(`UPDATE conversations SET title=NULL WHERE account_id=ANY($1::uuid[]) AND id IN
    (SELECT conversation_id FROM runs WHERE id=ANY($2::uuid[]))`, [boundMemberIds,runIds]);
  await db.query(`UPDATE provider_intents SET request_digest=CASE WHEN request_digest ~ '^[0-9a-f]{64}$'
    THEN request_digest ELSE '[deleted]' END WHERE run_id=ANY($1::uuid[])`, [runIds]);
  await db.query(`UPDATE run_actions SET request_digest=CASE WHEN request_digest ~ '^[0-9a-f]{64}$'
    THEN request_digest ELSE '[deleted]' END,logical_key=id::text WHERE run_id=ANY($1::uuid[])`, [runIds]);
  await db.query(`DELETE FROM extraction_receipts WHERE account_id=ANY($1::uuid[])
    AND (run_id=ANY($2::uuid[]) OR source_version_id=ANY($3::uuid[]))`,
    [boundMemberIds,runIds,versions]);
  await db.query(`UPDATE evidence_artifacts SET body='\\x'::bytea,digest='[deleted]'
    WHERE account_id=ANY($1::uuid[]) AND run_id=ANY($2::uuid[])`, [boundMemberIds,runIds]);
  await db.query(`UPDATE passages SET exact_text='[deleted]',locator='{}',content_hash='[deleted]',
    extraction_method='deleted' WHERE account_id=ANY($1::uuid[])
    AND source_version_id=ANY($2::uuid[])`, [boundMemberIds,versions]);
  await db.query(`UPDATE source_versions SET final_locator='[deleted]',content_hash=NULL,mime=NULL,
    access_level='blocked',quality_warnings='[]',text_coverage=NULL,artifact_ptr=NULL,
    effective_date=NULL,applicable_version=NULL WHERE account_id=ANY($1::uuid[]) AND id=ANY($2::uuid[])`,
    [boundMemberIds,versions]);
  await db.query(`UPDATE sources SET canonical_locator='[deleted]',original_locator='[deleted]',
    publisher=NULL,title='[deleted]',source_type='deleted',language=NULL,origin_cluster=NULL,
    origin_relation=NULL,publication_date=NULL,population=NULL,rights_class=NULL
    WHERE account_id=ANY($1::uuid[]) AND run_id=ANY($2::uuid[])`, [boundMemberIds,runIds]);
  for (const run of affected) await settleRun(db,run.account_id,run.id,Number(run.spent_micro));
  return runIds;
}

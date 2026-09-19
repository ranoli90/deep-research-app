import type pg from "pg";
import { z } from "zod";
import { withTx } from "../platform/db.js";
import { lockActiveAccount } from "./access.js";
import { admissionKeyHash } from "./admission-recovery.js";
import { settleRun } from "./billing.js";

/** Source removal is an account-serialized privacy mutation, never a new research action. */
export async function deleteSourceForAccount(pool:pg.Pool,accountId:string,sourceId:string) {
 if(!z.string().uuid().safeParse(sourceId).success)throw Object.assign(new Error("source_unavailable"),{statusCode:404});
 return withTx(pool,async db=>{
  await lockActiveAccount(db,accountId);
  const source=(await db.query<{canonical_locator:string}>("SELECT canonical_locator FROM sources WHERE id=$1 AND account_id=$2",[sourceId,accountId])).rows[0];
  if(!source)throw Object.assign(new Error("source_unavailable"),{statusCode:404});
  const removed=await db.query("SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='source' AND object_id=$2 AND reason='source_deletion'",[accountId,sourceId]);
  if(removed.rowCount)return {deleted:true as const,sourceId,alreadyDeleted:true,invalidatedRunIds:[] as string[]};
  const attachmentId=source.canonical_locator.startsWith("attachment://")?source.canonical_locator.slice("attachment://".length):null;
  const attachments=attachmentId&&z.string().uuid().safeParse(attachmentId).success
   ?(await db.query<{id:string}>("SELECT id FROM attachments WHERE id=$1 AND account_id=$2",[attachmentId,accountId])).rows.map(r=>r.id):[];
  // An uploaded document can have independent extraction records in several runs.
  const sourceIds=(await db.query<{id:string}>(`SELECT id FROM sources WHERE account_id=$1 AND
   (id=$2 OR ($3::boolean AND canonical_locator=$4)) ORDER BY id`,[accountId,sourceId,attachments.length>0,source.canonical_locator])).rows.map(r=>r.id);
  const versions=(await db.query<{id:string}>("SELECT id FROM source_versions WHERE account_id=$1 AND source_id=ANY($2::uuid[])",[accountId,sourceIds])).rows.map(r=>r.id);
  const passages=(await db.query<{id:string}>("SELECT id FROM passages WHERE account_id=$1 AND source_version_id=ANY($2::uuid[])",[accountId,versions])).rows.map(r=>r.id);
  // Exact reuse links seed invalidation. Descendants are conservative because copied
  // questions/report comparisons lack a complete dependency graph.
  const affected=(await db.query<{id:string;spent_micro:string;idempotency_key:string|null}>(`WITH RECURSIVE affected(id) AS (
   SELECT r.id FROM runs r JOIN research_briefs b ON b.id=r.brief_id WHERE r.account_id=$1 AND (
    r.id IN(SELECT run_id FROM sources WHERE account_id=$1 AND id=ANY($2::uuid[]))
    OR r.id IN(SELECT run_id FROM run_evidence_membership WHERE account_id=$1 AND source_version_id=ANY($3::uuid[]))
    OR r.id IN(SELECT c.run_id FROM claims c JOIN claim_evidence e ON e.claim_id=c.id WHERE c.account_id=$1 AND e.passage_id=ANY($4::uuid[]))
    OR (b.payload->'attachmentIds') ?| $5::text[])
   UNION SELECT r.id FROM runs r JOIN affected p ON r.parent_run_id=p.id WHERE r.account_id=$1)
   SELECT r.id,r.spent_micro,r.idempotency_key FROM runs r JOIN affected a ON a.id=r.id ORDER BY r.id FOR UPDATE OF r`,[accountId,sourceIds,versions,passages,attachments])).rows;
  const runIds=affected.map(r=>r.id);
  for(const [kind,ids] of [["source",sourceIds],["run",runIds]] as const)await db.query(`INSERT INTO tombstones(account_id,object_kind,object_id,reason)
   SELECT $1,$2,objects.object_id,'source_deletion' FROM unnest($3::uuid[]) AS objects(object_id)
   WHERE NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.account_id=$1 AND t.object_kind=$2 AND t.object_id=objects.object_id AND t.reason='source_deletion')`,[accountId,kind,ids]);
  // Keep only the opaque admission identity before scrubbing run metadata. A
  // delayed client retry must not recreate research invalidated by deletion.
  for (const run of affected) if (run.idempotency_key !== null)
   await db.query("INSERT INTO admission_withdrawals(account_id,key_hash) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [accountId,admissionKeyHash(run.idempotency_key)]);
  await db.query(`UPDATE runs SET lifecycle='terminal',terminal_outcome='cancelled',cancellation_epoch=cancellation_epoch+1,
   worker_lease_fence=worker_lease_fence+1,evidence_revision=evidence_revision+1,controller_artifacts='{}',
   request_digest=NULL,idempotency_key=NULL,updated_at=now() WHERE account_id=$1 AND id=ANY($2::uuid[])`,[accountId,runIds]);
  await db.query("DELETE FROM run_leases WHERE run_id=ANY($1::uuid[])",[runIds]);
  await db.query("DELETE FROM run_evidence_membership WHERE account_id=$1 AND (run_id=ANY($2::uuid[]) OR source_version_id=ANY($3::uuid[]))",[accountId,runIds,versions]);
  for(const table of ["query_authorizations","source_origin_links","criterion_freshness_policies","document_web_reconciliations","search_coverage","selection_inventory_checks","evidence_selections","requested_verifications","research_change_sets","counterevidence_checks","source_read_operations","search_operations","calculated_report_coverage",
   "research_drafts","calculation_plans","calculation_claims","evidence_calculations","scope_comparisons","research_coverage",
   "scoped_support_results","extracted_assertions","research_tasks","model_operation_attempts","model_operation_results","model_portfolio_resolutions","support_assessments","report_derivations","claim_revisions"])
   await db.query(`DELETE FROM ${table} WHERE account_id=$1 AND run_id=ANY($2::uuid[])`,[accountId,runIds]);
  await db.query("DELETE FROM claim_evidence WHERE claim_id IN(SELECT id FROM claims WHERE account_id=$1 AND run_id=ANY($2::uuid[]))",[accountId,runIds]);
  await db.query("UPDATE claims SET text='[deleted]',support_status='unverified' WHERE account_id=$1 AND run_id=ANY($2::uuid[])",[accountId,runIds]);
  for(const table of ["checkpoints","coverage_items","evidence_gaps","candidates","research_contradictions","research_calculations",
   "research_disconfirmations","notification_fanout","completion_outbox","run_dispatch_outbox"])
   await db.query(`DELETE FROM ${table} WHERE run_id=ANY($1::uuid[])`,[runIds]);
  await db.query("DELETE FROM challenges WHERE account_id=$1 AND report_id IN(SELECT id FROM reports WHERE run_id=ANY($2::uuid[]))",[accountId,runIds]);
  await db.query("DELETE FROM run_events WHERE account_id=$1 AND run_id=ANY($2::uuid[])",[accountId,runIds]);
  await db.query(`UPDATE reports SET blocks='[]',basis='{}',claim_ids='{}',change_summary=NULL,source_access_summary='[]',
   redacted_at=now(),limitations='["A source was deleted; dependent research was invalidated."]'
   WHERE account_id=$1 AND run_id=ANY($2::uuid[])`,[accountId,runIds]);
  await db.query(`UPDATE research_briefs SET original_question='[source deleted]',payload='{}'
   WHERE account_id=$1 AND id IN(SELECT brief_id FROM runs WHERE id=ANY($2::uuid[]))`,[accountId,runIds]);
  await db.query("UPDATE conversations SET title=NULL WHERE account_id=$1 AND id IN(SELECT conversation_id FROM runs WHERE id=ANY($2::uuid[]))",[accountId,runIds]);
  // Keep opaque digest identities for actual receipt reconciliation, never old literal queries.
  await db.query(`UPDATE provider_intents SET request_digest=CASE WHEN request_digest ~ '^[0-9a-f]{64}$' THEN request_digest ELSE '[deleted]' END
   WHERE run_id=ANY($1::uuid[])`,[runIds]);
  await db.query(`UPDATE run_actions SET request_digest=CASE WHEN request_digest ~ '^[0-9a-f]{64}$' THEN request_digest ELSE '[deleted]' END,
   logical_key=id::text WHERE run_id=ANY($1::uuid[])`,[runIds]);
  const artifacts=(await db.query<{artifact_id:string}>("SELECT artifact_id FROM extraction_receipts WHERE account_id=$1 AND source_version_id=ANY($2::uuid[]) AND artifact_id IS NOT NULL",[accountId,versions])).rows.map(r=>r.artifact_id);
  await db.query("DELETE FROM extraction_receipts WHERE account_id=$1 AND source_version_id=ANY($2::uuid[])",[accountId,versions]);
  await db.query("DELETE FROM evidence_artifacts WHERE account_id=$1 AND id=ANY($2::uuid[]) AND NOT EXISTS(SELECT 1 FROM extraction_receipts e WHERE e.artifact_id=evidence_artifacts.id)",[accountId,artifacts]);
  await db.query(`UPDATE passages SET exact_text='[deleted]',locator='{}',content_hash='[deleted]',extraction_method='deleted'
   WHERE account_id=$1 AND source_version_id=ANY($2::uuid[])`,[accountId,versions]);
  await db.query(`UPDATE source_versions SET final_locator='[deleted]',content_hash=NULL,mime=NULL,access_level='blocked',
   quality_warnings='[]',text_coverage=NULL,artifact_ptr=NULL WHERE account_id=$1 AND id=ANY($2::uuid[])`,[accountId,versions]);
  await db.query(`UPDATE sources SET canonical_locator='[deleted]',original_locator='[deleted]',publisher=NULL,title='[deleted]',
   source_type='deleted',language=NULL,origin_cluster=NULL,origin_relation=NULL,publication_date=NULL,population=NULL,rights_class=NULL WHERE account_id=$1 AND id=ANY($2::uuid[])`,[accountId,sourceIds]);
  await db.query(`INSERT INTO file_deletion_outbox(attachment_id,account_id,storage_ptr)
   SELECT id,account_id,storage_ptr FROM attachments WHERE account_id=$1 AND id=ANY($2::uuid[]) AND storage_ptr<>'' AND storage_ptr NOT LIKE 'db:%'
   ON CONFLICT DO NOTHING`,[accountId,attachments]);
  await db.query(`UPDATE attachments SET deleted_at=COALESCE(deleted_at,now()),filename='[deleted]',mime='application/octet-stream',size_bytes=0,
   storage_ptr='',sha256=NULL,raw_bytes=NULL,extraction=NULL,extracted_text=NULL,processing_state='deleted' WHERE account_id=$1 AND id=ANY($2::uuid[])`,[accountId,attachments]);
  for(const run of affected)await settleRun(db,accountId,run.id,Number(run.spent_micro));
  return {deleted:true as const,sourceId,alreadyDeleted:false,invalidatedRunIds:runIds};
 });
}

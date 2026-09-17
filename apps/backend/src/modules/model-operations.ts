import type { Queryable } from "../platform/db.js";
import type { ModelContext, PreparedModelRequest, ModelResult } from "../ports/model.js";
import type { ResearchModelOperation } from "@deep/contracts";
import { getBrief, getRun } from "./runs.js";

export async function validateOwnedModelContext(db: Queryable, args: {
  runId: string; accountId: string; briefRevision: number; evidenceRevision: number; context: ModelContext;
}): Promise<void> {
  const run = await getRun(db, args.runId);
  if (!run || run.account_id !== args.accountId || run.brief_revision !== args.briefRevision || run.evidence_revision !== args.evidenceRevision) throw new Error("stale_model_context");
  const brief = await getBrief(db, run.brief_id);
  if (!brief || brief.originalQuestion !== args.context.question) throw new Error("model_question_mismatch");
  for (const p of args.context.passages) {
    const row = await db.query(`SELECT p.id FROM passages p JOIN source_versions v ON v.id=p.source_version_id
      JOIN sources s ON s.id=v.source_id
      WHERE p.id=$1 AND p.account_id=$2 AND p.run_id=$3 AND p.source_version_id=$4 AND p.content_hash=$5 AND p.exact_text=$6
      AND v.account_id=$2 AND s.account_id=$2 AND s.run_id=$3 AND v.access_level=$7`,
      [p.id, args.accountId, args.runId, p.sourceVersionId, p.digest, p.text, p.accessLevel]);
    if (row.rowCount !== 1) throw new Error("model_evidence_owner_or_version_mismatch");
  }
  for (const source of args.context.sources) {
    const row = await db.query("SELECT id FROM sources WHERE id::text=$1 AND account_id=$2 AND run_id=$3 AND title=$4",
      [source.handle, args.accountId, args.runId, source.title]);
    if (row.rowCount !== 1) throw new Error("model_source_owner_mismatch");
  }
}
export async function saveModelOperation<K extends ResearchModelOperation>(db: Queryable, args: {
  intentId: string; runId: string; accountId: string; briefRevision: number; evidenceRevision: number;
  request: PreparedModelRequest<K>; result: ModelResult<K>;
}): Promise<void> {
  const run = await getRun(db, args.runId);
  if (!run || run.account_id !== args.accountId || run.brief_revision !== args.briefRevision || run.evidence_revision !== args.evidenceRevision) throw new Error("stale_model_context");
  const intent = await db.query("SELECT id FROM provider_intents WHERE id=$1 AND run_id=$2 AND request_digest=$3", [args.intentId,args.runId,args.request.digest]);
  if (intent.rowCount !== 1) throw new Error("model_intent_owner_mismatch");
  await db.query(`INSERT INTO model_operation_results(intent_id,run_id,account_id,operation,brief_revision,evidence_revision,request_digest,schema_version,prompt_version,policy_id,result)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [args.intentId,args.runId,args.accountId,args.request.operation,args.briefRevision,args.evidenceRevision,
    args.request.digest,args.request.schemaVersion,args.request.promptVersion,args.request.policyId,JSON.stringify(args.result)]);
}
export async function loadModelOperation(db: Queryable, intentId: string, runId: string, accountId: string, digest: string): Promise<unknown | null> {
  const result = await db.query<{ result: unknown; receipt_matches: boolean }>("SELECT m.result, (m.result->'receipt'=i.receipt) AS receipt_matches FROM model_operation_results m JOIN provider_intents i ON i.id=m.intent_id WHERE m.intent_id=$1 AND m.run_id=$2 AND m.account_id=$3 AND m.request_digest=$4", [intentId,runId,accountId,digest]);
  if (result.rows[0] && !result.rows[0].receipt_matches) return { status: "invalid_stored_receipt" };
  return result.rows[0]?.result ?? null;
}

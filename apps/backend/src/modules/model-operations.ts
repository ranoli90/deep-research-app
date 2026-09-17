import { compareAssertionScopes, projectScopeComparison } from "@deep/research-core";
import { createHash } from "node:crypto";
import type { Queryable } from "../platform/db.js";
import type { ModelContext, PreparedModelRequest, ModelResult } from "../ports/model.js";
import type { ResearchModelOperation } from "@deep/contracts";
import { getBrief, getRun } from "./runs.js";

export async function validateOwnedModelContext(db: Queryable, args: {
  runId: string; accountId: string; briefRevision: number; evidenceRevision: number; context: ModelContext;
}): Promise<void> {
  const run = await getRun(db, args.runId);
  if (!run || run.account_id !== args.accountId || run.brief_revision !== args.briefRevision || run.evidence_revision !== args.evidenceRevision) throw new Error("stale_model_context");
  if(args.context.scopeComparison) {
    const computed=compareAssertionScopes({type:"compare_scopes",claimKeys:args.context.assertions.map(a=>a.key)},args.context.assertions);
    const expected=args.context.scopeComparison.version==="scope-comparison-context.v1"?projectScopeComparison(computed,args.context.assertions):computed;
    if(JSON.stringify(expected)!==JSON.stringify(args.context.scopeComparison))throw new Error("model_scope_comparison_mismatch");
  }
  const brief = await getBrief(db, run.brief_id);
  if (!brief || brief.originalQuestion !== args.context.question) throw new Error("model_question_mismatch");
  for (const p of args.context.passages) {
    if (createHash("sha256").update(p.text).digest("hex") !== p.digest) throw new Error("model_evidence_digest_mismatch");
    const row = await db.query(`SELECT p.id FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id
      JOIN sources s ON s.id=v.source_id
      WHERE p.id=$1 AND p.account_id=$2 AND p.run_id=$3 AND p.source_version_id=$4 AND p.content_hash=$5 AND p.exact_text=$6
      AND v.account_id=$2 AND s.account_id=$2 AND v.access_level=$7`,
      [p.id, args.accountId, args.runId, p.sourceVersionId, p.digest, p.text, p.accessLevel]);
    if (row.rowCount !== 1) throw new Error("model_evidence_owner_or_version_mismatch");
  }
  for (const source of args.context.sources) {
    const row = await db.query("SELECT s.id FROM sources s WHERE s.id::text=$1 AND s.account_id=$2 AND s.title=$4 AND (s.run_id=$3 OR EXISTS(SELECT 1 FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id WHERE p.run_id=$3 AND p.account_id=$2 AND v.source_id=s.id))",
      [source.handle, args.accountId, args.runId, source.title]);
    if (row.rowCount !== 1) throw new Error("model_source_owner_mismatch");
  }
}
export async function saveModelOperation<K extends ResearchModelOperation>(db: Queryable, args: {
  intentId: string; runId: string; accountId: string; briefRevision: number; evidenceRevision: number;
  request: PreparedModelRequest<K>; result: ModelResult<K>; context: ModelContext;
}): Promise<void> {
  const run = await getRun(db, args.runId);
  if (!run || run.account_id !== args.accountId || run.brief_revision !== args.briefRevision || run.evidence_revision !== args.evidenceRevision) throw new Error("stale_model_context");
  const intent = await db.query("SELECT id FROM provider_intents WHERE id=$1 AND run_id=$2 AND request_digest=$3", [args.intentId,args.runId,args.request.digest]);
  if (intent.rowCount !== 1) throw new Error("model_intent_owner_mismatch");
  await db.query(`INSERT INTO model_operation_results(intent_id,run_id,account_id,operation,brief_revision,evidence_revision,request_digest,schema_version,prompt_version,policy_id,result,input_manifest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [args.intentId,args.runId,args.accountId,args.request.operation,args.briefRevision,args.evidenceRevision,
    args.request.digest,args.request.schemaVersion,args.request.promptVersion,args.request.policyId,JSON.stringify(args.result),JSON.stringify(modelInputManifest(args.context))]);
}
export async function loadModelOperation(db: Queryable, intentId: string, runId: string, accountId: string, digest: string, context: ModelContext): Promise<unknown | null> {
  const result = await db.query<{ result: unknown; receipt_matches: boolean }>("SELECT m.result, (m.result->'receipt'=i.receipt AND i.request_digest=m.request_digest AND i.run_id=m.run_id AND m.input_manifest=$5::jsonb) AS receipt_matches FROM model_operation_results m JOIN provider_intents i ON i.id=m.intent_id WHERE m.intent_id=$1 AND m.run_id=$2 AND m.account_id=$3 AND m.request_digest=$4", [intentId,runId,accountId,digest,JSON.stringify(modelInputManifest(context))]);
  if (result.rows[0] && !result.rows[0].receipt_matches) return { status: "invalid_stored_receipt" };
  return result.rows[0]?.result ?? null;
}

/** Metadata only: exact selected membership, never a claim of full-document coverage. */
export function modelInputManifest(context: ModelContext) {
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return { version:context.scopeComparison?.version==="scope-comparison-context.v1"?"model-input.v3":context.scopeComparison?"model-input.v2":"model-input.v1", questionDigest:digest(context.question), taskDigest:digest(context.task),
    passages:context.passages.map(({ id,sourceVersionId,digest,accessLevel }) => ({ id,sourceVersionId,digest,accessLevel })),
    sourceHandles:context.sources.map((s) => s.handle), assertionsDigest:digest(context.assertions),
    approvedClaimKeys:context.approvedClaimKeys, draftDigest:digest(context.draft),
    ...(context.scopeComparison?{scopeComparisonDigest:digest(context.scopeComparison)}:{}) };
}

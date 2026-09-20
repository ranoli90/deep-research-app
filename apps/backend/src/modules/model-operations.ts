import { validateSelectionContext } from "./evidence-selections.js";
import { calculationWriterContext } from "./calculation-plans.js";
import { compareAssertionScopes, projectScopeComparison } from "@deep/research-core";
import { createHash } from "node:crypto";
import type { Queryable } from "../platform/db.js";
import { briefPlanningState, type ModelContext, type PreparedModelRequest, type ModelResult } from "../ports/model.js";
import { ConstraintSchema, type ResearchModelOperation } from "@deep/contracts";
import { getBrief, getRun } from "./runs.js";

export async function validateOwnedModelContext(db: Queryable, args: {
  runId: string; accountId: string; briefRevision: number; evidenceRevision: number; context: ModelContext;
  historical?: boolean;
}): Promise<void> {
  const run = await getRun(db, args.runId);
  if (!run || run.account_id !== args.accountId || run.brief_revision !== args.briefRevision) throw new Error("stale_model_context");
  if (args.historical ? run.evidence_revision < args.evidenceRevision : run.evidence_revision !== args.evidenceRevision) throw new Error("stale_model_context");
  if(args.context.evidenceSelection)await validateSelectionContext(db,{...args,selection:args.context.evidenceSelection,passageIds:args.context.passages.map(p=>p.id)});
  if(args.context.scopeComparison) {
    if(args.context.assertions.length<2)throw new Error("model_scope_comparison_mismatch");
    const computed=compareAssertionScopes({type:"compare_scopes",claimKeys:args.context.assertions.map(a=>a.key)},args.context.assertions);
    const expected=args.context.scopeComparison.version==="scope-comparison-context.v1"?projectScopeComparison(computed,args.context.assertions):computed;
    if(JSON.stringify(expected)!==JSON.stringify(args.context.scopeComparison))throw new Error("model_scope_comparison_mismatch");
  }
  if(args.context.calculations) {
    const saved=await calculationWriterContext(db,{...args,planIntentId:args.context.calculations.planIntentId});
    const normalized={...args.context.calculations,entries:args.context.calculations.entries.map(e=>({...e,selected:false}))};
    if(JSON.stringify(saved)!==JSON.stringify(normalized))throw new Error("model_calculation_context_mismatch");
  }
  const brief = await getBrief(db, run.brief_id);
  if (!brief || brief.originalQuestion !== args.context.question) throw new Error("model_question_mismatch");
  if (args.context.planningState && JSON.stringify(briefPlanningState(brief)) !== JSON.stringify(args.context.planningState)) throw new Error("model_planning_state_mismatch");
  if (args.context.confirmedConstraints !== undefined) {
    const identity = (rows: unknown) => JSON.stringify(ConstraintSchema.array().parse(rows ?? []).map((c) => ({
      id: c.id, field: c.field, operator: c.operator, value: c.value, units: c.units ?? null,
      origin: c.origin, importance: c.importance, explanation: c.explanation,
      appliesTo: c.appliesTo ?? null, provenance: c.provenance ?? null,
    })));
    if (identity(brief.constraints.filter((c) => c.origin === "confirmed")) !== identity(args.context.confirmedConstraints)) {
      throw new Error("model_confirmed_constraints_mismatch");
    }
  }
  for (const p of args.context.passages) {
    if (createHash("sha256").update(p.text).digest("hex") !== p.digest) throw new Error("model_evidence_digest_mismatch");
  }
  // Fetch the bounded membership once, then validate every input independently.
  // No cache: each gateway boundary still restores current ownership and content.
  if (args.context.passages.length) {
    const rows = await db.query<ModelContext["passages"][number]>(`SELECT p.id,p.source_version_id AS "sourceVersionId",
      p.content_hash AS digest,p.exact_text AS text,v.access_level AS "accessLevel"
      FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id JOIN sources s ON s.id=v.source_id
      WHERE p.id=ANY($1::uuid[]) AND p.account_id=$2 AND p.run_id=$3 AND v.account_id=$2 AND s.account_id=$2`,
      [args.context.passages.map(p => p.id), args.accountId, args.runId]);
    for (const p of args.context.passages) {
      const matches = rows.rows.filter(row => row.id === p.id.toLowerCase() && row.sourceVersionId === p.sourceVersionId.toLowerCase()
        && row.digest === p.digest && row.text === p.text && row.accessLevel === p.accessLevel);
      if (matches.length !== 1) throw new Error("model_evidence_owner_or_version_mismatch");
    }
  }
  if (args.context.sources.length) {
    const rows = await db.query<{ id: string; title: string }>(`SELECT s.id,s.title FROM sources s
      WHERE s.id::text=ANY($1::text[]) AND s.account_id=$2 AND (s.run_id=$3 OR EXISTS(
        SELECT 1 FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id
        WHERE p.run_id=$3 AND p.account_id=$2 AND v.source_id=s.id))`,
      [args.context.sources.map(source => source.handle), args.accountId, args.runId]);
    for (const source of args.context.sources) {
      if (rows.rows.filter(row => row.id === source.handle && row.title === source.title).length !== 1)
        throw new Error("model_source_owner_mismatch");
    }
  }
}
export async function saveModelOperation<K extends ResearchModelOperation>(db: Queryable, args: {
  intentId: string; runId: string; accountId: string; briefRevision: number; evidenceRevision: number;
  request: PreparedModelRequest<K>; result: ModelResult<K>; context: ModelContext; historical?: boolean;
}): Promise<void> {
  const run = await getRun(db, args.runId);
  if (!run || run.account_id !== args.accountId || run.brief_revision !== args.briefRevision) throw new Error("stale_model_context");
  // Write-from-prior may persist a restored extract snapshot after later unread evidence.
  if (args.historical ? run.evidence_revision < args.evidenceRevision : run.evidence_revision !== args.evidenceRevision) throw new Error("stale_model_context");
  const intent = await db.query("SELECT id FROM provider_intents WHERE id=$1 AND run_id=$2 AND request_digest=$3", [args.intentId,args.runId,args.request.digest]);
  if (intent.rowCount !== 1) throw new Error("model_intent_owner_mismatch");
  await db.query(`INSERT INTO model_operation_results(intent_id,run_id,account_id,operation,brief_revision,evidence_revision,request_digest,schema_version,prompt_version,policy_id,result,input_manifest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [args.intentId,args.runId,args.accountId,args.request.operation,args.briefRevision,args.evidenceRevision,
    args.request.digest,args.request.schemaVersion,args.request.promptVersion,args.request.policyId,JSON.stringify(args.result),JSON.stringify(modelInputManifest(args.context))]);
}
/** Policy-independent identity for one logical model operation. Failover shares it; repairPass does not. */
export function modelOperationLogicalDigest(args: {
  operation: string; context: ModelContext; briefRevision: number; evidenceRevision: number;
  schemaVersion: string; promptVersion: string; repairPass?: number;
}): string {
  return createHash("sha256").update(JSON.stringify({
    operation: args.operation, manifest: modelInputManifest(args.context),
    brief: args.briefRevision, evidence: args.evidenceRevision, repairPass: args.repairPass ?? 0,
    schema: args.schemaVersion, prompt: args.promptVersion,
  })).digest("hex");
}

export async function recordModelOperationAttempt(db: Queryable, args: {
  intentId: string; runId: string; accountId: string; logicalDigest: string; attemptIndex: number;
  predecessorIntentId: string | null; reason: "primary" | "availability_failover";
  requestDigest: string; policyId: string;
}): Promise<void> {
  await db.query(`INSERT INTO model_operation_attempts(
      intent_id,run_id,account_id,logical_digest,attempt_index,predecessor_intent_id,reason,request_digest,policy_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (intent_id) DO NOTHING`,
    [args.intentId,args.runId,args.accountId,args.logicalDigest,args.attemptIndex,args.predecessorIntentId,
      args.reason,args.requestDigest,args.policyId]);
}

export async function loadLatestModelOperationAttempt(db: Queryable, args: {
  runId: string; accountId: string; logicalDigest: string;
}): Promise<{ intentId: string; attemptIndex: number; requestDigest: string; policyId: string; intentState: string } | null> {
  const row = await db.query<{ intentId: string; attemptIndex: number; requestDigest: string; policyId: string; intentState: string }>(
    `SELECT a.intent_id AS "intentId", a.attempt_index AS "attemptIndex", a.request_digest AS "requestDigest",
            a.policy_id AS "policyId", i.state AS "intentState"
     FROM model_operation_attempts a JOIN provider_intents i ON i.id=a.intent_id
     WHERE a.run_id=$1 AND a.account_id=$2 AND a.logical_digest=$3
     ORDER BY a.attempt_index DESC LIMIT 1`, [args.runId, args.accountId, args.logicalDigest]);
  return row.rows[0] ?? null;
}

export async function loadModelOperation(db: Queryable, intentId: string, runId: string, accountId: string, digest: string, context: ModelContext, expected?:Pick<PreparedModelRequest<ResearchModelOperation>,"operation"|"schemaVersion"|"promptVersion"|"policyId">): Promise<unknown | null> {
  const result = await db.query<{ result: unknown; receipt_matches: boolean; operation:string;schema_version:string;prompt_version:string;policy_id:string }>("SELECT m.result,m.operation,m.schema_version,m.prompt_version,m.policy_id, (m.result->'receipt'=i.receipt AND i.request_digest=m.request_digest AND i.run_id=m.run_id AND m.input_manifest=$5::jsonb) AS receipt_matches FROM model_operation_results m JOIN provider_intents i ON i.id=m.intent_id WHERE m.intent_id=$1 AND m.run_id=$2 AND m.account_id=$3 AND m.request_digest=$4", [intentId,runId,accountId,digest,JSON.stringify(modelInputManifest(context))]);
  const row=result.rows[0];
  if(row&&expected&&(row.operation!==expected.operation||row.schema_version!==expected.schemaVersion||row.prompt_version!==expected.promptVersion||row.policy_id!==expected.policyId))return {status:"invalid_stored_request_metadata"};
  if (result.rows[0] && !result.rows[0].receipt_matches) return { status: "invalid_stored_receipt" };
  return result.rows[0]?.result ?? null;
}

/** Metadata only: exact selected membership, never a claim of full-document coverage. */
export function modelInputManifest(context: ModelContext) {
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const confirmed = ConstraintSchema.array().parse(context.confirmedConstraints ?? []);
  return { version:context.sectionWrite?"model-input.v8":context.planningState?"model-input.v7":confirmed.length?"model-input.v6":context.evidenceSelection?"model-input.v5":context.calculations?"model-input.v4":context.scopeComparison?.version==="scope-comparison-context.v1"?"model-input.v3":context.scopeComparison?"model-input.v2":"model-input.v1", questionDigest:digest(context.question), taskDigest:digest(context.task),
    passages:context.passages.map(({ id,sourceVersionId,digest,accessLevel }) => ({ id,sourceVersionId,digest,accessLevel })),
    sourceHandles:context.sources.map((s) => s.handle), assertionsDigest:digest(context.assertions),
    approvedClaimKeys:context.approvedClaimKeys, draftDigest:digest(context.draft),
    ...(confirmed.length?{confirmedConstraintsDigest:digest(confirmed)}:{}),
    ...(context.planningState?{planningStateDigest:digest(context.planningState)}:{}),
    ...(context.evidenceSelection?{evidenceSelection:context.evidenceSelection}:{}),
    ...(context.scopeComparison?{scopeComparisonDigest:digest(context.scopeComparison)}:{}),
    ...(context.calculations?{calculationsDigest:digest(context.calculations)}:{}),
    ...(context.sectionWrite?{sectionWriteDigest:digest(context.sectionWrite),sectionWrite:context.sectionWrite}:{}) };
}

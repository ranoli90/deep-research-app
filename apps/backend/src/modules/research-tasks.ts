import { createHash } from "node:crypto";
import { z } from "zod";
import { RESEARCH_MODEL_SCHEMA_VERSION, ResearchModelOutputs, type ResearchModelOutput } from "@deep/contracts";
import { validateModelBindings } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { ModelReceiptSchema, type ModelContext } from "../ports/model.js";
import { modelInputManifest } from "./model-operations.js";
import { getBrief, getRun } from "./runs.js";

export interface TaskModelVersions { promptVersion: string; policyId: string }
export const RESEARCH_TASK_VERSION = "research-task.v1";
const IdMap = z.record(z.string().uuid());
export interface ResearchTask {
  id: string;
  runId: string;
  briefRevision: number;
  version: typeof RESEARCH_TASK_VERSION;
  modelIntentId: string;
  specification: ResearchModelOutput<"brief">;
  criterionIds: Record<string, string>;
  questionIds: Record<string, string>;
  planningStatus: "ready" | "needs_clarification";
}
export function briefContext(question: string): ModelContext {
  return { question, task: null, passages: [], sources: [], assertions: [], approvedClaimKeys: [], draft: null };
}
const digest = (question: string) => createHash("sha256").update(question).digest("hex");
async function ownedQuestion(db: Queryable, runId: string, accountId: string, revision: number): Promise<string> {
  const run = await getRun(db, runId);
  const account = await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL", [accountId]);
  if (!run || account.rowCount !== 1 || run.account_id !== accountId || run.brief_revision !== revision) throw new Error("stale_research_task");
  const brief = await getBrief(db, run.brief_id);
  return brief.originalQuestion;
}

/** Only an owned successful, version-pinned, receipt-bound model result can seed a task. */
async function checkedProposal(db: Queryable, runId: string, accountId: string, revision: number, question: string, versions: TaskModelVersions, intentId?: string) {
  const result = await db.query<{ intent_id: string; result: unknown }>(`SELECT m.intent_id,m.result
    FROM model_operation_results m JOIN provider_intents i ON i.id=m.intent_id
    WHERE m.run_id=$1 AND m.account_id=$2 AND m.brief_revision=$3 AND m.operation='brief'
      AND m.schema_version=$4 AND m.prompt_version=$5 AND m.policy_id=$6
      AND ($7::uuid IS NULL OR m.intent_id=$7) AND m.result->>'status'='succeeded'
      AND m.input_manifest=$8::jsonb AND m.result->'receipt'=i.receipt AND i.run_id=m.run_id AND i.request_digest=m.request_digest
    ORDER BY m.created_at,m.intent_id LIMIT 1`,
    [runId,accountId,revision,RESEARCH_MODEL_SCHEMA_VERSION,versions.promptVersion,versions.policyId,intentId ?? null,JSON.stringify(modelInputManifest(briefContext(question)))]);
  if (!result.rows[0]) return null;
  const parsed = z.object({ status: z.literal("succeeded"), output: ResearchModelOutputs.brief, receipt: ModelReceiptSchema }).strict().safeParse(result.rows[0].result);
  if (!parsed.success || validateModelBindings("brief", parsed.data.output, briefContext(question)).length) throw new Error("invalid_research_task_proposal");
  return { intentId: result.rows[0].intent_id, specification: parsed.data.output };
}
function checkedIds(raw: unknown, keys: string[]): Record<string, string> {
  const ids = IdMap.parse(raw);
  if (Object.keys(ids).length !== keys.length || keys.some((key) => !Object.hasOwn(ids,key)) || new Set(Object.values(ids)).size !== keys.length) throw new Error("invalid_research_task_ids");
  return ids;
}
function planningStatus(specification: ResearchModelOutput<"brief">): ResearchTask["planningStatus"] {
  return specification.openAmbiguities.length || specification.criteria.some((c) => c.importance === "hard" && c.unresolvedAlternatives.length)
    ? "needs_clarification" : "ready";
}

/** Call from a fenced transaction for worker use; read endpoints must independently authenticate. */
export async function loadResearchTask(db: Queryable, runId: string, accountId: string, revision: number, versions: TaskModelVersions): Promise<ResearchTask | null> {
  const question = await ownedQuestion(db,runId,accountId,revision);
  const row = (await db.query(`SELECT * FROM research_tasks WHERE run_id=$1 AND account_id=$2 AND brief_revision=$3`, [runId,accountId,revision])).rows[0];
  if (!row) return null;
  if (row.version !== RESEARCH_TASK_VERSION || row.question_digest !== digest(question)) throw new Error("stale_research_task_version");
  const proposal = await checkedProposal(db,runId,accountId,revision,question,versions,row.model_intent_id);
  if (!proposal || JSON.stringify(ResearchModelOutputs.brief.parse(row.specification)) !== JSON.stringify(proposal.specification)) throw new Error("invalid_research_task_proposal");
  const criterionIds = checkedIds(row.criterion_ids, proposal.specification.criteria.map((c) => c.key));
  const questionIds = checkedIds(row.question_ids, proposal.specification.questions.map((q) => q.key));
  if (new Set([...Object.values(criterionIds),...Object.values(questionIds)]).size !== Object.keys(criterionIds).length+Object.keys(questionIds).length) throw new Error("invalid_research_task_ids");
  return { id: row.id, runId, briefRevision: revision, version: RESEARCH_TASK_VERSION, modelIntentId: row.model_intent_id,
    specification: proposal.specification, criterionIds, questionIds, planningStatus: planningStatus(proposal.specification) };
}

/** Adopt existing output after a crash without another model call. Caller owns the account/run fence locks. */
export async function adoptResearchTask(db: Queryable, runId: string, accountId: string, revision: number, versions: TaskModelVersions): Promise<ResearchTask | null> {
  const existing = await loadResearchTask(db,runId,accountId,revision,versions);
  if (existing) return existing;
  const question = await ownedQuestion(db,runId,accountId,revision);
  const proposal = await checkedProposal(db,runId,accountId,revision,question,versions);
  if (!proposal) return null;
  const criterionIds = Object.fromEntries(proposal.specification.criteria.map((c) => [c.key,crypto.randomUUID()]));
  const questionIds = Object.fromEntries(proposal.specification.questions.map((q) => [q.key,crypto.randomUUID()]));
  await db.query(`INSERT INTO research_tasks(run_id,account_id,brief_revision,model_intent_id,version,question_digest,specification,criterion_ids,question_ids)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(run_id,brief_revision) DO NOTHING`,
    [runId,accountId,revision,proposal.intentId,RESEARCH_TASK_VERSION,digest(question),JSON.stringify(proposal.specification),JSON.stringify(criterionIds),JSON.stringify(questionIds)]);
  return loadResearchTask(db,runId,accountId,revision,versions);
}

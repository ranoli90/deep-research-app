import {runModelVersions} from "../modules/run-model-policy.js";
import type pg from "pg";
import type { AppConfig } from "../platform/config.js";
import { adoptResearchTask, briefContext, confirmedConstraints, type ResearchTask } from "../modules/research-tasks.js";
import { getBrief, getRun } from "../modules/runs.js";
import type { FencedSession } from "./fenced-session.js";
import { STRUCTURED_MODEL_POLICY } from "../adapters/model/policy.js";
import { MODEL_PROMPT_VERSION } from "../adapters/model/prompts.js";
import { knownFinancialOutcome } from "../adapters/model/outcomes.js";
import { performModelOperation } from "./model-gateway.js";

/** Historical text-v1 fixture for negative tests. Live loads must use runModelVersions. */
export const TASK_MODEL_VERSIONS = { promptVersion: MODEL_PROMPT_VERSION, policyId: STRUCTURED_MODEL_POLICY.id } as const;

type TaskOutcome = { kind: "task"; task: ResearchTask; reused: boolean }
  | { kind: "pending"; intentId: string } | { kind: "blocked"; reason: string };

/** General research preparation. Evidence arrival cannot change the user's criteria. */
export async function ensureResearchTask(pool: pg.Pool, config: AppConfig, session: FencedSession, args: {
  runId: string; accountId: string; fence: number; briefRevision: number;
}): Promise<TaskOutcome> {
  const existing = await session.write(async (db) => adoptResearchTask(db,args.runId,args.accountId,args.briefRevision,await runModelVersions(db,args.runId)));
  if (existing) return { kind: "task", task: existing, reused: true };
  const basis = await session.write(async (db) => {
    const run = await getRun(db,args.runId);
    if (!run || run.account_id !== args.accountId || run.brief_revision !== args.briefRevision) throw new Error("stale_research_task");
    const brief = await getBrief(db,run.brief_id);
    return { evidenceRevision: run.evidence_revision, context: briefContext(brief.originalQuestion, confirmedConstraints(brief.constraints), brief) };
  });
  let result = await performModelOperation(pool,config,session,{ ...args,...basis,operation:"brief" });
  if (result.kind === "result" && result.result.status === "invalid_output" && !result.reused && knownFinancialOutcome(result.result)) {
    result = await performModelOperation(pool,config,session,{ ...args,...basis,operation:"brief", repairPass: 1 });
  }
  if (result.kind !== "result") return result;
  if (result.result.status !== "succeeded") return { kind:"blocked", reason: `task_${result.result.status}` };
  const task = await session.write(async (db) => adoptResearchTask(db,args.runId,args.accountId,args.briefRevision,await runModelVersions(db,args.runId)));
  if (!task) return { kind:"blocked", reason:"task_result_unavailable" };
  return { kind:"task",task,reused:result.reused };
}

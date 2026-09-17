import { z } from "zod";
import type pg from "pg";
import type { ResearchModelOutput } from "@deep/contracts";
import type { AppConfig } from "../platform/config.js";
import { ModelContextSchema } from "../ports/model.js";
import { briefContext, loadResearchTask } from "../modules/research-tasks.js";
import { getBrief, getRun } from "../modules/runs.js";
import type { FencedSession } from "./fenced-session.js";
import { TASK_MODEL_VERSIONS } from "./research-task.js";
import { performModelOperation } from "./model-gateway.js";

const Selection = z.array(z.string().uuid()).min(1).max(24).refine((ids) => new Set(ids).size === ids.length);
type Outcome = { kind:"extraction"; intentId:string; taskId:string; evidenceRevision:number; reused:boolean;
  output:ResearchModelOutput<"extract_assertions"> }
  | { kind:"pending"; intentId:string } | { kind:"blocked"; reason:string };

/** Executes extraction on explicitly selected whole passages. No fixture catalog or model-owned authority. */
export async function extractEvidenceAssertions(pool:pg.Pool, config:AppConfig, session:FencedSession, args:{
  runId:string; accountId:string; fence:number; briefRevision:number; taskId:string; passageIds:string[];
}):Promise<Outcome> {
  const selected = Selection.safeParse(args.passageIds);
  if (!selected.success) return { kind:"blocked",reason:"invalid_extraction_selection" };
  // Canonical order prevents selection ordering from creating another paid logical action.
  const ids = selected.data.sort();
  const basis = await session.write(async (db) => {
    const task = await loadResearchTask(db,args.runId,args.accountId,args.briefRevision,TASK_MODEL_VERSIONS);
    if (!task || task.id !== args.taskId) throw new Error("extraction_task_mismatch");
    if (task.planningStatus !== "ready") return { kind:"blocked" as const, blocked:"task_requires_clarification" as const };
    const run = await getRun(db,args.runId);
    if (!run) throw new Error("missing_run");
    const brief = await getBrief(db,run.brief_id);
    const rows = await db.query<{ id:string; version:string; digest:string; text:string; access:string; source:string; title:string }>(`SELECT
      p.id,p.source_version_id AS version,p.content_hash AS digest,p.exact_text AS text,
      v.access_level AS access,s.id AS source,s.title
      FROM passages p JOIN source_versions v ON v.id=p.source_version_id JOIN sources s ON s.id=v.source_id
      WHERE p.id=ANY($1::uuid[]) AND p.account_id=$2 AND p.run_id=$3
        AND v.account_id=$2 AND s.account_id=$2 AND s.run_id=$3 ORDER BY p.id`,[ids,args.accountId,args.runId]);
    if (rows.rowCount !== ids.length) throw new Error("extraction_evidence_owner_mismatch");
    const context = ModelContextSchema.safeParse({ ...briefContext(brief.originalQuestion),task:task.specification,
      passages:rows.rows.map((p) => ({ id:p.id,sourceVersionId:p.version,digest:p.digest,text:p.text,accessLevel:p.access })),
      sources:[...new Map(rows.rows.map((p) => [p.source,{ handle:p.source,title:p.title }])).values()] });
    if (!context.success) return { kind:"blocked" as const, blocked:"extraction_context_unavailable" as const };
    return { kind:"basis" as const,context:context.data,evidenceRevision:run.evidence_revision };
  });
  if (basis.kind === "blocked") return { kind:"blocked",reason:basis.blocked };
  const result = await performModelOperation(pool,config,session,{ ...args,...basis,operation:"extract_assertions" });
  if (result.kind !== "result") return result;
  if (result.result.status !== "succeeded") return { kind:"blocked",reason:`extraction_${result.result.status}` };
  return { kind:"extraction",intentId:result.intentId,taskId:args.taskId,evidenceRevision:basis.evidenceRevision,reused:result.reused,output:result.result.output };
}

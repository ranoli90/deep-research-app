import { z } from "zod";
import type { Queryable } from "../platform/db.js";
import { ModelContextSchema } from "../ports/model.js";
import { briefContext, loadResearchTask, type TaskModelVersions } from "./research-tasks.js";
import { getBrief, getRun } from "./runs.js";
const Selection = z.array(z.string().uuid()).min(1).max(24).refine((ids) => new Set(ids).size === ids.length);
export async function loadAssertionEvidence(db:Queryable,args:{runId:string;accountId:string;briefRevision:number;taskId:string;passageIds:string[]},versions:TaskModelVersions) {
  const selected = Selection.safeParse(args.passageIds);
  if (!selected.success) return { kind:"blocked" as const,blocked:"invalid_extraction_selection" as const };
  // Canonical order prevents selection ordering from creating another paid logical action.
  const ids = selected.data.sort();

    const task = await loadResearchTask(db,args.runId,args.accountId,args.briefRevision,versions);
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
}

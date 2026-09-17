import { z } from "zod";
import { CanonicalReportSchema,ResearchModelOutputs,type CanonicalReport,type ResearchModelOutput } from "@deep/contracts";
import type { Queryable } from "../platform/db.js";
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item:unknown)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const text=(value:string)=>value.trim().replace(/\s+/gu," ");
type Item={id:string;signature:string};
function diff(before:Item[],after:Item[]) {
 const remaining=[...before],added:string[]=[];let unchanged=0;
 for(const item of after){const index=remaining.findIndex((old)=>old.signature===item.signature);if(index<0)added.push(item.id);else{remaining.splice(index,1);unchanged++;}}
 return {added:added.sort(),removed:remaining.map((x)=>x.id).sort(),unchanged};
}
async function assertions(db:Queryable,accountId:string,runId:string,ids:string[]):Promise<Item[]|null> {
 const rows=await db.query(`SELECT r.id,r.claim_id,r.text,r.scope FROM claim_revisions r JOIN claims c ON c.id=r.claim_id
  WHERE r.account_id=$1 AND r.run_id=$2 AND c.account_id=$1 AND c.run_id=$2 AND r.claim_id::text=ANY($3::text[]) AND r.text=c.text`,[accountId,runId,ids]);
 if(rows.rowCount!==ids.length||new Set(rows.rows.map((r)=>r.claim_id)).size!==ids.length)return null;
 if(rows.rows.some((r)=>!r.scope?.semanticScope||typeof r.scope.semanticScope!=="object"))return null;
 return rows.rows.map((r)=>({id:r.id,signature:stable({text:text(r.text),scope:r.scope.semanticScope,quantities:r.scope.quantities??[]})}));
}
type Criterion=ResearchModelOutput<"brief">["criteria"][number];
function criterionValue({key:_key,provenance:_provenance,group:_group,...value}:Criterion){return value;}
async function criteria(db:Queryable,accountId:string,runId:string):Promise<Item[]|null> {
 const row=(await db.query("SELECT specification,criterion_ids FROM research_tasks WHERE account_id=$1 AND run_id=$2",[accountId,runId])).rows[0];
 const task=ResearchModelOutputs.brief.safeParse(row?.specification),ids=z.record(z.string().uuid()).safeParse(row?.criterion_ids);
 if(!task.success||!ids.success||task.data.criteria.some((c)=>!ids.data[c.key]))return null;
 return task.data.criteria.map((c)=>({id:ids.data[c.key]!,signature:stable({value:criterionValue(c),groupMembers:task.data.criteria.filter((other)=>other.group===c.group).map((other)=>stable(criterionValue(other))).sort()})}));
}
async function citedVersions(db:Queryable,accountId:string,runId:string,report:Pick<CanonicalReport,"blocks">) {
 const ids=[...new Set(report.blocks.flatMap((b)=>b.citationIds))];
 const rows=await db.query("SELECT id,source_version_id FROM authorized_run_passages WHERE account_id=$1 AND run_id=$2 AND id::text=ANY($3::text[])",[accountId,runId,ids]);
 if(rows.rowCount!==ids.length)return null;
 return [...new Set(rows.rows.map((r)=>r.source_version_id as string))].sort();
}

/** Publication transaction only. Missing/ambiguous history cannot produce an 'unchanged' claim. */
export async function deriveReportChanges(db:Queryable,accountId:string,report:CanonicalReport):Promise<{managed:boolean;summary?:CanonicalReport["changeSummary"]}> {
 const change=(await db.query("SELECT r.parent_run_id FROM runs r WHERE r.id=$1 AND r.account_id=$2 AND EXISTS(SELECT 1 FROM research_tasks t WHERE t.run_id=r.id AND t.account_id=r.account_id)",[report.runId,accountId])).rows[0];
 if(!change)return {managed:false};
 if(!change.parent_run_id)return {managed:true};
 const prior=(await db.query("SELECT * FROM reports WHERE run_id=$1 AND account_id=$2 AND redacted_at IS NULL ORDER BY version DESC LIMIT 1",[change.parent_run_id,accountId])).rows[0];
 if(!prior)return {managed:true};
 const blocks=CanonicalReportSchema.shape.blocks.safeParse(prior.blocks);
 if(!blocks.success)return {managed:true};
 const before=await assertions(db,accountId,prior.run_id,prior.claim_ids),after=await assertions(db,accountId,report.runId,report.claimIds);
 const oldCriteria=await criteria(db,accountId,prior.run_id),newCriteria=await criteria(db,accountId,report.runId);
 const oldVersions=await citedVersions(db,accountId,prior.run_id,{blocks:blocks.data}),newVersions=await citedVersions(db,accountId,report.runId,report);
 if(!before||!after||!oldCriteria||!newCriteria||!oldVersions||!newVersions)return {managed:true};
 const claims=diff(before,after),criteriaDiff=diff(oldCriteria,newCriteria);
 const reuse=(await db.query("SELECT DISTINCT source_version_id FROM run_evidence_membership WHERE run_id=$1 AND account_id=$2 AND source_version_id=ANY($3::uuid[])",[report.runId,accountId,newVersions])).rows.map((r)=>r.source_version_id as string).sort();
 const reportStateChanged=prior.outcome!==report.outcome||stable(prior.limitations)!==stable(report.limitations);
 return {managed:true,summary:{evidenceUpdated:stable(oldVersions)!==stable(newVersions),conclusionChanged:!!(claims.added.length||claims.removed.length||reportStateChanged),newlyFeasible:[],newlyInfeasible:[],
  notes:`Assertions: ${claims.added.length} added, ${claims.removed.length} removed, ${claims.unchanged} unchanged. Criteria: ${criteriaDiff.added.length} added, ${criteriaDiff.removed.length} removed. Reused cited source versions: ${reuse.length}. ${reportStateChanged?"Report outcome or limitations changed. ":""}Comparison uses exact wording and recorded scope; paraphrases may count as changes.`,
  comparison:{version:"report-changes.v1",parentReportId:prior.id,addedClaimRevisionIds:claims.added,removedClaimRevisionIds:claims.removed,unchangedAssertions:claims.unchanged,
   addedCriterionIds:criteriaDiff.added,removedCriterionIds:criteriaDiff.removed,reusedCitedSourceVersionIds:reuse,newlyCitedSourceVersionIds:newVersions.filter((id)=>!oldVersions.includes(id)),reportStateChanged}}};
}

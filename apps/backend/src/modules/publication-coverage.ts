import { evidenceSelectionLimitations } from "./evidence-selections.js";
import { verificationReportMatches } from "./verification-proof.js";
import { counterevidenceLimitations,requiredCounterevidenceMissing } from "./counterevidence.js";
import { calculatedCompletionCovered } from "./calculated-coverage.js";
import type { CanonicalReport } from "@deep/contracts";
import { compileCheckedDraft,draftStatements,RESEARCH_COVERAGE_VERSION,SCOPED_SUPPORT_VERSION } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { MODEL_PROMPT_VERSION,STRUCTURED_MODEL_POLICY } from "../ports/model-policy.js";
import { persistResearchCoverage } from "./research-coverage.js";
import { loadSupportContext,persistScopedSupport,restoreWriterDraft } from "./scoped-support.js";

/** No caller completion flag or saved model verdict substitutes for current coverage of this exact report. */
export async function reportCompletionCovered(db:Queryable,accountId:string,report:CanonicalReport):Promise<boolean> {
  const challengeBasis={runId:report.runId,accountId,briefRevision:report.basis.briefRevision};
  // Missing targets cannot establish which conclusions need qualification.
  if(await requiredCounterevidenceMissing(db,challengeBasis))return false;
  // Limited publication must carry every independently restored target warning too.
  // Its outcome label cannot bypass an admitted proof obligation or corrupt saved proof.
  const challengeLimitations=[...await counterevidenceLimitations(db,challengeBasis),...await evidenceSelectionLimitations(db,challengeBasis)];
  if(challengeLimitations.some(limitation=>!report.limitations.includes(limitation)))return false;
  const verification=await verificationReportMatches(db,accountId,report);
  if(verification!==null)return verification;
  if(report.outcome!=="completed")return true;
  if(challengeLimitations.length)return false;
  const task=await db.query("SELECT id FROM research_tasks WHERE run_id=$1 AND account_id=$2 AND brief_revision=$3",[report.runId,accountId,report.basis.briefRevision]);
  // Historical controller reports have no structured task; retain their existing publication contract.
  if(!task.rowCount)return true;
  if(report.limitations.length)return false;
  const rows=(await db.query(`SELECT c.model_intent_id,c.extraction_intent_id,c.support_intent_id,c.task_id FROM research_coverage c
    JOIN research_drafts d ON d.writer_intent_id=c.extraction_intent_id
    WHERE c.run_id=$1 AND c.account_id=$2 AND c.brief_revision=$3 AND c.evidence_revision=$4
      AND c.checker_version=$5 AND c.support_checker_version=$6 ORDER BY c.model_intent_id`,
    [report.runId,accountId,report.basis.briefRevision,report.basis.evidenceRevision,RESEARCH_COVERAGE_VERSION,SCOPED_SUPPORT_VERSION])).rows;
  const versions={promptVersion:MODEL_PROMPT_VERSION,policyId:STRUCTURED_MODEL_POLICY.id};
  if(await calculatedCompletionCovered(db,accountId,report,versions))return true;
  for(const row of rows) {
    const args={runId:report.runId,accountId,briefRevision:report.basis.briefRevision,taskId:row.task_id,
      extractionIntentId:row.extraction_intent_id,supportIntentId:row.support_intent_id,modelIntentId:row.model_intent_id};
    const coverage=await persistResearchCoverage(db,args,versions,true);
    if(!coverage.complete)continue;
    const restored=await restoreWriterDraft(db,args,versions);
    const basis=await loadSupportContext(db,args,versions);
    const checks=await persistScopedSupport(db,{...args,...basis,modelIntentId:row.support_intent_id},versions,true);
    const compiled=compileCheckedDraft(draftStatements(restored.draft,restored.basis.context.assertions,restored.basis.context.approvedClaimKeys),checks);
    if(!compiled.unresolved.length && JSON.stringify(compiled.blocks)===JSON.stringify(report.blocks) &&
      JSON.stringify(compiled.claims.map((c)=>c.id))===JSON.stringify(report.claimIds))return true;
  }
  return false;
}

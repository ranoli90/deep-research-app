import { loadCandidateLedger } from "./research-controller.js";
import { loadRunStoredSources } from "./retrieval-intelligence.js";
import { getRun,getBrief } from "./runs.js";
import {runModelVersions} from "./run-model-policy.js";
import { evidenceSelectionLimitations } from "./evidence-selections.js";
import { verificationReportMatches } from "./verification-proof.js";
import { counterevidenceLimitations,requiredCounterevidenceMissing } from "./counterevidence.js";
import { CALCULATED_COVERAGE_VERSION,calculatedCompletionCovered } from "./calculated-coverage.js";
import type { CanonicalReport } from "@deep/contracts";
import { candidateClaimsBounded,CANDIDATE_SCOPE_LIMITATION,compileCheckedDraft,draftStatements,freshnessPolicyForQuestion,limitedCoverageDisclosed,RESEARCH_COVERAGE_VERSION,SCOPED_SUPPORT_VERSION,sourcesHaveUnmetFreshness,unresolvedFreshnessLimitation } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { persistResearchCoverage } from "./research-coverage.js";
import { loadSupportContext,persistScopedSupport,restoreWriterDraft } from "./scoped-support.js";

/** Derived again at publication; a writer cannot omit a current research limitation. */
export async function researchPublicationLimitations(db:Queryable,args:{accountId:string;runId:string}):Promise<string[]> {
 const run=await getRun(db,args.runId);
 if(!run||run.account_id!==args.accountId)throw new Error("publication_owner_mismatch");
 const brief=await getBrief(db,run.brief_id);
 const ledger=await loadCandidateLedger(db,args);
 const sources=await loadRunStoredSources(db,args);
 const limitations:string[]=[];
 const compared=ledger?.entries.filter((entry)=>entry.status!=="excluded").length??0;
 if(compared>=2 && /\b(best|better|winner|vs\.?|versus|compare|comparison|which (?:one|option)|under \$?\d)/i.test(brief.originalQuestion))
  limitations.push(CANDIDATE_SCOPE_LIMITATION);
 const freshnessPolicy=freshnessPolicyForQuestion(brief.originalQuestion);
 if(sourcesHaveUnmetFreshness(freshnessPolicy,sources))
  limitations.push(unresolvedFreshnessLimitation(freshnessPolicy));
 return limitations;
}

/** No caller completion flag or saved model verdict substitutes for current coverage of this exact report. */
export async function reportCompletionCovered(db:Queryable,accountId:string,report:CanonicalReport):Promise<boolean> {
  const challengeBasis={runId:report.runId,accountId,briefRevision:report.basis.briefRevision};
  // Missing targets cannot establish which conclusions need qualification.
  if(await requiredCounterevidenceMissing(db,challengeBasis))return false;
  // Limited publication must carry every independently restored target warning too.
  // Its outcome label cannot bypass an admitted proof obligation or corrupt saved proof.
  const challengeLimitations=[...await researchPublicationLimitations(db,challengeBasis),...await counterevidenceLimitations(db,challengeBasis),...await evidenceSelectionLimitations(db,{...challengeBasis,evidenceRevision:report.basis.evidenceRevision})];
  if(!candidateClaimsBounded(report.blocks.map(b=>b.text)))return false;
  if(challengeLimitations.some(limitation=>!report.limitations.includes(limitation)))return false;
  const verification=await verificationReportMatches(db,accountId,report);
  if(verification!==null)return verification;
  const completed=report.outcome==="completed";
  if(!completed&&report.outcome!=="completed_with_limitations")return true;
  if(completed&&challengeLimitations.length)return false;
  const task=await db.query("SELECT id FROM research_tasks WHERE run_id=$1 AND account_id=$2 AND brief_revision=$3",[report.runId,accountId,report.basis.briefRevision]);
  // Historical controller reports have no structured task; retain their existing publication contract.
  if(!task.rowCount)return true;
  if(completed&&report.limitations.length)return false;
  const run=await getRun(db,report.runId);
  if(run&&run.account_id===accountId) {
    const brief=await getBrief(db,run.brief_id);
    const freshnessPolicy=freshnessPolicyForQuestion(brief.originalQuestion);
    if(sourcesHaveUnmetFreshness(freshnessPolicy,await loadRunStoredSources(db,{accountId,runId:report.runId}))) {
      if(completed)return false;
      if(!report.limitations.includes(unresolvedFreshnessLimitation(freshnessPolicy)))return false;
    }
  }
  const rows=(await db.query(`SELECT c.model_intent_id,c.extraction_intent_id,c.support_intent_id,c.task_id FROM research_coverage c
    JOIN research_drafts d ON d.writer_intent_id=c.extraction_intent_id
    WHERE c.run_id=$1 AND c.account_id=$2 AND c.brief_revision=$3 AND c.evidence_revision=$4
      AND c.checker_version=$5 AND c.support_checker_version=$6 ORDER BY c.model_intent_id`,
    [report.runId,accountId,report.basis.briefRevision,report.basis.evidenceRevision,RESEARCH_COVERAGE_VERSION,SCOPED_SUPPORT_VERSION])).rows;
  const versions=await runModelVersions(db,report.runId);
  if(await calculatedCompletionCovered(db,accountId,report,versions))return true;
  let restoredCoverage=false;
  for(const row of rows) {
    restoredCoverage=true;
    const args={runId:report.runId,accountId,briefRevision:report.basis.briefRevision,taskId:row.task_id,
      extractionIntentId:row.extraction_intent_id,supportIntentId:row.support_intent_id,modelIntentId:row.model_intent_id};
    const coverage=await persistResearchCoverage(db,args,versions,true);
    if(completed&&!coverage.complete)continue;
    const restored=await restoreWriterDraft(db,args,versions);
    const basis=await loadSupportContext(db,args,versions);
    const checks=await persistScopedSupport(db,{...args,...basis,modelIntentId:row.support_intent_id},versions,true);
    const compiled=compileCheckedDraft(draftStatements(restored.draft,restored.basis.context.assertions,restored.basis.context.approvedClaimKeys),checks);
    if(JSON.stringify(compiled.blocks)!==JSON.stringify(report.blocks)||
      JSON.stringify(compiled.claims.map((c)=>c.id))!==JSON.stringify(report.claimIds))continue;
    if(completed) {
      if(compiled.unresolved.length)continue;
      return true;
    }
    const spec=restored.basis.context.task??basis.context.task;
    if(spec&&limitedCoverageDisclosed(report.limitations,coverage,spec))return true;
  }
  if(completed)return false;
  if(restoredCoverage)return false;
  const calculated=(await db.query(`SELECT 1 FROM calculated_report_coverage WHERE account_id=$1 AND run_id=$2 AND brief_revision=$3
    AND evidence_revision=$4 AND checker_version=$5 LIMIT 1`,
    [accountId,report.runId,report.basis.briefRevision,report.basis.evidenceRevision,CALCULATED_COVERAGE_VERSION])).rowCount;
  // Calculated coverage existed and did not prove this limited report; do not fall back to the outcome label.
  if(calculated)return false;
  // Limited reports without a restored structured/calculated coverage row keep their historical limited contract.
  return true;
}

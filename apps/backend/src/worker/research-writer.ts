import { researchPublicationLimitations } from "../modules/publication-coverage.js";
import {runModelVersions} from "../modules/run-model-policy.js";
import { evidenceSelectionLimitations } from "../modules/evidence-selections.js";
import { counterevidenceLimitations } from "../modules/counterevidence.js";
import { executeCalculatedCoverage } from "./calculated-coverage.js";
import { persistCalculatedCoverage } from "../modules/calculated-coverage.js";
import { ZodError } from "zod";
import type pg from "pg";
import { AccessLevelSchema,type CanonicalReport } from "@deep/contracts";
import { compileCheckedDraft,draftStatements,freshnessPolicyForQuestion,LATER_EVIDENCE_LIMITATION,limitedCoverageLimitations,planHierarchicalWrite,sourcesHaveUnmetFreshness,unresolvedFreshnessLimitation } from "@deep/research-core";
import type { AppConfig } from "../platform/config.js";
import { loadSupportContext,loadWriterSourceContext,persistScopedSupport,restoreWriterDraft,type SupportArgs } from "../modules/scoped-support.js";
import { recordResearchDraft } from "../modules/research-drafts.js";
import { getBrief, getRun } from "../modules/runs.js";
import { loadRunStoredSources } from "../modules/retrieval-intelligence.js";
import { publishReport } from "../modules/reports.js";
import type { FencedSession } from "./fenced-session.js";
import { knownFinancialOutcome } from "../adapters/model/outcomes.js";
import { performModelOperation } from "./model-gateway.js";
import { executeCoverageReview } from "./research-coverage.js";
import { persistResearchCoverage } from "../modules/research-coverage.js";
import { executeAssertionSupport } from "./support-execution.js";

type WriterArgs=SupportArgs&{fence:number;sourceSupportIntentId:string;calculationPlanIntentId?:string};
export async function createResearchDraft(pool:pg.Pool,config:AppConfig,session:FencedSession,args:WriterArgs) {
  if(args.calculationPlanIntentId) {
    const old=await session.write(async db=>db.query("SELECT 1 FROM run_actions WHERE run_id=$1 AND brief_revision=$2 AND kind='write_report' LIMIT 1",[args.runId,args.briefRevision]));
    if(old.rowCount)args={...args,calculationPlanIntentId:undefined};
  }
  const basis=await session.write(async (db)=>loadWriterSourceContext(db,{...args,prepareCalculations:true},await runModelVersions(db,args.runId)));
  const liveRevision=(await getRun(pool,args.runId))?.evidence_revision ?? basis.evidenceRevision;
  const historical=liveRevision>basis.evidenceRevision;
  const outline=planHierarchicalWrite({task:basis.context.task,approvedClaimKeys:basis.context.approvedClaimKeys,assertions:basis.context.assertions});
  const orderedKeys=outline.sections.flatMap((section)=>section.claimKeys);
  const byKey=new Map(basis.context.assertions.map((assertion)=>[assertion.key,assertion]));
  const orderedAssertions=orderedKeys.map((key)=>byKey.get(key)).filter((assertion):assertion is NonNullable<typeof assertion>=>Boolean(assertion));
  const context=orderedAssertions.length?{...basis.context,approvedClaimKeys:orderedKeys,assertions:orderedAssertions}:basis.context;
  const writeArgs={...args,...basis,context,historical};
  let result=await performModelOperation(pool,config,session,{...writeArgs,operation:args.calculationPlanIntentId?"write_calculated_report":"write_report"});
  if(result.kind!=="result")return result;
  if(result.result.status==="invalid_output"){
    if(!knownFinancialOutcome(result.result))return {kind:"blocked" as const,reason:"writer_outcome_unknown"};
    result=await performModelOperation(pool,config,session,{...writeArgs,operation:args.calculationPlanIntentId?"write_calculated_report":"write_report",repairPass:1});
    if(result.kind!=="result")return result;
  }
  if(result.result.status!=="succeeded")return {kind:"blocked" as const,reason:`writer_${result.result.status}`};
  // Check bounded target expansion before adopting a draft; never silently omit final prose.
  try { const {calculationKeys:_,...ordinary}=result.result.output as typeof result.result.output & {calculationKeys?:string[]}; draftStatements(ordinary,basis.context.assertions,basis.context.approvedClaimKeys); }
  catch(error) {
    if(error instanceof ZodError || error instanceof Error && error.message==="writer_assertion_limit")
      return {kind:"blocked" as const,reason:"writer_draft_expansion_invalid"};
    throw error;
  }
  await session.write(async (db)=>recordResearchDraft(db,{...args,writerIntentId:result.intentId},await runModelVersions(db,args.runId)));
  return {kind:"draft" as const,writerIntentId:result.intentId,reused:result.reused,calculated:Boolean(args.calculationPlanIntentId)};
}

/** Writer -> exact final-wording checks -> canonical publication. Network never occurs in a transaction. */
export async function writeResearchReport(pool:pg.Pool,config:AppConfig,session:FencedSession,args:WriterArgs) {
  const draft=await createResearchDraft(pool,config,session,args);
  if(draft.kind!=="draft")return draft;
  const target={...args,extractionIntentId:draft.writerIntentId};
  const support=await executeAssertionSupport(pool,config,session,target);
  if(support.kind!=="support")return support;
  const reviewed=await (draft.calculated?executeCalculatedCoverage:executeCoverageReview)(pool,config,session,{...target,supportIntentId:support.intentId});
  if(reviewed.kind!=="coverage")return reviewed;
  return session.write(async(db)=>{
    const calculated=draft.calculated?await persistCalculatedCoverage(db,{...target,supportIntentId:support.intentId,modelIntentId:reviewed.intentId},await runModelVersions(db,args.runId),true):null;
    const validated=calculated??await (async()=>{
      const restored=await restoreWriterDraft(db,target,await runModelVersions(db,args.runId));
      const basis=await loadSupportContext(db,target,await runModelVersions(db,args.runId));
      const checks=await persistScopedSupport(db,{...target,...basis,modelIntentId:support.intentId},await runModelVersions(db,args.runId),true);
      const statements=draftStatements(restored.draft,restored.basis.context.assertions,restored.basis.context.approvedClaimKeys);
      const coverage=await persistResearchCoverage(db,{...target,supportIntentId:support.intentId,modelIntentId:reviewed.intentId},await runModelVersions(db,args.runId),true);
      return {basis:{...basis,compiled:compileCheckedDraft(statements,checks)},coverage};
    })();
    const {basis,coverage}=validated,compiled=basis.compiled;
    const challengeLimitations=[...await researchPublicationLimitations(db,args),...await counterevidenceLimitations(db,args),...await evidenceSelectionLimitations(db,{...args,evidenceRevision:basis.evidenceRevision})];
    const run=await getRun(db,args.runId);
    if(!run||run.evidence_revision<basis.evidenceRevision)throw new Error("stale_writer_publication");
    const laterEvidence=run.evidence_revision>basis.evidenceRevision;
    const cited=[...new Set(compiled.blocks.flatMap((b)=>b.citationIds))];
    const rows=await db.query<{id:string;title:string;access_level:string;origin_cluster:string}>(`SELECT DISTINCT s.id,s.title,v.access_level,s.origin_cluster
      FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id JOIN sources s ON s.id=v.source_id
      WHERE p.id=ANY($1::uuid[]) AND p.account_id=$2 AND p.run_id=$3 AND v.account_id=$2 AND s.account_id=$2`,[cited,args.accountId,args.runId]);
    const snippetCited=rows.rows.some((s)=>s.access_level==="snippet");
    const brief=await getBrief(db,run.brief_id);
    const freshnessPolicy=freshnessPolicyForQuestion(brief.originalQuestion);
    const freshnessUnmet=sourcesHaveUnmetFreshness(freshnessPolicy,await loadRunStoredSources(db,{accountId:args.accountId,runId:args.runId}));
    const freshnessLimitation=freshnessUnmet?unresolvedFreshnessLimitation(freshnessPolicy):null;
    const complete=coverage.complete&&!compiled.unresolved.length&&!challengeLimitations.length&&!laterEvidence&&!snippetCited&&!freshnessUnmet;
    const report:CanonicalReport={reportId:crypto.randomUUID(),runId:args.runId,version:1,
      basis:{briefRevision:args.briefRevision,evidenceRevision:basis.evidenceRevision,consentEpoch:run.consent_epoch,cancellationEpoch:run.cancellation_epoch,workerLeaseFence:args.fence},
      outcome:complete?"completed":"completed_with_limitations",blocks:compiled.blocks,claimIds:compiled.claims.map((c)=>c.id),
      // Completion requires the separately executed coverage review and intact final assertions.
      limitations:complete?[]:[
        ...((coverage.complete&&!compiled.unresolved.length)?[]:["Some requested questions remain unresolved."]),
        ...(basis.context.task?limitedCoverageLimitations(coverage,basis.context.task):[]),
        ...(laterEvidence?[LATER_EVIDENCE_LIMITATION]:[]),
        ...(snippetCited?["Some cited sources could only be read as search snippets after the full page was blocked."]:[]),
        ...(freshnessLimitation?[freshnessLimitation]:[]),
        ...challengeLimitations,
      ],
      sourceAccessSummary:rows.rows.map((s)=>({sourceId:s.id,title:s.title,accessLevel:AccessLevelSchema.parse(s.access_level),originCluster:s.origin_cluster})),routeMode:"controlled-research"};
    const result=await publishReport(db,{report,accountId:args.accountId,loaded:report.basis,claims:compiled.claims,passages:[],deleted:false});
    return {kind:"publication" as const,...result,writerIntentId:draft.writerIntentId,supportIntentId:support.intentId,coverageIntentId:reviewed.intentId,unresolvedStatements:compiled.unresolved};
  });
}

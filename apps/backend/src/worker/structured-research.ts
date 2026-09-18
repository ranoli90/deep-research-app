import { executeCounterevidence } from "./counterevidence.js";
import { getCounterevidence } from "../modules/counterevidence.js";
import { publicSearchDigest } from "../ports/search.js";
import { executeCalculationPlanning } from "./calculation-planning.js";
import { executeScopeComparison } from "./scope-comparison.js";
import { counterevidenceSearch } from "@deep/research-core";
import { nextStrategySearch } from "../ports/research-strategy.js";
import type pg from "pg";
import type { AppConfig } from "../platform/config.js";
import { getRun,getBrief,emitEvent,setPhase,markTerminal } from "../modules/runs.js";
import { settleRun } from "../modules/billing.js";
import type { FencedSession } from "./fenced-session.js";
import { ensureResearchTask } from "./research-task.js";
import { ingestAttachments } from "./attachment-ingestion.js";
import { extractEvidenceAssertions } from "./assertion-extraction.js";
import { executeAssertionSupport } from "./support-execution.js";
import { executeCoverageReview } from "./research-coverage.js";
import { performPublicSearch } from "./public-search.js";
import { executeSourceRead } from "./source-reading.js";
import { adoptSearchSources } from "../modules/search-sources.js";
import { writeResearchReport } from "./research-writer.js";

/** Production structured path. No fixture catalog, scenario composer or event-as-verification fallback. */
export async function processStructuredResearch(pool:pg.Pool,config:AppConfig,session:FencedSession,
  args:{runId:string;accountId:string;briefRevision:number;fence:number},opts:{pauseAt?:"writing"|"researching"}={}) {
  const unresolved=async(reason:string)=>session.write(async(db)=>{
    const run=await getRun(db,args.runId);
    if(!run)throw new Error("missing_run");
    await emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"research_unresolved",phase:run.phase,
      summary:"Research could not complete with the available evidence and processing allowance.",payload:{reason}});
    await markTerminal(db,args.runId,"failed");
    await settleRun(db,args.accountId,args.runId,run.spent_micro);
  });
  const pendingOrBlocked=async(result:{kind:string;reason?:string;intentId?:string})=>unresolved(result.reason??(result.kind==="pending"?"provider_outcome_unknown":"research_operation_unavailable"));
  const run=(await getRun(pool,args.runId))!;
  const brief=await getBrief(pool,run.brief_id);
  const correction=await session.write((db)=>db.query("SELECT reopen_discovery FROM research_change_sets WHERE run_id=$1 AND account_id=$2",[args.runId,args.accountId]));
  // A known unavailable required capability must fail before any model preparation cost.
  if(correction.rows[0]?.reopen_discovery&&!brief.attachmentIds.length&&!config.structuredDiscoveryEnabled)return unresolved("correction_rediscovery_disabled");
  const prepared=await ensureResearchTask(pool,config,session,args);
  if(prepared.kind!=="task")return pendingOrBlocked(prepared);
  if(prepared.task.planningStatus!=="ready")return unresolved("task_requires_clarification");
  const requiredProof=await session.write(db=>db.query(`SELECT 1 FROM runs r WHERE r.id=$1 AND r.account_id=$2 AND r.counterevidence_required_revision=$3
    AND NOT EXISTS(SELECT 1 FROM counterevidence_checks c WHERE c.run_id=r.id AND c.account_id=r.account_id AND c.brief_revision=$3)`,[args.runId,args.accountId,args.briefRevision]));
  if(requiredProof.rowCount)return unresolved("required_challenge_proof_missing");
  const queries:string[]=[];
  await ingestAttachments(pool,run,await getBrief(pool,run.brief_id),session);
  await session.write(async(db)=>{
    await setPhase(db,args.runId,"researching");
    await emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"criteria_prepared",phase:"researching",
      summary:"Research questions and criteria are ready.",payload:{taskId:prepared.task.id,briefRevision:args.briefRevision,strategy:run.research_strategy}});
  });
  if(opts.pauseAt==="researching")return;
  const selectPassages=()=>session.write((db)=>db.query<{id:string}>(`SELECT p.id FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id
    JOIN sources s ON s.id=v.source_id WHERE p.account_id=$1 AND p.run_id=$2 AND v.account_id=$1 AND s.account_id=$1
    AND v.access_level IN ('partial-text','full-text') ORDER BY p.id`,[args.accountId,args.runId]));
  let selected=await selectPassages();
  const savedChallenge=await session.write(db=>getCounterevidence(db,args));
  const challengeQuery=savedChallenge?counterevidenceSearch(brief.originalQuestion,savedChallenge.action.questionKeys):null;
  // The search receipt may commit before its challenge pointer. Recover its purpose
  // from the exact server-owned request digest without issuing an ordinary search.
  const challengeDigest=challengeQuery?publicSearchDigest(challengeQuery.action.query):null;
  const priorDiscovery=await session.write((db)=>db.query(`SELECT 1 FROM search_operations s
    WHERE s.run_id=$1 AND s.account_id=$2 AND s.brief_revision=$3
    AND NOT EXISTS(SELECT 1 FROM counterevidence_checks c WHERE c.search_intent_id=s.intent_id AND c.run_id=s.run_id AND c.account_id=s.account_id)
    AND (s.result->'receipt'->>'requestDigest') IS DISTINCT FROM $4::text LIMIT 1`,[args.runId,args.accountId,args.briefRevision,challengeDigest]));
  if(config.structuredDiscoveryEnabled&&(!selected.rowCount||priorDiscovery.rowCount||(correction.rows[0]?.reopen_discovery&&!brief.attachmentIds.length))) {
    const questionKeys=Object.keys(prepared.task.questionIds);
    if(brief.attachmentIds.length)return unresolved("document_search_requires_public_query_approval");
    if(!config.liveRetrievalEnabled)return unresolved("public_reading_disabled");
    // A bounded initial discovery pass. Completion still requires executed criterion coverage.
    queries.push(brief.originalQuestion);
    const search=await performPublicSearch(pool,config,session,{...args,taskId:prepared.task.id,proposal:{
      rationale:"Find public evidence for the original research question.",action:{type:"search",query:brief.originalQuestion,questionKeys,
        publicQueryBasis:{start:0,end:brief.originalQuestion.length,quote:brief.originalQuestion}}}});
    if(search.kind!=="search")return pendingOrBlocked(search);
    const sources=await session.write((db)=>adoptSearchSources(db,{...args,taskId:prepared.task.id,intentId:search.intentId}));
    for(const sourceHandle of sources) {
      const read=await executeSourceRead(config,session,{...args,taskId:prepared.task.id,proposal:{
        rationale:"Read the discovered source before assessing its assertions.",action:{type:"fetch",sourceHandle,questionKeys}}});
      if(read.kind!=="read")return unresolved(read.kind==="blocked"?read.reason:"source_read_outcome_unknown");
    }
    selected=await selectPassages();
  }
  // Repeat actual extraction/checking after new evidence, never count search events as coverage.
  for(let iteration=0;iteration<4;iteration++) {
    // Do not silently replace discovery with fixtures or truncate a document to fit the context.
    if(!selected.rowCount)return unresolved("readable_evidence_unavailable");
    const extraction=await extractEvidenceAssertions(pool,config,session,{...args,taskId:prepared.task.id,passageIds:selected.rows.map((p)=>p.id)});
    if(extraction.kind!=="extraction")return pendingOrBlocked(extraction);
    if(!extraction.output.assertions.length)return unresolved("no_relevant_assertions");
    const target={...args,taskId:prepared.task.id,extractionIntentId:extraction.intentId};
    const support=await executeAssertionSupport(pool,config,session,target);
    if(support.kind!=="support")return pendingOrBlocked(support);
    const challenge=await executeCounterevidence(pool,config,session,{...target,supportIntentId:support.intentId});
    if(challenge.kind==="challenge") {
      await session.write(db=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"counterevidence_checked",phase:"researching",
        summary:"A bounded counterevidence check recorded its inspected evidence and remaining uncertainty.",payload:{challengeId:challenge.id,outcome:challenge.outcome,version:challenge.version}}));
      if(challenge.evidenceChanged){selected=await selectPassages();continue;}
    }
    if(extraction.output.assertions.length>=2) {
      const comparison=await executeScopeComparison(session,{...target,supportIntentId:support.intentId,
        action:{type:"compare_scopes",claimKeys:extraction.output.assertions.map(a=>a.key)}});
      if(comparison.kind!=="comparison")return unresolved(comparison.reason);
    }
    const calculations=await executeCalculationPlanning(pool,config,session,{...target,supportIntentId:support.intentId});
    if(calculations.kind!=="calculations"&&calculations.kind!=="not_applicable")return pendingOrBlocked(calculations);
    if(calculations.kind==="calculations"&&calculations.executions.length)await session.write(db=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"calculations_executed",phase:"researching",
      summary:"Requested arithmetic was evaluated against checked source quantities.",payload:{planIntentId:calculations.intentId,
       results:calculations.executions.map(e=>({key:e.key,calculationId:e.calculationId,status:e.result.status,reason:e.result.reason}))}}));
    const review=await executeCoverageReview(pool,config,session,{...target,supportIntentId:support.intentId});
    if(review.kind!=="coverage")return pendingOrBlocked(review);
    await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"evidence_checked",phase:"researching",
      summary:review.coverage.complete?"The checked evidence answers the research questions.":"Some questions remain unresolved in the checked evidence.",
      payload:{extractionIntentId:extraction.intentId,supportIntentId:support.intentId,coverageIntentId:review.intentId,complete:review.coverage.complete}}));
    if(!review.coverage.complete&&config.structuredDiscoveryEnabled&&!brief.attachmentIds.length&&config.liveRetrievalEnabled) {
      const next=nextStrategySearch(run.research_strategy,{question:brief.originalQuestion,task:prepared.task.specification,
        unresolvedCriterionKeys:review.coverage.unresolvedCriterionKeys,queries});
      if(next.kind==="search") {
        queries.push(next.proposal.action.query);
        const search=await performPublicSearch(pool,config,session,{...args,taskId:prepared.task.id,proposal:next.proposal});
        if(search.kind!=="search")return pendingOrBlocked(search);
        const sources=await session.write((db)=>adoptSearchSources(db,{...args,taskId:prepared.task.id,intentId:search.intentId}));
        for(const sourceHandle of sources) {
          const read=await executeSourceRead(config,session,{...args,taskId:prepared.task.id,proposal:{
            rationale:"Read evidence for an unresolved criterion.",action:{type:"fetch",sourceHandle,questionKeys:next.proposal.action.questionKeys}}});
          if(read.kind!=="read")return unresolved(read.kind==="blocked"?read.reason:"source_read_outcome_unknown");
        }
        selected=await selectPassages();
        continue;
      }
      await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"discovery_exhausted",phase:"researching",
        summary:"Some criteria remain unresolved after the available public discovery actions.",
        payload:{reason:next.reason,plannerVersion:run.research_strategy,coverageIntentId:review.intentId,unresolvedCriterionKeys:review.coverage.unresolvedCriterionKeys}}));
    }
    if(!support.checks.some((c)=>c.decision==="supported"))return unresolved("no_supported_assertions");
    await session.write(async(db)=>{
      await setPhase(db,args.runId,"writing");
      await emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"writing",phase:"writing",summary:"Writing an answer from checked source evidence."});
    });
    if(opts.pauseAt==="writing")return;
    const result=await writeResearchReport(pool,config,session,{...target,sourceSupportIntentId:support.intentId,...(calculations.kind==="calculations"&&calculations.executions.length?{calculationPlanIntentId:calculations.intentId}:{})});
    if(result.kind!=="publication")return pendingOrBlocked(result);
    if(!result.accepted)return unresolved(result.reason);
    return;
  }
  return unresolved("research_iteration_limit");
}

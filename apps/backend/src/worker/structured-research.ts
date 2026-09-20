import { executeDocumentReconciliation } from "./document-reconciliation.js";
import { createHash } from "node:crypto";
import { prepareEvidenceSelection,usesEvidenceSelection } from "../modules/evidence-selections.js";
import { pendingClarificationField, ResearchBriefSchema } from "@deep/contracts";
import { executeCounterevidence } from "./counterevidence.js";
import { getCounterevidence } from "../modules/counterevidence.js";
import { publicSearchDigest,discoveryPolicyForNewSearch,DISCOVERY_ATTEMPT_RESERVE_MICRO } from "../ports/search.js";
import { executeCalculationPlanning } from "./calculation-planning.js";
import { executeScopeComparison } from "./scope-comparison.js";
import { compileResearchIntent,counterevidenceSearch,nextUninspectedSelection,EMPTY_SELECTION_RECOVERY_VERSION,evaluateDiscoveryContinuation,planSourceClass,nextSourceClass,constrainSourcePlan,isWeakSourceClass,independentConfirmationCount,freshnessPolicyForQuestion,sourcesHaveUnmetFreshness,discoveryContinuationGaps,furtherHistoricalSourceReadsNeeded,recordSearchCoverage,buildEvidenceNeeds,highestValueNeed,updateNeedsFromCoverage,applyNeedEvidence,planTypedQuery,policyFromRestrictions,withConfirmedPublicQueryTerms,DEEP_DISCOVERY_CEILING,extractCandidates,buildCandidateLedger,reopenExclusions,mergeCandidateRecords,impactForCorrection,type CandidateLedgerCoverage,type SourceClass } from "@deep/research-core";
import { pendingQueryAuthorization,persistFreshnessPolicy,persistSearchCoverage,hasPublicQueryApproval,loadRunStoredSources,recordQueryAuthorization,authorizeDiscoveryQuery,loadPrivateDocumentText,loadApprovedPrivateTerms,queryAuthorizationDigest } from "../modules/retrieval-intelligence.js";
import { runRemainingBudgetMicro } from "../modules/live-spend.js";
import { admitResearchIteration,loadDiscoveryAttempts,loadEvidenceNeeds,persistEvidenceNeeds,loadCandidateLedger,persistCandidateLedger,loadReadablePassageIds } from "../modules/research-controller.js";
import { executeConclusionChallenges } from "./conclusion-challenges.js";
import { nextStrategySearch } from "../ports/research-strategy.js";
import type pg from "pg";
import type { AppConfig } from "../platform/config.js";
import { getRun,getBrief,emitEvent,setPhase,markTerminal,setPendingInput } from "../modules/runs.js";
import { settleRun } from "../modules/billing.js";
import type { FencedSession } from "./fenced-session.js";
import { ensureResearchTask } from "./research-task.js";
import { ingestAttachments } from "./attachment-ingestion.js";
import { extractEvidenceAssertions } from "./assertion-extraction.js";
import { executeAssertionSupport } from "./support-execution.js";
import { executeCoverageReview } from "./research-coverage.js";
import { performPublicSearch } from "./public-search.js";
import { executeSourceRead } from "./source-reading.js";
import { revalidateSourcePolicy, adoptSearchSources, adoptDirectUrls } from "../modules/search-sources.js";
import { writeResearchReport } from "./research-writer.js";

function confirmedDiscoveryQuery(brief:{originalQuestion:string;constraints:{field:string;value:string;origin?:string}[]},query:string) {
  return withConfirmedPublicQueryTerms(query,brief.constraints);
}
function confirmedDiscoverySearch<T extends {action:{type:string;query?:string}}>(brief:{originalQuestion:string;constraints:{field:string;value:string;origin?:string}[]},proposal:T):T {
  if(proposal.action.type!=="search"||typeof proposal.action.query!=="string")return proposal;
  return {...proposal,action:{...proposal.action,query:confirmedDiscoveryQuery(brief,proposal.action.query)}};
}

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
  const CONCURRENT_SOURCE_READS=3;
  const readAdoptedSources=async(taskId:string,handles:string[],questionKeys:string[],rationale:string)=>{
    for(let i=0;i<handles.length;i+=CONCURRENT_SOURCE_READS){
      const stored=await loadRunStoredSources(pool,{accountId:args.accountId,runId:args.runId});
      if(!furtherHistoricalSourceReadsNeeded({question:brief.originalQuestion,sources:stored})) break;
      const batch=handles.slice(i,i+CONCURRENT_SOURCE_READS);
      const settled=await Promise.allSettled(batch.map(async(sourceHandle)=>{
        const read=await executeSourceRead(config,session,{...args,taskId,proposal:{
          rationale,action:{type:"fetch",sourceHandle,questionKeys}}});
        if(read.kind!=="read") await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"source_unreadable",phase:"researching",
          summary:"A source could not be read; research continues with remaining evidence.",payload:{sourceHandle,reason:read.kind==="blocked"?read.reason:"source_read_outcome_unknown"}}));
      }));
      const fatal=settled.find((r):r is PromiseRejectedResult=>r.status==="rejected");
      if(fatal)throw fatal.reason;
    }
  };
  const pauseForQueryApproval=async(proposedQuery=brief.originalQuestion):Promise<"paused"|"blocked">=>session.write(async(db)=>{
    const existingPending=await pendingQueryAuthorization(db,args);
    const queryDigest=queryAuthorizationDigest(proposedQuery);
    const auth=authorizeDiscoveryQuery({
      question:brief.originalQuestion,
      query:proposedQuery,
      privateDocumentText:await loadPrivateDocumentText(db,args.accountId,{runId:args.runId,briefRevision:args.briefRevision}),
      approvedPrivateTerms:await loadApprovedPrivateTerms(db,{accountId:args.accountId,runId:args.runId,briefRevision:args.briefRevision,queryDigest}),
    });
    if(!existingPending&&auth.kind==="blocked")return "blocked";
    const privateTerms=auth.terms.filter((t)=>t.provenance==="private-document-derived").map((t)=>t.token);
    if(!existingPending) await recordQueryAuthorization(db,{
      accountId:args.accountId,
      runId:args.runId,
      briefRevision:args.briefRevision,
      proposedQuery:auth.query,
      authorization:{...auth,kind:"permission_required",reason:"document_search_requires_public_query_approval",privateTermsRequiringApproval:privateTerms},
    });
    const pending = await pendingQueryAuthorization(db, { accountId: args.accountId, runId: args.runId, briefRevision: args.briefRevision });
    if (!pending) throw new Error("pending_query_missing");
    await setPendingInput(db, { ...args, type: "query_authorization", id: pending.id });
    await emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"clarification_needed",phase:"preparing",
      summary:"Need approval before searching the public web with this document.",payload:{reason:"document_search_requires_public_query_approval",queryDigest}});
    return "paused";
  });
  // A document-add obligation is derived from immutable owned brief membership,
  // so deleting a change-set cannot turn unread new input into old-answer success.
  let appendedAttachmentIds:string[]=[];
  let parentConstraints=brief.constraints;
  if(run.parent_run_id){
    const previous=await session.write(db=>db.query(`SELECT b.payload FROM runs r JOIN research_briefs b ON b.id=r.brief_id
      WHERE r.id=$1 AND r.account_id=$2 AND b.account_id=$2`,[run.parent_run_id,args.accountId]));
    const parentBrief=ResearchBriefSchema.safeParse(previous.rows[0]?.payload);
    if(!parentBrief.success)return unresolved("correction_parent_basis_unavailable");
    parentConstraints=parentBrief.data.constraints;
    appendedAttachmentIds=brief.attachmentIds.filter(id=>!parentBrief.data.attachmentIds.includes(id));
  }
  const correction=await session.write((db)=>db.query("SELECT reopen_discovery FROM research_change_sets WHERE run_id=$1 AND account_id=$2",[args.runId,args.accountId]));
  // A known unavailable required capability must fail before any model preparation cost.
  if(correction.rows[0]?.reopen_discovery&&!brief.attachmentIds.length&&!config.structuredDiscoveryEnabled)return unresolved("correction_rediscovery_disabled");
  const recoveryPolicy=(await session.write(db=>db.query("SELECT evidence_recovery_policy FROM runs WHERE id=$1 AND account_id=$2 AND brief_revision=$3",[args.runId,args.accountId,args.briefRevision]))).rows[0]?.evidence_recovery_policy;
  if(!["none.v1",EMPTY_SELECTION_RECOVERY_VERSION].includes(recoveryPolicy))return unresolved("evidence_recovery_policy_unavailable");
  const intent=compileResearchIntent(brief.originalQuestion,{knownConstraints:brief.constraints});
  if(intent.clarificationDecision.ask){
    await session.write(async(db)=>{
      await setPhase(db,args.runId,"preparing");
      const first=intent.clarificationDecision.questions[0];
      await emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"clarify",phase:"preparing",
        summary:first?.prompt??"Which jurisdiction should this answer apply to?",
        payload:{questions:intent.clarificationDecision.questions}});
      await setPendingInput(db, { ...args, type: "clarification", field: pendingClarificationField(first?.field) });
    });
    return;
  }
  const prepared=await ensureResearchTask(pool,config,session,args);
  if(prepared.kind!=="task")return pendingOrBlocked(prepared);
  const runPublicSearch=async(proposal:unknown,sourceClass?:SourceClass)=>{
    const expanded=proposal&&typeof proposal==="object"&&"action" in proposal
      ?confirmedDiscoverySearch(brief,proposal as {action:{type:string;query?:string}})
      :proposal;
    try {
      return await performPublicSearch(pool,config,session,{...args,taskId:prepared.task.id,proposal:expanded,sourceClass});
    } catch(error) {
      if(!(error instanceof Error)||error.message!=="document_search_requires_public_query_approval")throw error;
      const query=typeof expanded==="object"&&expanded&&"action" in expanded?String((expanded as {action?:{query?:string}}).action?.query??brief.originalQuestion):brief.originalQuestion;
      const pause=await pauseForQueryApproval(query);
      if(pause==="blocked")return {kind:"blocked" as const,reason:"unapproved_public_query_terms"};
      return {kind:"paused" as const};
    }
  };
  const requiredProof=await session.write(db=>db.query(`SELECT 1 FROM runs r WHERE r.id=$1 AND r.account_id=$2 AND r.counterevidence_required_revision=$3
    AND NOT EXISTS(SELECT 1 FROM counterevidence_checks c WHERE c.run_id=r.id AND c.account_id=r.account_id AND c.brief_revision=$3)`,[args.runId,args.accountId,args.briefRevision]));
  if(requiredProof.rowCount)return unresolved("required_challenge_proof_missing");
  await ingestAttachments(pool,run,brief,session);
  const openingDigest=queryAuthorizationDigest(authorizeDiscoveryQuery({question:brief.originalQuestion,query:brief.originalQuestion}).query);
  const publicQueryApproved=!brief.attachmentIds.length||await session.write((db)=>hasPublicQueryApproval(db,{accountId:args.accountId,runId:args.runId,briefRevision:args.briefRevision,queryDigest:openingDigest,terms:[]}));
  for(const id of appendedAttachmentIds){
    const readable=await session.write(db=>db.query(`SELECT 1 FROM attachments a
      JOIN sources s ON s.canonical_locator='attachment://'||a.id::text AND s.account_id=a.account_id
      JOIN source_versions v ON v.source_id=s.id AND v.account_id=a.account_id AND v.content_hash=a.sha256
      JOIN authorized_run_passages p ON p.source_version_id=v.id AND p.account_id=a.account_id
      WHERE a.id=$1 AND a.account_id=$2 AND a.deleted_at IS NULL AND a.raw_bytes IS NOT NULL
        AND p.run_id=$3 AND v.access_level IN ('partial-text','full-text') LIMIT 1`,[id,args.accountId,args.runId]));
    if(!readable.rowCount)return unresolved("appended_document_unavailable");
  }
  await session.write(async(db)=>{
    await revalidateSourcePolicy(db,args);
    await persistFreshnessPolicy(db,{...args,question:brief.originalQuestion});
    await setPhase(db,args.runId,"researching");
    await emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"criteria_prepared",phase:"researching",
      summary:"Research questions and criteria are ready.",payload:{taskId:prepared.task.id,briefRevision:args.briefRevision,strategy:run.research_strategy}});
  });
  if(opts.pauseAt==="researching")return;
  const selectionEnabled=await session.write(db=>usesEvidenceSelection(db,args));
  const recoveryEnabled=selectionEnabled&&recoveryPolicy===EMPTY_SELECTION_RECOVERY_VERSION;
  let recoveryRequiredIds:string[]=[];const inspectedIds=new Set<string>();
  const selectPassages=()=>session.write((db)=>db.query<{id:string}>(`SELECT p.id FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id
    JOIN sources s ON s.id=v.source_id WHERE p.account_id=$1 AND p.run_id=$2 AND v.account_id=$1 AND s.account_id=$1
    AND v.access_level IN ('partial-text','full-text') ORDER BY p.id LIMIT $3`,[args.accountId,args.runId,selectionEnabled?1:null]));
  let selected=await selectPassages();
  const sourcePolicy=policyFromRestrictions(brief.sourceRestrictions);
  if(sourcePolicy.userSuppliedUrls.length&&config.liveRetrievalEnabled){
    const direct=await session.write((db)=>adoptDirectUrls(db,args));
    if(direct.length){
      await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"sources_found",phase:"researching",
        summary:"Opened a user-supplied source.",payload:{count:direct.length}}));
      await readAdoptedSources(prepared.task.id,direct,Object.keys(prepared.task.questionIds),"Read the user-supplied source.");
      selected=await selectPassages();
    }
  }
  const savedChallenge=await session.write(db=>getCounterevidence(db,args));
  const challengeQuery=savedChallenge?counterevidenceSearch(brief.originalQuestion,savedChallenge.action.questionKeys):null;
  // The search receipt may commit before its challenge pointer. Recover its purpose
  // from the exact server-owned request digest without issuing an ordinary search.
  const challengeDigest=challengeQuery?publicSearchDigest(challengeQuery.action.query,discoveryPolicyForNewSearch(run.model_policy_id).id):null;
  const priorDiscovery=await session.write((db)=>db.query(`SELECT 1 FROM search_operations s
    WHERE s.run_id=$1 AND s.account_id=$2 AND s.brief_revision=$3
    AND NOT EXISTS(SELECT 1 FROM counterevidence_checks c WHERE c.search_intent_id=s.intent_id AND c.run_id=s.run_id AND c.account_id=s.account_id)
    AND NOT EXISTS(SELECT 1 FROM conclusion_challenges c WHERE c.search_intent_id=s.intent_id AND c.run_id=s.run_id AND c.account_id=s.account_id)
    AND (s.result->'receipt'->>'requestDigest') IS DISTINCT FROM $4::text LIMIT 1`,[args.runId,args.accountId,args.briefRevision,challengeDigest]));
  const discovered=await session.write((db)=>loadDiscoveryAttempts(db,args));
  const queries=[...discovered.queries];
  const classesAttempted:SourceClass[]=[...discovered.classesAttempted];
  let lastSourceCount=0;
  if(run.parent_run_id){
    const parentLedger=await session.write((db)=>loadCandidateLedger(db,{runId:run.parent_run_id!}));
    if(parentLedger){
      const impact=impactForCorrection({previousConstraints:parentConstraints,nextConstraints:brief.constraints,
        reopenedDiscovery:Boolean(correction.rows[0]?.reopen_discovery),dependencyCompleteness:"unknown"});
      await session.write((db)=>persistCandidateLedger(db,{...args,ledger:reopenExclusions(parentLedger,impact.changedInputs),searches:0,
        coverage:{queriesAttempted:[],sourceClassesAttempted:[],reopened:impact.changedInputs.length>0}}));
    }
  }
  const sameQuery=(a:string,b:string)=>a.trim().toLocaleLowerCase("en").replace(/\s+/gu," ")===b.trim().toLocaleLowerCase("en").replace(/\s+/gu," ");
  if(config.structuredDiscoveryEnabled&&(!selected.rowCount||priorDiscovery.rowCount||(correction.rows[0]?.reopen_discovery&&!brief.attachmentIds.length))) {
    const questionKeys=Object.keys(prepared.task.questionIds);
    if(brief.attachmentIds.length&&!publicQueryApproved){
      const pause=await pauseForQueryApproval();
      if(pause==="blocked")return unresolved("unapproved_public_query_terms");
      return;
    }
    if(!config.liveRetrievalEnabled)return unresolved("public_reading_disabled");
    const openingPlan=planSourceClass(brief.originalQuestion);
    const openingQuery=confirmedDiscoveryQuery(brief,brief.originalQuestion);
    const alreadyOpened=queries.some((q)=>sameQuery(q,brief.originalQuestion)||sameQuery(q,openingQuery));
    if(!alreadyOpened){
      classesAttempted.push(openingPlan.primary);
      queries.push(openingQuery);
      await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"searching",phase:"researching",
        summary:"Searching public sources.",payload:{count:queries.length}}));
      const search=await runPublicSearch({
        rationale:"Find public evidence for the original research question.",action:{type:"search",query:openingQuery,questionKeys,
          publicQueryBasis:{start:0,end:brief.originalQuestion.length,quote:brief.originalQuestion}}},openingPlan.primary);
      if(search.kind==="paused")return;
      if(search.kind==="pending")return pendingOrBlocked(search);
      if(search.kind==="search"){
        const sources=await session.write((db)=>adoptSearchSources(db,{...args,taskId:prepared.task.id,intentId:search.intentId}));
        await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"sources_found",phase:"researching",
          summary:"Found sources.",payload:{count:sources.length}}));
        await readAdoptedSources(prepared.task.id,sources,questionKeys,"Read the discovered source before assessing its assertions.");
        selected=await selectPassages();
      } else {
        await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"search_failed",phase:"researching",
          summary:"A search could not run; research continues with remaining evidence.",payload:{reason:search.reason}}));
      }
    } else if(!selected.rowCount){
      for(const intentId of discovered.intentIds){
        const sources=await session.write((db)=>adoptSearchSources(db,{...args,taskId:prepared.task.id,intentId}));
        await readAdoptedSources(prepared.task.id,sources,questionKeys,"Read previously discovered sources after a worker restart.");
      }
      selected=await selectPassages();
    }
  }
  const syncCandidateLedger=async(coverage:CandidateLedgerCoverage)=>{
    const {passages,readableIds}=await session.write((db)=>loadReadablePassageIds(db,args));
    const existing=(await session.write((db)=>loadCandidateLedger(db,args)))?.entries??[];
    const merged=mergeCandidateRecords(existing,extractCandidates(passages,brief.constraints),{readablePassageIds:readableIds});
    const ledger=buildCandidateLedger(merged,coverage);
    await session.write((db)=>persistCandidateLedger(db,{...args,ledger,searches:coverage.queriesAttempted.length,coverage}));
    return ledger;
  };
  // Repeat actual extraction/checking after new evidence, never count search events as coverage.
  let prior:{extraction:Awaited<ReturnType<typeof extractEvidenceAssertions>>&{kind:"extraction"};support:Awaited<ReturnType<typeof executeAssertionSupport>>&{kind:"support"};calculations:Awaited<ReturnType<typeof executeCalculationPlanning>>;target:{runId:string;accountId:string;fence:number;briefRevision:number;taskId:string;extractionIntentId:string;supportIntentId?:string}}|null=null;
  for(let localPass=0;localPass<4;localPass++) {
    const inputDigest=createHash("sha256").update(JSON.stringify({task:prepared.task.id,evidenceRevision:(await getRun(pool,args.runId))!.evidence_revision,passages:selected.rows.map(p=>p.id).sort(),recovery:[...recoveryRequiredIds].sort(),discoveryIntents:(await loadDiscoveryAttempts(pool,args)).intentIds.sort()})).digest("hex");
    const iteration=await session.write(db=>admitResearchIteration(db,{...args,taskId:prepared.task.id,inputDigest}));
    if(iteration===null)return unresolved("research_iteration_limit");
    // Do not silently replace discovery with fixtures or truncate a document to fit the context.
    if(!selected.rowCount){
      if(config.structuredDiscoveryEnabled&&publicQueryApproved&&config.liveRetrievalEnabled){
        const plan=constrainSourcePlan(planSourceClass(brief.originalQuestion),policyFromRestrictions(brief.sourceRestrictions).mode);
        const nextClass=nextSourceClass(plan,classesAttempted,{weak:true,duplicative:false,stale:false});
        const next=nextStrategySearch(run.research_strategy,{question:brief.originalQuestion,task:prepared.task.specification,
          unresolvedCriterionKeys:prepared.task.specification.criteria.map((c)=>c.key),queries,ceiling:DEEP_DISCOVERY_CEILING});
        const questionKeys=next.kind==="search"?next.proposal.action.questionKeys:Object.keys(prepared.task.questionIds);
        const proposal=next.kind==="search"?next.proposal:{
          rationale:"Pivot source class after blocked full-page reads.",
          action:{type:"search" as const,query:brief.originalQuestion,questionKeys,
            publicQueryBasis:{start:0,end:brief.originalQuestion.length,quote:brief.originalQuestion}},
        };
        const classAlreadyUsed=classesAttempted.includes(nextClass);
        // Generic-web with no distinct criterion query must fail closed after unreadable hits.
        // Official/specialized classes may pivot once onto an unused fallback (blocked regulator pages).
        if((next.kind==="search"||(plan.primary!=="generic-web"&&!classAlreadyUsed))&&queries.length<DEEP_DISCOVERY_CEILING){
          classesAttempted.push(nextClass);
          queries.push(confirmedDiscoveryQuery(brief,proposal.action.query));
          await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"plan_pivot",phase:"researching",
            summary:"Full pages were blocked; searching a different source class.",payload:{reason:"readable_evidence_unavailable",sourceClass:nextClass}}));
          await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"searching",phase:"researching",
            summary:"Searching public sources.",payload:{count:queries.length}}));
          const search=await runPublicSearch(proposal,nextClass);
          if(search.kind==="paused")return;
          if(search.kind==="pending")return pendingOrBlocked(search);
          if(search.kind==="search"){
            const adopted=await session.write((db)=>adoptSearchSources(db,{...args,taskId:prepared.task.id,intentId:search.intentId}));
            await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"sources_found",phase:"researching",
              summary:"Found sources.",payload:{count:adopted.length}}));
            await readAdoptedSources(prepared.task.id,adopted,questionKeys,"Read evidence after blocked source pages.");
            selected=await selectPassages();recoveryRequiredIds=[];inspectedIds.clear();
            if(selected.rowCount)continue;
          }
        }
      }
      return unresolved("readable_evidence_unavailable");
    }
    const selection=selectionEnabled?await session.write(db=>prepareEvidenceSelection(db,{...args,requiredIds:recoveryRequiredIds})):null;
    if(selection&&selection.kind!=="selected")return unresolved(selection.reason);
    const extraction=await extractEvidenceAssertions(pool,config,session,{...args,taskId:prepared.task.id,passageIds:selection?selection.passageIds:selected.rows.map(p=>p.id),selectionId:selection?.context.id});
    const writeFromPrior=async(reason:string)=>{
      await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"plan_pivot",phase:"researching",
        summary:"A later evidence pass failed; writing from previously checked evidence.",payload:{reason}}));
      const result=await writeResearchReport(pool,config,session,{...prior!.target,sourceSupportIntentId:prior!.support.intentId,...(prior!.calculations.kind==="calculations"&&prior!.calculations.executions.length?{calculationPlanIntentId:prior!.calculations.intentId}:{})});
      if(result.kind!=="publication")return pendingOrBlocked(result);
      if(!result.accepted)return unresolved(result.reason);
      await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"report_ready",phase:"writing",
        summary:"Answer ready."}));
      return;
    };
    if(extraction.kind!=="extraction"){
      if(prior)return writeFromPrior(extraction.kind==="blocked"?extraction.reason:"extraction_unavailable");
      return pendingOrBlocked(extraction);
    }
    if(!extraction.output.assertions.length){
      if(prior)return writeFromPrior("no_relevant_assertions");
      if(config.structuredDiscoveryEnabled&&publicQueryApproved&&config.liveRetrievalEnabled){
        const next=nextStrategySearch(run.research_strategy,{question:brief.originalQuestion,task:prepared.task.specification,
          unresolvedCriterionKeys:prepared.task.specification.criteria.map((c)=>c.key),queries,ceiling:DEEP_DISCOVERY_CEILING});
        if(next.kind==="search"){
          const sourceClass=planSourceClass(brief.originalQuestion).primary;
          queries.push(confirmedDiscoveryQuery(brief,next.proposal.action.query));
          await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"searching",phase:"researching",
            summary:"Searching public sources.",payload:{count:queries.length}}));
          const search=await runPublicSearch(next.proposal,sourceClass);
          if(search.kind==="paused")return;
          if(search.kind==="pending")return pendingOrBlocked(search);
          if(search.kind==="search"){
            const adopted=await session.write((db)=>adoptSearchSources(db,{...args,taskId:prepared.task.id,intentId:search.intentId}));
            await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"sources_found",phase:"researching",
              summary:"Found sources.",payload:{count:adopted.length}}));
            await readAdoptedSources(prepared.task.id,adopted,next.proposal.action.questionKeys,"Read evidence after an empty extraction.");
            selected=await selectPassages();recoveryRequiredIds=[];inspectedIds.clear();
            continue;
          }
        }
      }
      if(!recoveryEnabled||!selection)return unresolved("no_relevant_assertions");
      for(const id of selection.passageIds)inspectedIds.add(id);
      const next=nextUninspectedSelection(brief.originalQuestion,selection.inventoryPassages,[...inspectedIds]);
      if(next.kind!=="recovery")return unresolved(next.reason==="inspection_inventory_exhausted"?"no_relevant_assertions":next.reason);
      if(iteration===3)return unresolved("evidence_selection_recovery_limit");
      recoveryRequiredIds=next.requiredIds;continue;
    }
    const target={...args,taskId:prepared.task.id,extractionIntentId:extraction.intentId};
    const support=await executeAssertionSupport(pool,config,session,target);
    if(support.kind!=="support"){
      if(prior)return writeFromPrior(support.kind==="blocked"?support.reason:"support_unavailable");
      return pendingOrBlocked(support);
    }
    const supportedNow=support.checks.some((c)=>c.decision==="supported");
    if(!supportedNow && prior)return writeFromPrior("later_support_unproven");
    if(supportedNow) prior={extraction,support,calculations:{kind:"not_applicable",reason:"pending_calculation_planning"},target:{...target,supportIntentId:support.intentId}};
    await syncCandidateLedger({queriesAttempted:queries,sourceClassesAttempted:classesAttempted});
    const challenge=await executeCounterevidence(pool,config,session,{...target,supportIntentId:support.intentId});
    if(challenge.kind==="permission_required"){await pauseForQueryApproval();return;}
    const conclusions=await executeConclusionChallenges(pool,config,session,{...target,supportIntentId:support.intentId},{
      task:prepared.task.specification,assertions:extraction.output.assertions,checks:support.checks,originalQuestion:brief.originalQuestion});
    if(conclusions.kind==="permission_required"){await pauseForQueryApproval();return;}
    if(challenge.kind==="challenge") {
      await session.write(db=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"counterevidence_checked",phase:"researching",
        summary:"A bounded counterevidence check recorded its inspected evidence and remaining uncertainty.",payload:{challengeId:challenge.id,outcome:challenge.outcome,version:challenge.version}}));
      if(challenge.evidenceChanged){selected=await selectPassages();recoveryRequiredIds=[];inspectedIds.clear();continue;}
    }
    if(extraction.output.assertions.length>=2) {
      const comparison=await executeScopeComparison(session,{...target,supportIntentId:support.intentId,
        action:{type:"compare_scopes",claimKeys:extraction.output.assertions.map(a=>a.key)}});
      if(comparison.kind!=="comparison")return unresolved(comparison.reason);
    }
    const calculations=await executeCalculationPlanning(pool,config,session,{...target,supportIntentId:support.intentId});
    if(calculations.kind!=="calculations"&&calculations.kind!=="not_applicable"){
      if(prior)return writeFromPrior(calculations.kind==="blocked"?calculations.reason:"calculation_unavailable");
      return pendingOrBlocked(calculations);
    }
    if(supportedNow) prior={extraction,support,calculations,target:{...target,supportIntentId:support.intentId}};
    if(calculations.kind==="calculations"&&calculations.executions.length)await session.write(db=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"calculations_executed",phase:"researching",
      summary:"Requested arithmetic was evaluated against checked source quantities.",payload:{planIntentId:calculations.intentId,
       results:calculations.executions.map(e=>({key:e.key,calculationId:e.calculationId,status:e.result.status,reason:e.result.reason}))}}));
    const review=await executeCoverageReview(pool,config,session,{...target,supportIntentId:support.intentId});
    if(review.kind!=="coverage"){
      if(prior)return writeFromPrior(review.kind==="blocked"?review.reason??"coverage_unavailable":"coverage_unavailable");
      return pendingOrBlocked(review);
    }
    await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"evidence_checked",phase:"researching",
      summary:review.coverage.complete?"The checked evidence answers the research questions.":"Some questions remain unresolved in the checked evidence.",
      payload:{extractionIntentId:extraction.intentId,supportIntentId:support.intentId,coverageIntentId:review.intentId,complete:review.coverage.complete}}));
    const remainingBudgetMicro=await runRemainingBudgetMicro(pool,args);
    const sources=await loadRunStoredSources(pool,{accountId:args.accountId,runId:args.runId});
    const gaps=discoveryContinuationGaps({
      question:brief.originalQuestion,
      coverageUnresolvedKeys:review.coverage.unresolvedCriterionKeys,
      allCriterionKeys:prepared.task.specification.criteria.map((c)=>c.key),
      freshnessUnmet:sourcesHaveUnmetFreshness(freshnessPolicyForQuestion(brief.originalQuestion),sources),
      hasSupportedAssertions:supportedNow,
    });
    const freshnessUnmet=gaps.freshnessUnmet;
    const unresolvedCriterionKeys=gaps.unresolvedCriterionKeys;
    const ledger=await session.write((db)=>loadCandidateLedger(db,args));
    const criterionSignals=prepared.task.specification.criteria.map((criterion)=>({
      criterionKey:criterion.key,
      freshnessUnmet,
      affectedCandidates:ledger?.entries.filter((entry)=>entry.status!=="excluded").length??0,
      sourceQuality:(sources.some((source)=>!isWeakSourceClass(source))?"primary":sources.length?"secondary":"unknown") as "primary"|"secondary"|"unknown",
      nextCostMicro:DISCOVERY_ATTEMPT_RESERVE_MICRO,
    }));
    const needArgs={
      originalQuestion:brief.originalQuestion,
      criterionKeys:prepared.task.specification.criteria.map((c)=>c.key),
      unresolvedCriterionKeys,
      remainingBudgetMicro,
      nextCostMicro:DISCOVERY_ATTEMPT_RESERVE_MICRO,
      criteria:prepared.task.specification.criteria,
      criterionSignals,
    };
    const storedNeeds=await session.write((db)=>loadEvidenceNeeds(db,args));
    let needs=storedNeeds.length?updateNeedsFromCoverage(storedNeeds,needArgs):buildEvidenceNeeds(needArgs);
    for(const key of needArgs.criterionKeys)needs=applyNeedEvidence(needs,key,!unresolvedCriterionKeys.includes(key));
    await session.write((db)=>persistEvidenceNeeds(db,{...args,needs}));
    await syncCandidateLedger({queriesAttempted:queries,sourceClassesAttempted:classesAttempted});
    if((unresolvedCriterionKeys.length>0||freshnessUnmet)&&config.structuredDiscoveryEnabled&&publicQueryApproved&&config.liveRetrievalEnabled) {
      const next=nextStrategySearch(run.research_strategy,{question:brief.originalQuestion,task:prepared.task.specification,
        unresolvedCriterionKeys,queries,ceiling:DEEP_DISCOVERY_CEILING});
      const plan=constrainSourcePlan(planSourceClass(brief.originalQuestion),policyFromRestrictions(brief.sourceRestrictions).mode);
      const failedQueries=Number((await pool.query(`SELECT count(*)::int AS n FROM search_operations s WHERE s.run_id=$1 AND s.account_id=$2 AND COALESCE(jsonb_array_length(s.result->'hits'),0)=0`,[args.runId,args.accountId])).rows[0]?.n??0);
      const nextClass=nextSourceClass(plan,classesAttempted,{
        weak:sources.length>0&&sources.every((s)=>isWeakSourceClass(s)),
        duplicative:sources.length>1&&independentConfirmationCount(sources)<sources.length,
        stale:freshnessUnmet,
      });
      const breadth=evaluateDiscoveryContinuation({
        unresolvedConsequential:unresolvedCriterionKeys.length>0,
        distinctStrategyRemains:next.kind==="search",
        sources,
        novelty:sources.length>lastSourceCount?1:0,
        expectedInformationGain:next.kind==="search"?"high":"none",
        remainingBudgetMicro,
        nextCostMicro:DISCOVERY_ATTEMPT_RESERVE_MICRO,
        freshnessUnmet,
        priorFailedQueries:failedQueries,
        queriesIssued:queries.length,
        queriesAttempted:queries,
        sourceClassesAttempted:classesAttempted.length?classesAttempted:[plan.primary],
      });
      const topNeed=highestValueNeed(needs);
      await syncCandidateLedger({
        queriesAttempted:queries,
        sourceClassesAttempted:classesAttempted.length?classesAttempted:[plan.primary],
        stop:breadth.continue?null:{reason:next.kind==="search"?breadth.reason:next.reason,stopPolicy:breadth.stopPolicy},
      });
      const planned=planTypedQuery({question:brief.originalQuestion,query:next.kind==="search"?next.proposal.action.query:brief.originalQuestion});
      if(next.kind==="search"&&breadth.continue&&topNeed?.nextAction.kind==="search"&&planned.authorizationKind==="authorized"&&!planned.privateTermsRequiringApproval.length&&!planned.unclassifiedTerms.length) {
        if(freshnessUnmet) await session.write(db=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"freshness_checking",phase:"researching",
          summary:"Checking how current the evidence is."}));
        classesAttempted.push(nextClass);
        queries.push(next.proposal.action.query);
        lastSourceCount=sources.length;
        await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"searching",phase:"researching",
          summary:"Searching public sources.",payload:{count:queries.length}}));
        const search=await runPublicSearch(next.proposal,nextClass);
        if(search.kind==="paused")return;
        if(search.kind==="pending")return pendingOrBlocked(search);
        if(search.kind!=="search"){
          await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"search_failed",phase:"researching",
            summary:"A search could not run; research continues with remaining evidence.",payload:{reason:search.reason}}));
          continue;
        }
        const adopted=await session.write((db)=>adoptSearchSources(db,{...args,taskId:prepared.task.id,intentId:search.intentId}));
        await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"sources_found",phase:"researching",
          summary:"Found sources.",payload:{count:adopted.length}}));
        await readAdoptedSources(prepared.task.id,adopted,next.proposal.action.questionKeys,"Read evidence for an unresolved criterion.");
        selected=await selectPassages();recoveryRequiredIds=[];inspectedIds.clear();
        continue;
      }
      await session.write(async(db)=>{
        const coverage=recordSearchCoverage({
          queriesAttempted:breadth.coverage.queriesAttempted,
          sourceClassesAttempted:breadth.coverage.sourceClassesAttempted,
          blockedOrInaccessible:breadth.coverage.blockedOrInaccessible,
          unresolvedAbsence:breadth.coverage.unresolvedAbsence,
          ...(freshnessUnmet?{freshnessUnmet:true,unresolvedFreshnessCriteria:unresolvedCriterionKeys}:{}),
        });
        await persistSearchCoverage(db,{accountId:args.accountId,runId:args.runId,coverage});
        await emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"discovery_exhausted",phase:"researching",
          summary:"Some criteria remain unresolved after the available public discovery actions.",
          payload:{reason:next.kind==="search"?breadth.reason:next.reason,plannerVersion:run.research_strategy,coverageIntentId:review.intentId,unresolvedCriterionKeys:review.coverage.unresolvedCriterionKeys,stopPolicy:breadth.stopPolicy}});
      });
    }
    if(!support.checks.some((c)=>c.decision==="supported")){
      if(prior)return writeFromPrior("no_supported_assertions");
      return unresolved("no_supported_assertions");
    }
    if(brief.attachmentIds.length){
      const reconciled=await executeDocumentReconciliation(pool,config,session,target);
      if(reconciled.kind!=="reconciled")return pendingOrBlocked(reconciled);
    }
    await session.write(async(db)=>{
      await setPhase(db,args.runId,"writing");
      await emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"writing",phase:"writing",summary:"Writing an answer from checked source evidence."});
    });
    if(opts.pauseAt==="writing")return;
    const result=await writeResearchReport(pool,config,session,{...target,sourceSupportIntentId:support.intentId,...(calculations.kind==="calculations"&&calculations.executions.length?{calculationPlanIntentId:calculations.intentId}:{})});
    if(result.kind!=="publication")return pendingOrBlocked(result);
    if(!result.accepted)return unresolved(result.reason);
    await session.write((db)=>emitEvent(db,{runId:args.runId,accountId:args.accountId,type:"report_ready",phase:"writing",
      summary:"Answer ready."}));
    return;
  }
  return unresolved("research_iteration_limit");
}

import type { ResearchModelOutput } from "@deep/contracts";
import { validateModelBindings } from "./model-bindings.js";
import {
  assertionCoversRequestedBinding,
  assertionCoversRequestedEntity,
  assertionCoversRequestedFact,
  requestedCriterionObligations,
} from "./semantic-obligations.js";
import type { ScopedSupportResult } from "./scoped-support.js";

export const RESEARCH_COVERAGE_VERSION="research-coverage.v1";
type Task=ResearchModelOutput<"brief">;
type Assertion=ResearchModelOutput<"extract_assertions">["assertions"][number];
type Review=ResearchModelOutput<"review_coverage">;
export type CoverageResult={version:typeof RESEARCH_COVERAGE_VERSION;complete:boolean;
  questions:{questionKey:string;status:Review["questions"][number]["status"];assertionKeys:string[];reason:string;failedChecks:string[]}[];
  unresolvedCriterionKeys:string[];omittedRequirements:Review["omittedRequirements"]};
export type LimitedCoverageView={questions:{questionKey:string;status:string}[];unresolvedCriterionKeys:string[]};
const normalize=(s:string)=>s.toLowerCase().replace(/\s+/gu," ").trim();
const obligationKey=(s:string)=>normalize(s).replace(/[^a-z0-9]+/gu,"_").replace(/^_|_$/gu,"").slice(0,80)||"unknown";

export function unresolvedCriticalQuestionLimitation(questionKey:string,status:string):string {
  return `Unresolved critical question ${questionKey} (${status}).`;
}
export function unresolvedCriticalCriterionLimitation(criterionKey:string):string {
  return `Unresolved critical criterion ${criterionKey}.`;
}

/** Limited publication must name every unrestored critical question and hard criterion. Outcome labels are not proof. */
export function limitedCoverageLimitations(coverage:LimitedCoverageView,task:Pick<Task,"questions"|"criteria">):string[] {
  const questions=new Map(task.questions.map((q)=>[q.key,q]));
  const criteria=new Map(task.criteria.map((c)=>[c.key,c]));
  const limitations:string[]=[];
  for(const question of coverage.questions) {
    if(question.status==="supported")continue;
    if(questions.get(question.questionKey)?.importance!=="critical")continue;
    limitations.push(unresolvedCriticalQuestionLimitation(question.questionKey,question.status));
  }
  for(const key of coverage.unresolvedCriterionKeys) {
    if(criteria.get(key)?.importance!=="hard")continue;
    limitations.push(unresolvedCriticalCriterionLimitation(key));
  }
  return limitations;
}
export function limitedCoverageDisclosed(limitations:readonly string[],coverage:LimitedCoverageView,task:Pick<Task,"questions"|"criteria">):boolean {
  return limitedCoverageLimitations(coverage,task).every((limitation)=>limitations.includes(limitation));
}

/** Answer coverage is separate from candidate eligibility. A supported negative answer can cover a question.
 * The semantic review remains fallible; deterministic guards cannot certify its reasoning quality.
 */
export function resolveResearchCoverage(args:{question:string;task:Task;assertions:Assertion[];
  checks:Pick<ScopedSupportResult,"claimKey"|"decision">[];proposal:Review}):CoverageResult {
  const errors=validateModelBindings("review_coverage",args.proposal,{...args,passages:[],sources:[],approvedClaimKeys:[]});
  if(errors.length)throw new Error(`invalid_coverage_binding:${errors.join(",")}`);
  const questions=args.task.questions.map((question)=>{
    const review=args.proposal.questions.find((r)=>r.questionKey===question.key)!;
    const cited=review.assertionKeys.map((key)=>args.assertions.find((a)=>a.key===key)!);
    const failedChecks:string[]=[];
    const support=(key:string)=>args.checks.filter((c)=>c.claimKey===key);
    if(review.status==="supported") {
      if(cited.some((a)=>support(a.key).length!==1||support(a.key)[0]!.decision!=="supported"))failedChecks.push("assertion_not_supported");
      for(const key of question.criterionKeys) {
        const criterion=args.task.criteria.find((c)=>c.key===key);
        if(!criterion)throw new Error("coverage_task_criterion_missing");
        const relevant=cited.filter((a)=>a.criterionKeys.includes(key));
        if(!relevant.length)failedChecks.push(`criterion_without_assertion:${key}`);
        else if(!relevant.some((a)=>Object.entries(criterion.scope).every(([field,value])=>value===null||
          normalize(value)===normalize(a.scope[field as keyof Assertion["scope"]]??""))))failedChecks.push(`criterion_scope_mismatch:${key}`);
        const linkedQuestions=args.task.questions.filter((candidate)=>candidate.criterionKeys.includes(key));
        const allObligations=requestedCriterionObligations({originalQuestion:args.question,criterion,questions:linkedQuestions});
        const questionObligations=requestedCriterionObligations({originalQuestion:args.question,criterion,questions:[question]});
        const compound=linkedQuestions.length>1||allObligations.entities.length>1||allObligations.facts.length>1;
        if(compound) {
          for(const entity of questionObligations.entities) {
            if(!relevant.some((assertion)=>assertionCoversRequestedEntity(assertion,entity))) {
              failedChecks.push(`criterion_entity_without_assertion:${key}:${obligationKey(entity)}`);
            }
          }
          for(const fact of questionObligations.facts) {
            if(!relevant.some((assertion)=>assertionCoversRequestedFact(assertion,fact))) {
              failedChecks.push(`criterion_fact_without_assertion:${key}:${fact}`);
            }
          }
          for(const binding of questionObligations.bindings) {
            if(!relevant.some((assertion)=>assertionCoversRequestedBinding(assertion,binding))) {
              failedChecks.push(`criterion_obligation_without_assertion:${key}:${obligationKey(binding.entity)}:${binding.fact}`);
            }
          }
        }
        if(criterion.unresolvedAlternatives.length)failedChecks.push(`ambiguous_criterion:${key}`);
      }
      if(cited.some((a)=>!a.criterionKeys.some((key)=>question.criterionKeys.includes(key))))failedChecks.push("unrelated_assertion");
    }
    // A model cannot waive a requested question by marking it not applicable.
    if(review.status==="not_applicable")failedChecks.push("unapproved_requirement_waiver");
    return {questionKey:question.key,status:failedChecks.length?"unresolved_at_limit" as const:review.status,
      assertionKeys:review.assertionKeys,reason:review.reason,failedChecks};
  });
  const unresolvedCriterionKeys=args.task.criteria.filter((criterion)=>
    !args.task.questions.some((q)=>q.criterionKeys.includes(criterion.key)) ||
    args.task.questions.some((q)=>q.criterionKeys.includes(criterion.key)&&questions.find((r)=>r.questionKey===q.key)!.status!=="supported")
  ).map((c)=>c.key);
  return {version:RESEARCH_COVERAGE_VERSION,questions,unresolvedCriterionKeys,
    complete:questions.every((q)=>q.status==="supported")&&!unresolvedCriterionKeys.length&&!args.proposal.omittedRequirements.length&&!args.task.openAmbiguities.length,
    omittedRequirements:args.proposal.omittedRequirements};
}

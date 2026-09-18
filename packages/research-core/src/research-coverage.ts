import type { ResearchModelOutput } from "@deep/contracts";
import { validateModelBindings } from "./model-bindings.js";
import type { ScopedSupportResult } from "./scoped-support.js";

export const RESEARCH_COVERAGE_VERSION="research-coverage.v1";
type Task=ResearchModelOutput<"brief">;
type Assertion=ResearchModelOutput<"extract_assertions">["assertions"][number];
type Review=ResearchModelOutput<"review_coverage">;
export type CoverageResult={version:typeof RESEARCH_COVERAGE_VERSION;complete:boolean;
  questions:{questionKey:string;status:Review["questions"][number]["status"];assertionKeys:string[];reason:string;failedChecks:string[]}[];
  unresolvedCriterionKeys:string[];omittedRequirements:Review["omittedRequirements"]};
const normalize=(s:string)=>s.toLowerCase().replace(/\s+/gu," ").trim();

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

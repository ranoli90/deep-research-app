import { nextCriterionSearch, openingDiscoveryFromBrief } from "../src/discovery-planning.js";
import { investigationInstruction } from "../src/follow-up-router.js";
import { describe,it,expect } from "vitest";
import type { ResearchModelOutput } from "@deep/contracts";
import { limitedCoverageDisclosed,limitedCoverageLimitations,resolveResearchCoverage,unresolvedCriticalCriterionLimitation } from "../src/research-coverage.js";
import { resolveScopedSupport } from "../src/scoped-support.js";
const question="What area did Reef-X restore in 2024?";
const span={start:0,end:question.length,quote:question};
const scope={entity:"Reef-X",time:"2024",plan:null,version:null,geography:null,population:null};
const task:ResearchModelOutput<"brief">={objective:question,objectiveProvenance:span,intendedOutput:"answer",criteria:[{key:"area",description:"Reported area",field:"area",operator:"explain",value:null,unit:"hectares",importance:"hard",scope,provenance:span,group:"g",groupOperator:"all",unresolvedAlternatives:[]}],questions:[{key:"q",text:question,criterionKeys:["area"],importance:"critical",evidenceStandard:"reported measured area"}],assumptions:[],openAmbiguities:[],explicitExclusions:[]};
const text="Reef-X restored 12 hectares in 2024.";
const passage={id:"11111111-1111-4111-8111-111111111111",text,accessLevel:"partial-text"};
const evidence=[{passageId:passage.id,start:0,end:text.length,quote:text}];
const assertion={key:"a",candidateKey:null,criterionKeys:["area"],text,scope,quantities:[],evidence};
const checks=resolveScopedSupport({assertions:[assertion],passages:[passage],proposal:{assessments:[{claimKey:"a",status:"supported",evidence,scope,rationale:"Exact measured area",missingEvidence:[]}]}});
const proposal:ResearchModelOutput<"review_coverage">={questions:[{questionKey:"q",status:"supported",assertionKeys:["a"],reason:"The measured area answers the question"}],omittedRequirements:[]};
const args={question,task,assertions:[assertion],checks,proposal};
describe("W05 criterion-linked answer coverage",()=>{
 it("accepts a supported scoped answer, independently of source count",()=>expect(resolveResearchCoverage(args).complete).toBe(true));
 it("rejects empty support and partial assertions despite optimistic review",()=>{
  for(const changed of [[],[{...checks[0]!,decision:"partially_supported" as const}]])expect(resolveResearchCoverage({...args,checks:changed}).questions[0]!.failedChecks).toContain("assertion_not_supported");
 });
 it("keeps each conjunct unresolved without a relevant assertion",()=>{
  const changed={...task,criteria:[...task.criteria,{...task.criteria[0]!,key:"survival"}],questions:[{...task.questions[0]!,criterionKeys:["area","survival"]}]};
  const result=resolveResearchCoverage({...args,task:changed});expect(result.complete).toBe(false);expect(result.questions[0]!.failedChecks).toContain("criterion_without_assertion:survival");
 });
 it("does not transplant an answer across geography or year",()=>{
  for(const field of ["time","geography"] as const)expect(resolveResearchCoverage({...args,task:{...task,criteria:[{...task.criteria[0]!,scope:{...scope,[field]:"different"}}]}}).questions[0]!.failedChecks).toContain("criterion_scope_mismatch:area");
 });
 it("does not waive requirements, ambiguities or omitted original spans",()=>{
  expect(resolveResearchCoverage({...args,proposal:{...proposal,questions:[{...proposal.questions[0]!,status:"not_applicable"}]}}).complete).toBe(false);
  expect(resolveResearchCoverage({...args,task:{...task,openAmbiguities:[{question:"Which year?",whyMaterial:"Changes answer"}]}}).complete).toBe(false);
  expect(resolveResearchCoverage({...args,proposal:{...proposal,omittedRequirements:[{provenance:span,reason:"Missing comparison"}]}}).complete).toBe(false);
 });
 it("requires exact complete review bindings",()=>{
  expect(()=>resolveResearchCoverage({...args,proposal:{...proposal,questions:[]}})).toThrow("missing_question_review");
  expect(()=>resolveResearchCoverage({...args,proposal:{...proposal,questions:[{...proposal.questions[0]!,assertionKeys:["invented"]}]}})).toThrow("unknown_model_handle");
 });
 it("maps unresolved critical questions and hard criteria to explicit limited-publication disclosures",()=>{
  const coverage=resolveResearchCoverage({...args,proposal:{...proposal,questions:[{...proposal.questions[0]!,status:"unresolved_at_limit"}]}});
  const required=limitedCoverageLimitations(coverage,task);
  expect(required).toEqual(["Unresolved critical question q (unresolved_at_limit).",unresolvedCriticalCriterionLimitation("area")]);
  expect(limitedCoverageDisclosed(["Some requested questions remain unresolved.",...required],coverage,task)).toBe(true);
  expect(limitedCoverageDisclosed(["Some requested questions remain unresolved.",required[0]!],coverage,task)).toBe(false);
  expect(limitedCoverageLimitations(resolveResearchCoverage(args),task)).toEqual([]);
  const useful={...task,questions:[{...task.questions[0]!,importance:"useful" as const}],criteria:[{...task.criteria[0]!,importance:"preference" as const}]};
  expect(limitedCoverageLimitations(coverage,useful)).toEqual([]);
 });
 it("keeps a shared historical criterion unresolved when an optimistic review cites only one requested entity",()=>{
  for(const compoundQuestion of [
   "When were Ardent Labs and Brindle Works founded?",
   "Founding dates: Ardent Labs, Brindle Works.",
   "Give the founding year for Ardent Labs / Brindle Works.",
   "When was Ardent Labs founded? When was Brindle Works founded?",
  ]) {
   const compoundSpan={start:0,end:compoundQuestion.length,quote:compoundQuestion};
   const compoundTask:ResearchModelOutput<"brief">={objective:compoundQuestion,objectiveProvenance:compoundSpan,intendedOutput:"answer",
    criteria:[{key:"founding_dates",description:compoundQuestion,field:"founding dates",operator:"explain",value:null,unit:null,importance:"hard",
     scope:{entity:null,time:null,plan:null,version:null,geography:null,population:null},provenance:compoundSpan,group:"g",groupOperator:"all",unresolvedAlternatives:[]}],
    questions:[{key:"q_dates",text:compoundQuestion,criterionKeys:["founding_dates"],importance:"critical",evidenceStandard:"both entities"}],
    assumptions:[],openAmbiguities:[],explicitExclusions:[]};
   const claim={...assertion,key:"a_ardent",criterionKeys:["founding_dates"],text:"Ardent Labs was founded in 2004.",scope:{...scope,entity:"Ardent Labs",time:null}};
   const optimistic:ResearchModelOutput<"review_coverage">={questions:[{questionKey:"q_dates",status:"supported",assertionKeys:[claim.key],reason:"The cited assertion answers the criterion."}],omittedRequirements:[]};
   const result=resolveResearchCoverage({question:compoundQuestion,task:compoundTask,assertions:[claim],checks:[{claimKey:claim.key,decision:"supported"}],proposal:optimistic});
   expect(result.complete,compoundQuestion).toBe(false);
   expect(result.unresolvedCriterionKeys,compoundQuestion).toEqual(["founding_dates"]);
   expect(result.questions[0]!.failedChecks,compoundQuestion).toContain("criterion_entity_without_assertion:founding_dates:brindle_works");
  }
 });
 it("binds deeper shared-key subquestions and distinct facts instead of reusing one assertion",()=>{
  const deepQuestion="Research Ardent Labs and Brindle Works. When was each founded, and how did each expand?";
  const deepSpan={start:0,end:deepQuestion.length,quote:deepQuestion};
  const deepTask:ResearchModelOutput<"brief">={objective:deepQuestion,objectiveProvenance:deepSpan,intendedOutput:"answer",
   criteria:[{key:"history",description:"Founding and expansion",field:"history",operator:"explain",value:null,unit:null,importance:"hard",
    scope:{entity:null,time:null,plan:null,version:null,geography:null,population:null},provenance:deepSpan,group:"g",groupOperator:"all",unresolvedAlternatives:[]}],
   questions:[
    {key:"q_ardent",text:"When was Ardent Labs founded?",criterionKeys:["history"],importance:"critical",evidenceStandard:"documented founding"},
    {key:"q_brindle",text:"How did Brindle Works expand?",criterionKeys:["history"],importance:"critical",evidenceStandard:"documented expansion"},
   ],assumptions:[],openAmbiguities:[],explicitExclusions:[]};
  const claim={...assertion,key:"a_ardent_deep",criterionKeys:["history"],text:"Ardent Labs was founded in 2004.",scope:{...scope,entity:"Ardent Labs",time:null}};
  const optimistic:ResearchModelOutput<"review_coverage">={questions:deepTask.questions.map((row)=>({questionKey:row.key,status:"supported" as const,assertionKeys:[claim.key],reason:"Covered."})),omittedRequirements:[]};
  const result=resolveResearchCoverage({question:deepQuestion,task:deepTask,assertions:[claim],checks:[{claimKey:claim.key,decision:"supported"}],proposal:optimistic});
  expect(result.complete).toBe(false);
  expect(result.questions.find((row)=>row.questionKey==="q_brindle")?.failedChecks).toEqual(expect.arrayContaining([
   "criterion_entity_without_assertion:history:brindle_works",
   "criterion_fact_without_assertion:history:expansion",
  ]));
 });
});

describe("R-05 deepen opening discovery",()=>{
 it("uses a unique original-question span for an investigation focus and never invents query terms",()=>{
  const question="best laptop for local AI under $2k with long battery life";
  const outcome=investigationInstruction("battery life");
  const opened=openingDiscoveryFromBrief({originalQuestion:question,desiredOutcome:outcome});
  expect(opened.investigationFocus).toBe("battery life");
  expect(opened.query).toBe("battery life");
  expect(question.slice(opened.publicQueryBasis.start,opened.publicQueryBasis.end)).toBe("battery life");
  expect(opened.publicQueryBasis.quote).toBe("battery life");
  const absent=openingDiscoveryFromBrief({originalQuestion:"best laptop for local AI under $2k",desiredOutcome:outcome});
  expect(absent.query).toBe("best laptop for local AI under $2k");
  expect(absent.publicQueryBasis.quote).toBe("best laptop for local AI under $2k");
  const parent=openingDiscoveryFromBrief({originalQuestion:question});
  expect(parent.query).toBe(question);
  expect(parent.investigationFocus).toBeNull();
 });
});
describe("W05 criterion discovery policy",()=>{
 it("uses only an unmet criterion's exact original-question span",()=>{
  const start=question.indexOf("Reef-X"),provenance={start,end:start+6,quote:"Reef-X"};
  const focused={...task,criteria:[{...task.criteria[0]!,provenance}]};
  expect(nextCriterionSearch({question,task:focused,unresolvedCriterionKeys:["area"],queries:[question]})).toMatchObject({kind:"search",proposal:{action:{query:"Reef-X",questionKeys:["q"],publicQueryBasis:provenance}}});
  expect(nextCriterionSearch({question,task:focused,unresolvedCriterionKeys:[],queries:[]})).toMatchObject({kind:"stop"});
  expect(()=>nextCriterionSearch({question,task:{...focused,criteria:[{...focused.criteria[0]!,provenance:{...provenance,quote:"private source words"}}]},unresolvedCriterionKeys:["area"],queries:[]})).toThrow("invalid_discovery_provenance");
 });
 it("stops explicitly for repeated questions or the query ceiling",()=>{
  expect(nextCriterionSearch({question,task,unresolvedCriterionKeys:["area"],queries:[question.toUpperCase()]})).toEqual({kind:"stop",reason:"no_distinct_public_criterion_query"});
  expect(nextCriterionSearch({question,task,unresolvedCriterionKeys:["area"],queries:["one","two","three"]})).toEqual({kind:"stop",reason:"discovery_query_limit"});
  const start=question.indexOf("Reef-X"),provenance={start,end:start+6,quote:"Reef-X"};
  expect(nextCriterionSearch({question,task:{...task,criteria:[{...task.criteria[0]!,provenance}]},unresolvedCriterionKeys:["area"],queries:["one","two","three"],ceiling:6})).toMatchObject({kind:"search",proposal:{action:{query:"Reef-X"}}});
 });
 it("issues a distinct in-question field phrase for a current-fact criterion",()=>{
  const q="What is the current US federal funds rate?";
  const whole={start:0,end:q.length,quote:q};
  const scope={entity:"US",plan:null,version:null,geography:null,time:null,population:null};
  const task:ResearchModelOutput<"brief">={objective:q,objectiveProvenance:whole,intendedOutput:"answer",
   criteria:[{key:"current_rate",description:"Current rate",field:"federal funds rate",operator:"explain",value:null,unit:null,importance:"hard",scope,provenance:whole,group:"g",groupOperator:"all",unresolvedAlternatives:[]}],
   questions:[{key:"current_rate",text:q,criterionKeys:["current_rate"],importance:"critical",evidenceStandard:"public"}],
   assumptions:[],openAmbiguities:[],explicitExclusions:[]};
  const next=nextCriterionSearch({question:q,task,unresolvedCriterionKeys:["current_rate"],queries:[q]});
  expect(next).toMatchObject({kind:"search"});
  if(next.kind!=="search")throw new Error("missing field search");
  expect(next.proposal.action.query.toLowerCase()).toBe("federal funds rate");
 });
 it("issues a distinct original-question place span when criterion values are not in the question",()=>{
  const move="should I move to Texas?";
  const whole={start:0,end:move.length,quote:move};
  const scope={entity:"Texas",plan:null,version:null,geography:null,time:null,population:null};
  const moveTask:ResearchModelOutput<"brief">={objective:move,objectiveProvenance:whole,intendedOutput:"answer",
   criteria:[{key:"cost_of_living",description:"Cost of living",field:"cost",operator:"explain",value:"current location",unit:null,importance:"hard",scope,provenance:whole,group:"g",groupOperator:"all",unresolvedAlternatives:[]}],
   questions:[{key:"cost_of_living",text:move,criterionKeys:["cost_of_living"],importance:"critical",evidenceStandard:"public"}],
   assumptions:[],openAmbiguities:[],explicitExclusions:[]};
  const next=nextCriterionSearch({question:move,task:moveTask,unresolvedCriterionKeys:["cost_of_living"],queries:[move]});
  expect(next).toMatchObject({kind:"search"});
  if(next.kind!=="search")throw new Error("missing texas search");
  expect(move.includes(next.proposal.action.query)).toBe(true);
  expect(next.proposal.action.query.toLowerCase()).toMatch(/texas/i);
  expect(next.proposal.action.query.toLowerCase()).not.toBe(move.toLowerCase());
 });
 it("issues a distinct original-question constraint span after the full question was already searched",()=>{
  const laptop="best laptop for local AI under $2k with at least 32GB of RAM";
  const whole={start:0,end:laptop.length,quote:laptop};
  const laptopScope={entity:"laptop",plan:null,version:null,geography:null,time:null,population:null};
  const laptopTask:ResearchModelOutput<"brief">={objective:laptop,objectiveProvenance:whole,intendedOutput:"answer",
   criteria:[
    {key:"budget",description:"Under $2k",field:"price",operator:"at_most",value:"2000",unit:"USD",importance:"hard",scope:laptopScope,provenance:whole,group:"g",groupOperator:"all",unresolvedAlternatives:[]},
    {key:"ram",description:"At least 32GB RAM",field:"RAM",operator:"at_least",value:"32",unit:"GB",importance:"hard",scope:laptopScope,provenance:whole,group:"g",groupOperator:"all",unresolvedAlternatives:[]},
   ],
   questions:[
    {key:"budget",text:laptop,criterionKeys:["budget"],importance:"critical",evidenceStandard:"public"},
    {key:"ram",text:laptop,criterionKeys:["ram"],importance:"critical",evidenceStandard:"public"},
   ],assumptions:[],openAmbiguities:[],explicitExclusions:[]};
  const budget=nextCriterionSearch({question:laptop,task:laptopTask,unresolvedCriterionKeys:["budget","ram"],queries:[laptop]});
  expect(budget).toMatchObject({kind:"search"});
  if(budget.kind!=="search")throw new Error("missing budget search");
  expect(laptop.includes(budget.proposal.action.query)).toBe(true);
  expect(budget.proposal.action.query.toLowerCase()).not.toBe(laptop);
  expect(budget.proposal.action.query).toMatch(/\$2k/i);
  const ram=nextCriterionSearch({question:laptop,task:laptopTask,unresolvedCriterionKeys:["ram"],queries:[laptop,budget.proposal.action.query]});
  expect(ram).toMatchObject({kind:"search"});
  if(ram.kind!=="search")throw new Error("missing ram search");
  expect(laptop.includes(ram.proposal.action.query)).toBe(true);
  expect(ram.proposal.action.query).toMatch(/32GB/i);
  expect(ram.proposal.action.query).not.toBe(budget.proposal.action.query);
 });
});

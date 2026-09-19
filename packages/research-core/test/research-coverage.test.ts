import { nextCriterionSearch } from "../src/discovery-planning.js";
import { describe,it,expect } from "vitest";
import type { ResearchModelOutput } from "@deep/contracts";
import { resolveResearchCoverage } from "../src/research-coverage.js";
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

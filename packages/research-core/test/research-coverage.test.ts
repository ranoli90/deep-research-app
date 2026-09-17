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

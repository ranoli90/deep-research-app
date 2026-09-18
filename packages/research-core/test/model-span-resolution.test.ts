import { expect, it } from "vitest";
import { resolveModelSpans, validateModelBindings } from "../src/index.js";
const context = (question: string) => ({question,task:null,passages:[],sources:[],assertions:[],approvedClaimKeys:[]});
const proposal = (quote: string, start = 99, end = 100) => ({questions:[],omittedRequirements:[{provenance:{quote,start,end},reason:"Missing original requirement"}]});
it("resolves unique exact Unicode quotes without mutating the proposal or relaxing the binding validator",()=>{
 const c=context("🪸 Explain coral bleaching."), original=proposal("coral bleaching");
 expect(validateModelBindings("review_coverage",original,c)).toContain("invalid_exact_span");
 const resolved=resolveModelSpans("review_coverage",original,c);
 expect(resolved.output.omittedRequirements[0]?.provenance).toEqual({quote:"coral bleaching",start:11,end:26});
 expect(resolved.resolutions).toEqual([{path:"omittedRequirements.0.provenance",proposedStart:99,proposedEnd:100,start:11,end:26}]);
 expect(validateModelBindings("review_coverage",resolved.output,c)).toEqual([]);
 expect(original.omittedRequirements[0]?.provenance.start).toBe(99);
});
it.each([["same same","same"],["aaaa","aa"],["not allowed","allowed here"],["WAL supports reads","wal supports reads"]])("keeps ambiguous or inexact quotes invalid: %s",(text,quote)=>{
 const c=context(text), result=resolveModelSpans("review_coverage",proposal(quote),c);
 expect(result.resolutions).toEqual([]);expect(validateModelBindings("review_coverage",result.output,c)).toContain("invalid_exact_span");
});
it("preserves an already exact repeated quote at its supplied location",()=>{
 const c=context("same same"), result=resolveModelSpans("review_coverage",proposal("same",5,9),c);
 expect(result.resolutions).toEqual([]);expect(validateModelBindings("review_coverage",result.output,c)).toEqual([]);
});
it("never borrows a matching quotation from a different evidence handle",()=>{
 const p=crypto.randomUUID(), other=crypto.randomUUID(), scope={entity:null,plan:null,version:null,geography:null,time:null,population:null};
 const raw={assessments:[{claimKey:"claim",status:"supported",evidence:[{passageId:p,quote:"decisive fact",start:99,end:100}],scope,rationale:"test",missingEvidence:[]}]};
 const result=resolveModelSpans("assess_support",raw,{question:"",passages:[{id:other,text:"decisive fact"}]});
 expect(result.resolutions).toEqual([]);expect(result.output.assessments[0]?.evidence[0]?.passageId).toBe(p);
});

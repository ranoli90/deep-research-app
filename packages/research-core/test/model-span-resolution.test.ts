import { expect, it } from "vitest";
import { resolveModelSpans, repairBriefProvenanceFromQuestion, dropUnownedEvidenceHandles, validateModelBindings } from "../src/index.js";
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
it("repairs a budget span when the model quoted 2000 instead of $2k", () => {
  const question = "best laptop for local AI under $2k";
  const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
  const brief = {
    objective: question,
    objectiveProvenance: { start: 0, end: question.length, quote: question },
    intendedOutput: "recommendation",
    criteria: [{
      key: "budget", description: "Stay under 2000 USD", field: "budget", operator: "at_most" as const,
      value: "2000", unit: "USD", importance: "hard" as const, scope, provenance: { start: 0, end: 11, quote: "under $2000" },
      group: "hard", groupOperator: "all" as const, unresolvedAlternatives: [],
    }],
    questions: [{ key: "q1", text: "Which laptops qualify?", criterionKeys: ["budget"], importance: "critical" as const, evidenceStandard: "current prices" }],
    assumptions: [],
    openAmbiguities: [],
    explicitExclusions: [],
  };
  expect(validateModelBindings("brief", brief, context(question))).toContain("invalid_exact_span");
  const repaired = repairBriefProvenanceFromQuestion(brief, question);
  expect(validateModelBindings("brief", repaired, context(question))).toEqual([]);
  expect(question.slice(repaired.criteria[0]!.provenance.start, repaired.criteria[0]!.provenance.end)).toBe(repaired.criteria[0]!.provenance.quote);
  expect(repaired.criteria[0]!.provenance.quote.toLowerCase()).toMatch(/2k|under/);
});

it("drops extraction citations whose passage was never provided", () => {
  const owned = crypto.randomUUID();
  const foreign = crypto.randomUUID();
  const output = {
    candidates: [
      { key: "c1", label: "A", evidence: [{ passageId: owned, quote: "hello", start: 0, end: 5 }, { passageId: foreign, quote: "nope", start: 0, end: 4 }] },
      { key: "c2", label: "B", evidence: [{ passageId: foreign, quote: "nope", start: 0, end: 4 }] },
    ],
    assertions: [
      { key: "a1", candidateKey: "c1", criterionKeys: ["budget"], text: "hello", scope: { entity: null, plan: null, version: null, geography: null, time: null, population: null }, quantities: [], evidence: [{ passageId: owned, quote: "hello", start: 0, end: 5 }] },
      { key: "a2", candidateKey: "c2", criterionKeys: ["budget"], text: "nope", scope: { entity: null, plan: null, version: null, geography: null, time: null, population: null }, quantities: [], evidence: [{ passageId: foreign, quote: "nope", start: 0, end: 4 }] },
    ],
    limitations: [],
  };
  const cleaned = dropUnownedEvidenceHandles(output, new Set([owned]));
  expect(cleaned.candidates.map((c) => c.key)).toEqual(["c1"]);
  expect(cleaned.candidates[0]!.evidence).toHaveLength(1);
  expect(cleaned.assertions.map((a) => a.key)).toEqual(["a1"]);
});

it("does not invent a span for a quote that never appears in the question", () => {
  const question = "best laptop for local AI under $2k";
  const brief = {
    objective: "invented",
    objectiveProvenance: { start: 0, end: 20, quote: "invented requirement" },
    intendedOutput: "recommendation",
    criteria: [{
      key: "budget", description: "Stay under 2000 USD", field: "budget", operator: "at_most" as const,
      value: "2000", unit: "USD", importance: "hard" as const,
      scope: { entity: null, plan: null, version: null, geography: null, time: null, population: null },
      provenance: { start: 0, end: 20, quote: "invented requirement" },
      group: "hard", groupOperator: "all" as const, unresolvedAlternatives: [],
    }],
    questions: [{ key: "q1", text: "Which laptops qualify?", criterionKeys: ["budget"], importance: "critical" as const, evidenceStandard: "current prices" }],
    assumptions: [],
    openAmbiguities: [],
    explicitExclusions: [],
  };
  const repaired = repairBriefProvenanceFromQuestion(brief, question);
  expect(validateModelBindings("brief", repaired, context(question))).toContain("invalid_exact_span");
});

it("never borrows a matching quotation from a different evidence handle",()=>{
 const p=crypto.randomUUID(), other=crypto.randomUUID(), scope={entity:null,plan:null,version:null,geography:null,time:null,population:null};
 const raw={assessments:[{claimKey:"claim",status:"supported",evidence:[{passageId:p,quote:"decisive fact",start:99,end:100}],scope,rationale:"test",missingEvidence:[]}]};
 const result=resolveModelSpans("assess_support",raw,{question:"",passages:[{id:other,text:"decisive fact"}]});
 expect(result.resolutions).toEqual([]);expect(result.output.assessments[0]?.evidence[0]?.passageId).toBe(p);
});

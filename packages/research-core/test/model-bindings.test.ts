import { describe, expect, it } from "vitest";
import { validateModelBindings } from "../src/model-bindings.js";
const question = "Compare coral and kelp restoration.";
const span = { start: 0, end: question.length, quote: question };
const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
const task = { objective: question, objectiveProvenance: span, intendedOutput: "comparison",
  criteria: [{ key: "c1", description: "Compare restoration", field: "restoration", operator: "compare" as const, value: null, unit: null,
    importance: "hard" as const, scope, provenance: span, group: "g1", groupOperator: "all" as const, unresolvedAlternatives: [] }],
  questions: [{ key: "q1", text: question, criterionKeys: ["c1"], importance: "critical" as const, evidenceStandard: "documented outcomes" }],
  assumptions: [], openAmbiguities: [], explicitExclusions: [] };
const passage = { id: "11111111-1111-4111-8111-111111111111", text: "Kelp restoration is not universally successful." };
const evidence = { passageId: passage.id, start: 0, end: passage.text.length, quote: passage.text };
const assertion = { key: "a1", candidateKey: null, criterionKeys: ["c1"], text: passage.text, scope, quantities: [], evidence: [evidence] };
const context = { question, task, passages: [passage], sources: [{ handle: "source1" }], assertions: [assertion], approvedClaimKeys: ["a1"] };
describe("W05 model provenance and handles", () => {
  it("accepts complete unfamiliar criteria, exact extraction, assessment and cited report proposals", () => {
    expect(validateModelBindings("brief", task, context)).toEqual([]);
    expect(validateModelBindings("extract_assertions", { candidates: [], assertions: [assertion], limitations: [] }, context)).toEqual([]);
    expect(validateModelBindings("assess_support", { assessments: [{ claimKey: "a1", status: "supported", evidence: [evidence], scope, rationale: "Exact qualified sentence", missingEvidence: [] }] }, context)).toEqual([]);
    expect(validateModelBindings("write_report", { title: "Restoration comparison", sections: [{ heading: "Evidence", paragraphs: [{ text: passage.text, claimKeys: ["a1"] }] }], unresolvedQuestionKeys: ["q1"], limitations: [] }, context)).toEqual([]);
  });
  it("rejects invented question provenance, duplicate keys and omitted criteria", () => {
    expect(validateModelBindings("brief", { ...task, objectiveProvenance: { ...span, quote: "invented" } }, context)).toContain("invalid_exact_span");
    expect(validateModelBindings("brief", { ...task, criteria: [...task.criteria, ...task.criteria] }, context)).toContain("duplicate_model_key");
    expect(validateModelBindings("brief", { ...task, questions: [{ ...task.questions[0], criterionKeys: ["missing"] }] }, context)).toContain("criterion_without_question");
  });
  it("rejects fabricated passage handles and negation-altering quotes", () => {
    for (const changed of [{ ...evidence, quote: "Kelp restoration is universally successful." }, { ...evidence, passageId: "22222222-2222-4222-8222-222222222222" }]) {
      expect(validateModelBindings("extract_assertions", { candidates: [], assertions: [{ ...assertion, evidence: [changed] }], limitations: [] }, context).length).toBeGreaterThan(0);
    }
  });
  it("requires each target assessment and substantive coverage bindings", () => {
    expect(validateModelBindings("assess_support", { assessments: [] }, context)).toContain("missing_claim_assessment");
    expect(validateModelBindings("assess_support", { assessments: [{ claimKey: "a1", status: "supported", evidence: [], scope, rationale: "verified", missingEvidence: [] }] }, context)).toContain("support_without_evidence");
    expect(validateModelBindings("review_coverage", { questions: [{ questionKey: "q1", status: "supported", assertionKeys: [], reason: "found a source" }], omittedRequirements: [] }, context)).toContain("coverage_without_assertion");
  });
  it("cannot promote an unapproved assertion into writer authority", () => {
    expect(validateModelBindings("write_report", { title: "Restoration", sections: [{ heading: "Answer", paragraphs: [{ text: passage.text, claimKeys: ["a1"] }] }], unresolvedQuestionKeys: [], limitations: [] }, { ...context, approvedClaimKeys: [] })).toContain("unknown_model_handle");
  });
  it("does not allow private document words into a proposed public search", () => {
    const action = { type: "search", query: "private account CANARY", questionKeys: ["q1"], publicQueryBasis: span };
    expect(validateModelBindings("propose_action", { action, rationale: "source requested it" }, context)).toContain("unapproved_public_query_terms");
    expect(validateModelBindings("propose_action", { action: { ...action, query: "coral kelp restoration" }, rationale: "compare outcomes" }, context)).toEqual([]);
  });
});

it("calculation planning binds supported quantity indices to actual questions without accepting caller numbers",()=>{
 const numeric={...assertion,quantities:[{value:"12",unit:"hectares",currency:null,billingPeriod:null,qualifier:null}]};
 const ctx={...context,assertions:[numeric]};
 const action={type:"calculate",formula:"annual_cost",inputs:[{claimKey:"a1",quantityIndex:0}]};
 const plan={calculations:[{key:"p",questionKeys:["q1"],action,rationale:"Candidate arithmetic only"}],unresolvedQuestionKeys:[],reason:"Execution may remain unknown"};
 expect(validateModelBindings("plan_calculations",plan,ctx)).toEqual([]);
 expect(validateModelBindings("plan_calculations",plan,{...ctx,approvedClaimKeys:[]})).toContain("unknown_model_handle");
 expect(validateModelBindings("plan_calculations",plan,{...ctx,assertions:[{...numeric,quantities:[]}]})).toContain("unknown_quantity_reference");
 expect(validateModelBindings("plan_calculations",plan,{...ctx,assertions:[{...numeric,criterionKeys:["unrelated"]}]})).toContain("calculation_input_question_mismatch");
 expect(validateModelBindings("plan_calculations",{...plan,calculations:[...plan.calculations,{...plan.calculations[0],key:"other"}]},ctx)).toContain("duplicate_calculation_action");
 expect(validateModelBindings("plan_calculations",{...plan,calculations:[{...plan.calculations[0],action:{...action,values:[12]}}]},ctx)).toEqual(["output_schema_mismatch"]);
});

import { expect, it } from "vitest";
import { resolveModelSpans, repairBriefProvenanceFromQuestion, dropUnownedEvidenceHandles, dropUnresolvedExtractionSpans, uniquifyExtractionKeys, dropUnapprovedWriterClaims, repairSupportAssessments, locateUniqueQuote, locateOwnedPassageQuote, validateModelBindings } from "../src/index.js";
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

it("resolves extraction evidence whose quote matches the passage with collapsed whitespace", () => {
  const id = crypto.randomUUID();
  const text = "The Framework 16\nhas 96GB of RAM for local models.";
  const raw = {
    candidates: [{ key: "c1", label: "Framework", evidence: [{ passageId: id, quote: "Framework 16 has 96GB of RAM", start: 99, end: 100 }] }],
    assertions: [{
      key: "a1", candidateKey: "c1", criterionKeys: ["budget"], text: "96GB RAM",
      scope: { entity: null, plan: null, version: null, geography: null, time: null, population: null },
      quantities: [], evidence: [{ passageId: id, quote: "Framework 16 has 96GB of RAM", start: 99, end: 100 }],
    }],
    limitations: [],
  };
  const resolved = resolveModelSpans("extract_assertions", raw, { question: "best laptop", passages: [{ id, text }] });
  const task = { criteria: [{ key: "budget" }], questions: [{ key: "q1", criterionKeys: ["budget"] }] };
  const ctx = { question: "best laptop", task, passages: [{ id, text }], sources: [], assertions: [], approvedClaimKeys: [] };
  expect(validateModelBindings("extract_assertions", resolved.output, ctx)).toEqual([]);
});

it("locates a unique passage quote even when the model collapsed whitespace", () => {
  const text = "The Framework 16\nhas 96GB of RAM for local models.";
  const found = locateUniqueQuote(text, "Framework 16 has 96GB of RAM", { flexibleWhitespace: true });
  expect(found).not.toBeNull();
  expect(text.slice(found!.start, found!.end).replace(/\s+/g, " ")).toMatch(/Framework 16 has 96GB of RAM/i);
  expect(locateUniqueQuote("same same", "same", { flexibleWhitespace: true })).toBeNull();
});

it("drops extraction quotes that cannot be located in the owned passage", () => {
  const id = crypto.randomUUID();
  const output = {
    candidates: [{ key: "c1", label: "A", evidence: [{ passageId: id, quote: "invented sentence that is not on the page", start: 0, end: 41 }] }],
    assertions: [{
      key: "a1", candidateKey: "c1", criterionKeys: ["budget"], text: "invented",
      scope: { entity: null, plan: null, version: null, geography: null, time: null, population: null },
      quantities: [], evidence: [{ passageId: id, quote: "invented sentence that is not on the page", start: 0, end: 41 }],
    }],
    limitations: [],
  };
  const cleaned = dropUnresolvedExtractionSpans(output, [{ id, text: "The Framework 16 has 96GB of RAM." }]);
  expect(cleaned.candidates).toEqual([]);
  expect(cleaned.assertions).toEqual([]);
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

it("repairs support assessments that use the wrong claim key or unusable evidence handle", () => {
  const passageId = crypto.randomUUID();
  const quote = "Federal funds (effective) 3.88";
  const assertion = {
    key: "current_rate", candidateKey: null, criterionKeys: ["current_rate"], text: quote,
    scope: { entity: "US", plan: null, version: null, geography: "United States", time: "current", population: null },
    quantities: [], evidence: [{ passageId, quote, start: 0, end: quote.length }],
  };
  const repaired = repairSupportAssessments({
    assessments: [{
      claimKey: "rate", status: "supported",
      evidence: [{ passageId: crypto.randomUUID(), quote: "nope", start: 0, end: 4 }],
      scope: assertion.scope, rationale: "wrong handle", missingEvidence: [],
    }],
  }, [assertion], [{ id: passageId, text: quote }]);
  expect(repaired.assessments).toHaveLength(1);
  expect(repaired.assessments[0]).toMatchObject({ claimKey: "current_rate", evidence: assertion.evidence });
  expect(validateModelBindings("assess_support", repaired, {
    question: "What is the current US federal funds rate?", task: null,
    passages: [{ id: passageId, text: quote }], sources: [], assertions: [assertion], approvedClaimKeys: [],
  })).toEqual([]);
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

it("remaps an extraction quote to the unique owned passage that actually contains it", () => {
  const owned = crypto.randomUUID();
  const invented = crypto.randomUUID();
  const text = "The Acer Aspire 16 AI is the best budget Copilot+ PC at under $700.";
  const raw = {
    candidates: [{ key: "c1", label: "Acer", evidence: [{ passageId: invented, quote: "Acer Aspire 16 AI is the best budget Copilot+ PC", start: 99, end: 100 }] }],
    assertions: [{
      key: "a1", candidateKey: "c1", criterionKeys: ["budget"], text: "under $700",
      scope: { entity: null, plan: null, version: null, geography: null, time: null, population: null },
      quantities: [], evidence: [{ passageId: invented, quote: "Acer Aspire 16 AI is the best budget Copilot+ PC", start: 99, end: 100 }],
    }],
    limitations: [],
  };
  const resolved = resolveModelSpans("extract_assertions", raw, { question: "best laptop", passages: [{ id: owned, text }] });
  expect(resolved.output.assertions[0]!.evidence[0]!.passageId).toBe(owned);
  expect(text.slice(resolved.output.assertions[0]!.evidence[0]!.start, resolved.output.assertions[0]!.evidence[0]!.end))
    .toBe(resolved.output.assertions[0]!.evidence[0]!.quote);
  const ctx = { question: "best laptop", task: { criteria: [{ key: "budget" }], questions: [{ key: "q1", criterionKeys: ["budget"] }] }, passages: [{ id: owned, text }], sources: [], assertions: [], approvedClaimKeys: [] };
  expect(validateModelBindings("extract_assertions", resolved.output, ctx)).toEqual([]);
});

it("does not remap an extraction quote that appears in two owned passages", () => {
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  const invented = crypto.randomUUID();
  const quote = "16GB of unified memory is available";
  const raw = {
    candidates: [{ key: "c1", label: "A", evidence: [{ passageId: invented, quote, start: 0, end: quote.length }] }],
    assertions: [{
      key: "a1", candidateKey: "c1", criterionKeys: ["budget"], text: quote,
      scope: { entity: null, plan: null, version: null, geography: null, time: null, population: null },
      quantities: [], evidence: [{ passageId: invented, quote, start: 0, end: quote.length }],
    }],
    limitations: [],
  };
  const resolved = resolveModelSpans("extract_assertions", raw, {
    question: "best laptop",
    passages: [{ id: a, text: `Note: ${quote} in chassis A.` }, { id: b, text: `Also ${quote} in chassis B.` }],
  });
  expect(resolved.output.assertions[0]!.evidence[0]!.passageId).toBe(invented);
  expect(locateOwnedPassageQuote(quote, invented, [{ id: a, text: `Note: ${quote} in chassis A.` }, { id: b, text: `Also ${quote} in chassis B.` }])).toBeNull();
});

it("keeps a unique owned prefix when the model concatenates two fragments", () => {
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  const a = "The Acer Aspire 16 AI is the best budget Copilot+ PC";
  const b = "Snapdragon X X1-26-100 with 45 TOPS NPU and 16GB LPDDR5X";
  const quote = `${a} ${b}`;
  const found = locateOwnedPassageQuote(quote, crypto.randomUUID(), [{ id: first, text: a }, { id: second, text: b }]);
  expect(found).not.toBeNull();
  expect(found!.passageId).toBe(first);
  expect(found!.quote).toBe(a);
});

it("strips unapproved writer claim keys and empty paragraphs", () => {
  const allowed = new Set(["budget"]);
  const cleaned = dropUnapprovedWriterClaims({
    title: "Laptops",
    sections: [{
      heading: "Answer",
      paragraphs: [
        { text: "The ThinkPad is under $2k.", claimKeys: ["budget", "invented"] },
        { text: "Battery life is unknown.", claimKeys: ["battery"] },
      ],
    }],
    unresolvedQuestionKeys: ["q1", "nope"],
    limitations: ["Limited sources."],
  }, allowed, new Set(["q1"]));
  expect(cleaned.sections[0]!.paragraphs).toEqual([{ text: "The ThinkPad is under $2k.", claimKeys: ["budget"] }]);
  expect(cleaned.unresolvedQuestionKeys).toEqual(["q1"]);
});

it("drops duplicate extraction keys while keeping the first owned candidate", () => {
  const id = crypto.randomUUID();
  const quote = { passageId: id, start: 0, end: 5, quote: "hello" };
  const cleaned = uniquifyExtractionKeys({
    candidates: [
      { key: "dup", label: "A", evidence: [quote] },
      { key: "dup", label: "B", evidence: [quote] },
    ],
    assertions: [
      { key: "a1", candidateKey: "dup", criterionKeys: ["budget"], text: "hello", scope: { entity: null, plan: null, version: null, geography: null, time: null, population: null }, quantities: [], evidence: [quote] },
      { key: "a1", candidateKey: "dup", criterionKeys: ["budget"], text: "again", scope: { entity: null, plan: null, version: null, geography: null, time: null, population: null }, quantities: [], evidence: [quote] },
    ],
    limitations: [],
  });
  expect(cleaned.candidates).toHaveLength(1);
  expect(cleaned.assertions).toHaveLength(1);
  expect(cleaned.assertions[0]!.text).toBe("hello");
});

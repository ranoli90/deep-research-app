import { expect, it } from "vitest";
import { repairBriefCriterionLinks, suppressUnneededBriefClarifications, validateModelBindings, resolveModelSpans } from "../src/index.js";

const question = "best laptop for running AI under 2k";
const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
const criterion = (key: string, quote: string, start = 99, end = 100) => ({
  key, description: `Need ${key}`, field: key, operator: "exists" as const, value: null, unit: null,
  importance: "hard" as const, scope, provenance: { quote, start, end }, group: "g1", groupOperator: "all" as const,
  unresolvedAlternatives: [],
});

it("clears model interview prompts when the intent compiler already decided not to ask", () => {
  const raw = {
    objective: question,
    objectiveProvenance: { quote: question, start: 0, end: question.length },
    intendedOutput: "recommendation",
    criteria: [{ ...criterion("budget", "under 2k", 24, 32), unresolvedAlternatives: ["gaming", "ultrabook"] }],
    questions: [{
      key: "q_budget", text: "What machines stay under the budget?", criterionKeys: ["budget"],
      importance: "critical" as const, evidenceStandard: "current list prices",
    }],
    assumptions: [],
    openAmbiguities: [{ question: "What specifically will you use it for?", whyMaterial: "use case" }],
    explicitExclusions: [],
  };
  const suppressed = suppressUnneededBriefClarifications(raw, question);
  expect(suppressed.openAmbiguities).toEqual([]);
  expect(suppressed.criteria[0]?.unresolvedAlternatives).toEqual([]);
  expect(suppressed.objective).toBe(question);
});

it("links orphaned brief criteria to questions without rewriting the original question", () => {
  const raw = {
    objective: question,
    objectiveProvenance: { quote: question, start: 3, end: 8 },
    intendedOutput: "recommendation",
    criteria: [criterion("budget", "under 2k"), criterion("local_ai", "running AI")],
    questions: [{
      key: "q_budget", text: "What machines stay under the budget?", criterionKeys: ["budget"],
      importance: "critical" as const, evidenceStandard: "current list prices",
    }],
    assumptions: [], openAmbiguities: [], explicitExclusions: [],
  };
  const resolved = resolveModelSpans("brief", raw, { question, passages: [] });
  const repaired = repairBriefCriterionLinks(resolved.output);
  expect(repaired.linked).toEqual([{ criterionKey: "local_ai", questionKey: "linked_local_ai", attachedToExisting: false }]);
  expect(repaired.output.questions.find((q) => q.key === "linked_local_ai")?.text).toBe("running AI");
  expect(repaired.output.objective).toBe(question);
  expect(validateModelBindings("brief", repaired.output, {
    question, task: null, passages: [], sources: [], assertions: [], approvedClaimKeys: [],
  })).toEqual([]);
});

it("does not invent a second question when every criterion is already referenced", () => {
  const raw = {
    objective: question,
    objectiveProvenance: { quote: question, start: 0, end: question.length },
    intendedOutput: "recommendation",
    criteria: [criterion("budget", "under 2k", 26, 34)],
    questions: [{
      key: "q_budget", text: question, criterionKeys: ["budget"],
      importance: "critical" as const, evidenceStandard: "current list prices",
    }],
    assumptions: [], openAmbiguities: [], explicitExclusions: [],
  };
  const repaired = repairBriefCriterionLinks(raw);
  expect(repaired.linked).toEqual([]);
  expect(repaired.output.questions).toHaveLength(1);
});

it("does not emit a 25th question when the brief is already at the schema cap", () => {
  const questions = Array.from({ length: 24 }, (_, i) => ({
    key: `q${i}`, text: question, criterionKeys: ["budget"],
    importance: "critical" as const, evidenceStandard: "current prices",
  }));
  const repaired = repairBriefCriterionLinks({
    objective: question,
    objectiveProvenance: { quote: question, start: 0, end: question.length },
    intendedOutput: "recommendation",
    criteria: [criterion("budget", "under 2k", 26, 34), criterion("local_ai", "running AI")],
    questions,
    assumptions: [], openAmbiguities: [], explicitExclusions: [],
  });
  expect(repaired.output.questions).toHaveLength(24);
  expect(repaired.linked).toEqual([]);
  expect(repaired.output.questions.every((q) => !q.criterionKeys.includes("local_ai"))).toBe(true);
  expect(validateModelBindings("brief", repaired.output, {
    question, task: null, passages: [], sources: [], assertions: [], approvedClaimKeys: [],
  })).toEqual(expect.arrayContaining(["criterion_without_question"]));
});

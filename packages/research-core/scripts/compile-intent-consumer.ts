import { compileResearchIntent, isCosmeticClarification } from "../src/intent-compiler.js";

const question = "best laptop for running AI under 2k";
const intent = compileResearchIntent(question);
const budget = intent.hardConstraints.find((c) => c.field === "budget");
const cosmetic = intent.clarificationDecision.questions.filter((q) => isCosmeticClarification(q.prompt));
if (intent.originalQuestion !== question) throw new Error("original_question_mutated");
if (!budget || budget.operator !== "lte" || budget.value !== "2000" || budget.importance !== "hard") {
  throw new Error("hard_budget_missing");
}
if (cosmetic.length) throw new Error("cosmetic_clarification");
process.stdout.write(`${JSON.stringify({
  originalQuestion: intent.originalQuestion,
  hardBudget: { field: budget.field, operator: budget.operator, value: budget.value, importance: budget.importance },
  clarificationAsk: intent.clarificationDecision.ask,
  clarificationPrompts: intent.clarificationDecision.questions.map((q) => q.prompt),
  compilerVersion: intent.compilerVersion,
})}\n`);

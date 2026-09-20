import type { ClarificationQuestion, Constraint, TaskFamily } from "@deep/contracts";
import { extractNamedGeography } from "./geography.js";

/** Typed material fields Research Beta may ask. Cosmetic fields never appear here. */
export const MATERIAL_CLARIFICATION_FIELDS = [
  "geography",
  "budget",
  "use_case",
  "population",
  "timeframe",
  "platform",
  "private_search",
  "subject",
  "safety",
] as const;

export type MaterialClarificationField = (typeof MATERIAL_CLARIFICATION_FIELDS)[number];

export const MATERIAL_FIELD_PROMPTS: Record<MaterialClarificationField, string> = {
  geography: "Which jurisdiction should this answer apply to?",
  budget: "What budget and currency should bound eligible options?",
  use_case: "What will this be used for?",
  population: "Who does this need to apply to?",
  timeframe: "What time window should the answer cover?",
  platform: "Which platform or product is in scope?",
  private_search: "May research use terms that appear only in your attached documents?",
  subject: "Which company or product should this research cover?",
  safety: "What lawful, non-harmful outcome should this research stay within?",
};

export const MATERIAL_FIELD_PLACEHOLDERS: Record<MaterialClarificationField, string> = {
  geography: "Jurisdiction or place",
  budget: "Budget and currency",
  use_case: "Intended use",
  population: "Who it applies to",
  timeframe: "Time window",
  platform: "Platform or product",
  private_search: "Yes or no — attached documents",
  subject: "Named company or product",
  safety: "The lawful outcome you need",
};

function hasField(constraints: Constraint[], field: string): boolean {
  return constraints.some((c) => c.field === field && String(c.value ?? "").trim() !== "");
}

/**
 * Extra typed asks only when the question is anaphoric or names private-only
 * search without a subject. Default is still assume/branch.
 */
export function extraMaterialClarifications(args: {
  originalQuestion: string;
  knownConstraints: Constraint[];
  taskFamily: TaskFamily;
}): ClarificationQuestion[] {
  const questions: ClarificationQuestion[] = [];
  const q = args.originalQuestion;
  if (args.taskFamily === "other" && /\bthis company\b/i.test(q) && !hasField(args.knownConstraints, "subject")) {
    questions.push({
      prompt: MATERIAL_FIELD_PROMPTS.subject,
      field: "subject",
      materialChangeKinds: ["search_universe", "final_conclusion"],
      whyMaterial: "The company is not named, so the search universe is undefined.",
    });
  }
  if (
    /\bthis (dock|phone|laptop|device|product)\b/i.test(q)
    && !hasField(args.knownConstraints, "platform")
    && args.taskFamily !== "underspecified_purchase"
  ) {
    questions.push({
      prompt: MATERIAL_FIELD_PROMPTS.platform,
      field: "platform",
      materialChangeKinds: ["eligibility", "search_universe", "final_conclusion"],
      whyMaterial: "Compatibility depends on the unnamed device.",
    });
  }
  if (/\b(my notes|my documents|attached files)\b/i.test(q) && !hasField(args.knownConstraints, "private_search")) {
    questions.push({
      prompt: MATERIAL_FIELD_PROMPTS.private_search,
      field: "private_search",
      materialChangeKinds: ["source_requirements", "search_universe"],
      whyMaterial: "Private-document terms cannot enter public queries without exact approval.",
    });
  }
  if (
    args.taskFamily === "legal_jurisdiction"
    && !hasField(args.knownConstraints, "geography")
    && !extractNamedGeography(q)
  ) {
    // Jurisdiction ask is owned by evaluateClarificationValue; do not duplicate.
  }
  return questions;
}

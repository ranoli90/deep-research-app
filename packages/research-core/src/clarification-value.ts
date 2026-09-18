import type {
  ClarificationDecision,
  ClarificationQuestion,
  Constraint,
  ConsequentialUnknown,
  MaterialAmbiguity,
  MaterialChangeKind,
  TaskFamily,
} from "@deep/contracts";
import { inferTaskFamily } from "./intent-taxonomy.js";

const JURISDICTION_PROMPT = "Which jurisdiction should this answer apply to?";

const COSMETIC_PATTERNS = [
  /what colou?r/i,
  /preferred brand/i,
  /how do you define best/i,
  /tone|style|punchy|concise vs detailed/i,
  /what should the report (look|sound) like/i,
  /any other preferences/i,
];

function hasField(constraints: Constraint[], field: string): boolean {
  return constraints.some((c) => c.field === field && String(c.value ?? "").trim() !== "");
}

function legalNeedsJurisdiction(question: string, constraints: Constraint[]): boolean {
  const q = question.toLowerCase();
  const legal = /\b(tax|employment law|filing|legal status|which law applies|statute|regulation|jurisdiction)\b/i.test(q);
  if (!legal) return false;
  if (hasField(constraints, "geography")) return false;
  if (/\b(germany|france|usa|united states|uk|united kingdom|canada|japan|india|australia)\b/i.test(q)) return false;
  return true;
}

function safetyNeedsInterpretation(question: string): boolean {
  return /\b(overdose|lethal|self-harm|how to make a bomb|weaponize)\b/i.test(question);
}

/**
 * Ask only when an unknown would change search universe, eligibility, jurisdiction,
 * source requirements, safety interpretation, ranking, or the final conclusion,
 * and it cannot be handled as an explicit assumption or research branch.
 * Cosmetic unknowns never become questions.
 */
export function evaluateClarificationValue(args: {
  originalQuestion: string;
  knownConstraints: Constraint[];
  taskFamily?: TaskFamily;
  materialAmbiguities?: MaterialAmbiguity[];
  consequentialUnknowns?: ConsequentialUnknown[];
}): ClarificationDecision {
  const family = args.taskFamily ?? inferTaskFamily(args.originalQuestion);
  const questions: ClarificationQuestion[] = [];
  const assumedOrBranched: string[] = [];
  const suppressedCosmetic = [
    "color or finish",
    "how the user defines “best”",
    "report tone or length",
    "preferred brand when none was stated",
  ];

  if (legalNeedsJurisdiction(args.originalQuestion, args.knownConstraints)) {
    questions.push({
      prompt: JURISDICTION_PROMPT,
      field: "geography",
      materialChangeKinds: ["jurisdiction", "source_requirements", "final_conclusion"],
      whyMaterial: "Applicable law, filing rules, and primary sources change by jurisdiction.",
    });
  } else if (family === "legal_jurisdiction") {
    assumedOrBranched.push("Jurisdiction is already named or confirmed; not re-asked.");
  }

  if (safetyNeedsInterpretation(args.originalQuestion)) {
    questions.push({
      prompt: "This request may require a safety interpretation that changes whether research can proceed. What outcome do you need that stays within lawful, non-harmful use?",
      field: "safety",
      materialChangeKinds: ["safety_interpretation", "search_universe"],
      whyMaterial: "Safety interpretation can change whether any search is permitted.",
    });
  }

  if (family === "underspecified_purchase") {
    assumedOrBranched.push(
      "Unstated market/currency treated as an explicit assumption and regional branch, not a questionnaire.",
      "Unstated “running AI” local-vs-cloud split is a derived requirement plus a documented branch.",
    );
  }
  if (family === "current_fact") {
    assumedOrBranched.push("“Current” is a freshness requirement, not a clarification prompt.");
  }
  if (family === "technical_comparison") {
    assumedOrBranched.push("Unstated patch versions default to the named major versions or latest documented release as a reversible assumption.");
  }
  if (family === "open_ended_research") {
    assumedOrBranched.push("Open-ended scope is researched as stated; no interview to narrow an unstated specialty.");
  }

  for (const unknown of args.consequentialUnknowns ?? []) {
    if (unknown.defaultHandling === "ask") {
      if (questions.some((q) => q.field === unknown.id)) continue;
      if (unknown.id === "geography" && questions.some((q) => q.field === "geography")) continue;
    } else {
      assumedOrBranched.push(`${unknown.unknown} (${unknown.defaultHandling})`);
    }
  }

  const filtered = questions.filter((q) => !COSMETIC_PATTERNS.some((re) => re.test(q.prompt)));
  return {
    ask: filtered.length > 0,
    questions: filtered.slice(0, 4),
    suppressedCosmetic,
    assumedOrBranched,
  };
}

export function clarificationPrompts(decision: ClarificationDecision): string[] {
  return decision.questions.map((q) => q.prompt);
}

export function isCosmeticClarification(prompt: string): boolean {
  return COSMETIC_PATTERNS.some((re) => re.test(prompt));
}

export const MATERIAL_CHANGE_KINDS: MaterialChangeKind[] = [
  "search_universe",
  "eligibility",
  "jurisdiction",
  "source_requirements",
  "safety_interpretation",
  "ranking",
  "final_conclusion",
];

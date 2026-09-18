import type { Assumption, Constraint } from "./index.js";

/** Versioned one-sentence research-intent contract. Original question text is immutable. */
export const RESEARCH_INTENT_COMPILER_VERSION = "research-intent-compiler.v1";

export type TaskFamily =
  | "underspecified_purchase"
  | "legal_jurisdiction"
  | "current_fact"
  | "technical_comparison"
  | "open_ended_research"
  | "other";

export type MaterialChangeKind =
  | "search_universe"
  | "eligibility"
  | "jurisdiction"
  | "source_requirements"
  | "safety_interpretation"
  | "ranking"
  | "final_conclusion";

export type IntentConstraint = Constraint & { statedInQuestion: boolean };

export type ExplicitlyStated = {
  text: string;
  spans: { start: number; end: number; quote: string }[];
};

export type DerivedRequirement = {
  id: string;
  text: string;
  because: string;
  reversible: boolean;
};

export type MaterialAmbiguity = {
  id: string;
  unknown: string;
  whyItMightMatter: string;
  materialChangeKinds: MaterialChangeKind[];
  handling: "ask" | "assume" | "branch";
};

export type IntentExclusion = {
  id: string;
  text: string;
  statedInQuestion: boolean;
};

export type ExpectedOutput = {
  kind: "recommendation" | "comparison" | "legal_rule" | "current_fact" | "explanation" | "compatibility" | "unknown";
  summary: string;
  statedInQuestion: boolean;
};

export type FreshnessRequirement = {
  required: boolean;
  summary: string;
  statedInQuestion: boolean;
};

export type ConsequentialUnknown = {
  id: string;
  unknown: string;
  materialChangeKinds: MaterialChangeKind[];
  defaultHandling: "ask" | "assume" | "branch";
};

export type ClarificationQuestion = {
  prompt: string;
  field: string;
  materialChangeKinds: MaterialChangeKind[];
  whyMaterial: string;
};

export type ClarificationDecision = {
  ask: boolean;
  questions: ClarificationQuestion[];
  suppressedCosmetic: string[];
  assumedOrBranched: string[];
};

export type ResearchIntent = {
  compilerVersion: typeof RESEARCH_INTENT_COMPILER_VERSION;
  originalQuestion: string;
  taskFamily: TaskFamily;
  explicitlyStated: ExplicitlyStated;
  hardConstraints: IntentConstraint[];
  softPreferences: IntentConstraint[];
  derivedResearchRequirements: DerivedRequirement[];
  assumptions: Assumption[];
  materialAmbiguities: MaterialAmbiguity[];
  exclusions: IntentExclusion[];
  expectedOutput: ExpectedOutput;
  freshnessRequirements: FreshnessRequirement;
  consequentialUnknowns: ConsequentialUnknown[];
  clarificationDecision: ClarificationDecision;
};

import { z } from "zod";

export const RESEARCH_MODEL_SCHEMA_VERSION = "research-model.v1";
const Key = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const Text = z.string().min(1).max(4000);
const Short = z.string().min(1).max(300);
export const EvidenceQuoteSchema = z.object({
  passageId: z.string().uuid(), start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: Text,
}).strict();
export const QuestionSpanSchema = z.object({
  start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: Text,
}).strict();
export const AssertionScopeSchema = z.object({
  entity: Short.nullable(), plan: Short.nullable(), version: Short.nullable(),
  geography: Short.nullable(), time: Short.nullable(), population: Short.nullable(),
}).strict();
const Criterion = z.object({
  key: Key, description: Text, field: Short,
  operator: z.enum(["equals", "not_equals", "at_least", "at_most", "contains", "exists", "compare", "explain"]),
  value: Text.nullable(), unit: Short.nullable(), importance: z.enum(["hard", "preference"]),
  scope: AssertionScopeSchema, provenance: QuestionSpanSchema,
  group: Key, groupOperator: z.enum(["all", "any"]),
  unresolvedAlternatives: z.array(Short).max(8),
}).strict();
const Question = z.object({ key: Key, text: Text, criterionKeys: z.array(Key).min(1).max(24),
  importance: z.enum(["critical", "useful"]), evidenceStandard: Text }).strict();
const Evidence = z.array(EvidenceQuoteSchema).min(1).max(12);
const Quantity = z.object({ value: Short, unit: Short, currency: Short.nullable(),
  billingPeriod: Short.nullable(), qualifier: Text.nullable() }).strict();

/** Model-local keys are proposals. Backend allocates IDs, ownership, revisions and permissions. */
export const ResearchModelOutputs = {
  brief: z.object({ objective: Text, objectiveProvenance: QuestionSpanSchema, intendedOutput: Text,
    criteria: z.array(Criterion).min(1).max(24), questions: z.array(Question).min(1).max(24),
    assumptions: z.array(z.object({ text: Text, reversible: z.boolean(), consequence: Text }).strict()).max(10),
    openAmbiguities: z.array(z.object({ question: Text, whyMaterial: Text }).strict()).max(6),
    explicitExclusions: z.array(z.object({ text: Text, provenance: QuestionSpanSchema }).strict()).max(12),
  }).strict(),
  extract_assertions: z.object({
    candidates: z.array(z.object({ key: Key, label: Short, evidence: Evidence }).strict()).max(30),
    assertions: z.array(z.object({ key: Key, candidateKey: Key.nullable(), criterionKeys: z.array(Key).min(1).max(24),
      text: Text, scope: AssertionScopeSchema, quantities: z.array(Quantity).max(12), evidence: Evidence }).strict()).max(60),
    limitations: z.array(Text).max(12),
  }).strict(),
  assess_support: z.object({ assessments: z.array(z.object({ claimKey: Key,
    status: z.enum(["supported", "contradicted", "partially_supported", "insufficient", "out_of_scope", "unavailable"]),
    evidence: z.array(EvidenceQuoteSchema).max(12), scope: AssertionScopeSchema, rationale: Text,
    missingEvidence: z.array(Text).max(8),
  }).strict()).max(60) }).strict(),
  propose_action: z.object({ rationale: Text, action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("search"), query: Text, questionKeys: z.array(Key).min(1).max(12),
      publicQueryBasis: QuestionSpanSchema }).strict(),
    z.object({ type: z.literal("fetch"), sourceHandle: Key, questionKeys: z.array(Key).min(1).max(12) }).strict(),
    z.object({ type: z.literal("assess_support"), claimKeys: z.array(Key).min(1).max(30) }).strict(),
    z.object({ type: z.literal("write_report"), unresolvedQuestionKeys: z.array(Key).max(24) }).strict(),
    z.object({ type: z.literal("clarify"), question: Text, criterionKeys: z.array(Key).min(1).max(24) }).strict(),
  ]) }).strict(),
  write_report: z.object({ title: Short, sections: z.array(z.object({ heading: Short,
    paragraphs: z.array(z.object({ text: Text, claimKeys: z.array(Key).min(1).max(12) }).strict()).min(1).max(12),
  }).strict()).min(1).max(12), unresolvedQuestionKeys: z.array(Key).max(24), limitations: z.array(Text).max(12) }).strict(),
  review_coverage: z.object({ questions: z.array(z.object({ questionKey: Key,
    status: z.enum(["supported", "disputed", "blocked_access", "needs_user_input", "unresolved_at_limit", "not_applicable"]),
    assertionKeys: z.array(Key).max(30), reason: Text,
  }).strict()).max(24), omittedRequirements: z.array(z.object({ provenance: QuestionSpanSchema, reason: Text }).strict()).max(12) }).strict(),
} as const;
export type ResearchModelOperation = keyof typeof ResearchModelOutputs;
export type ResearchModelOutput<K extends ResearchModelOperation> = z.infer<(typeof ResearchModelOutputs)[K]>;

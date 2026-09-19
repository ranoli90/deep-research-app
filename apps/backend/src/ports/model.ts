import { EvidenceSelectionContextSchema } from "./evidence-selection.js";
import { z } from "zod";
import { AssumptionSchema, ResearchBriefSchema, type ResearchBrief, ConstraintSchema, EvidenceCalculationResultSchema, AssertionScopeSchema, ScopeComparisonContextSchema, ScopeComparisonResultSchema, ResearchModelOutputs, type ResearchModelOperation, type ResearchModelOutput } from "@deep/contracts";

/** Whole passages only; serialized byte and model-policy ceilings remain independently enforced. */
export const MODEL_CONTEXT_MAX_PASSAGES = 128;

export const BriefPlanningStateSchema = ResearchBriefSchema.omit({ id: true, conversationId: true, revision: true, consentPolicyVersion: true }).extend({
  assumptions: z.array(AssumptionSchema.omit({ userConfirmationState: true })),
}).strict();
/** Confirmation alone is metadata; values, scope and source/output policy affect planning. */
export function briefPlanningState(brief: ResearchBrief) {
  const { id: _id, conversationId: _conversation, revision: _revision, consentPolicyVersion: _consent, ...state } = brief;
  return BriefPlanningStateSchema.parse({ ...state, assumptions: state.assumptions.map(({ userConfirmationState: _confirmation, ...assumption }) => assumption) });
}

/** Explicit projection, not controller/database serialization. Ownership is rechecked by the coordinator. */
export const ModelContextSchema = z.object({
  evidenceSelection: EvidenceSelectionContextSchema.optional(),
  question: z.string().min(1).max(20_000),
  confirmedConstraints: z.array(ConstraintSchema).max(24).optional(),
  planningState: BriefPlanningStateSchema.optional(),
  task: ResearchModelOutputs.brief.nullable(),
  passages: z.array(z.object({ id: z.string().uuid(), sourceVersionId: z.string().uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/), accessLevel: z.enum(["snippet", "abstract", "partial-text", "full-text"]),
    text: z.string().min(1).max(24_000),
  }).strict()).max(MODEL_CONTEXT_MAX_PASSAGES),
  sources: z.array(z.object({ handle: z.string().min(1).max(100), title: z.string().max(500) }).strict()).max(40),
  assertions: ResearchModelOutputs.extract_assertions.shape.assertions,
  approvedClaimKeys: z.array(z.string().min(1).max(100)).max(60),
  draft: ResearchModelOutputs.write_report.nullable(),
  calculations:z.object({planIntentId:z.string().uuid(),entries:z.array(z.object({key:z.string().min(1).max(100),questionKeys:z.array(z.string()).max(24),
    calculationId:z.string().uuid(),claimId:z.string().uuid().nullable(),claimRevisionId:z.string().uuid().nullable(),text:z.string().nullable(),
    result:EvidenceCalculationResultSchema,scope:AssertionScopeSchema,criterionKeys:z.array(z.string()).max(24),selected:z.boolean()}).strict()).max(6)}).strict().optional(),
  scopeComparison: z.union([ScopeComparisonResultSchema,ScopeComparisonContextSchema]).optional(),
}).strict();
export type ModelContext = z.infer<typeof ModelContextSchema>;

export const ModelReceiptSchema = z.object({
  requestedModel: z.string().min(1).max(300), reportedModel: z.string().max(300).nullable(), reportedProvider: z.string().max(300).nullable(),
  providerId: z.string().max(300).nullable(), httpStatus: z.number().int().min(100).max(599).nullable(),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime(),
  actualMicro: z.number().int().nonnegative().safe().nullable(), promptTokens: z.number().int().nonnegative().safe().nullable(),
  completionTokens: z.number().int().nonnegative().safe().nullable(), rawCost: z.string().max(100).nullable(),
  responseDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  cacheReadTokens: z.number().int().nonnegative().safe().nullable().optional(),
  cacheWriteTokens: z.number().int().nonnegative().safe().nullable().optional(),
}).strict();
export type ModelReceipt = z.infer<typeof ModelReceiptSchema>;
/** Fixed structural names only: never retain validation messages, values, or unknown object keys. */
export const ModelDiagnosticFieldSchema = z.enum([
  "objective", "objectiveProvenance", "intendedOutput", "criteria", "questions", "assumptions", "openAmbiguities", "explicitExclusions",
  "key", "description", "field", "operator", "value", "unit", "importance", "scope", "provenance", "group", "groupOperator", "unresolvedAlternatives",
  "start", "end", "quote", "text", "criterionKeys", "evidenceStandard", "reversible", "consequence", "question", "whyMaterial",
  "candidates", "assertions", "label", "evidence", "passageId", "candidateKey", "quantities", "currency", "billingPeriod", "qualifier", "limitations",
  "assessments", "claimKey", "status", "rationale", "missingEvidence", "action", "type", "query", "questionKeys", "publicQueryBasis", "sourceHandle", "claimKeys",
  "entity", "plan", "version", "geography", "time", "population", "title", "sections", "heading", "paragraphs", "unresolvedQuestionKeys",
  "questionKey", "assertionKeys", "reason", "omittedRequirements", "calculations", "calculationKeys", "inputs", "quantityIndex", "other",
]);
export const ModelValidationDiagnosticsSchema = z.object({
  version: z.literal("model-validation-diagnostics.v1"), stage: z.literal("output_schema"),
  issues: z.array(z.object({ code: z.nativeEnum(z.ZodIssueCode),
    path: z.array(z.union([ModelDiagnosticFieldSchema, z.number().int().nonnegative().max(1_000_000)])).max(12),
  }).strict()).max(16),
  truncated: z.boolean(),
}).strict();
export type ModelValidationDiagnostics = z.infer<typeof ModelValidationDiagnosticsSchema>;
export type ModelResult<K extends ResearchModelOperation> =
  | { status: "succeeded"; output: ResearchModelOutput<K>; receipt: ModelReceipt }
  | { status: "refused" | "invalid_output" | "transient_failure" | "permanent_failure" | "outcome_unknown";
      reason: string; receipt: ModelReceipt; diagnostics?: ModelValidationDiagnostics };
export type PreparedModelRequest<K extends ResearchModelOperation> = {
  operation: K; body: string; digest: string; schemaVersion: string; promptVersion: string; policyId: string;
};

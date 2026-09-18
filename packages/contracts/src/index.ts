import { z } from "zod";
export const CONSENT_POLICY_VERSION = "2026-09-18.1";

export const SCHEMA_VERSION = "1";
/** Versioned research-controller state projection. Additive to SCHEMA_VERSION. */
export const CONTROLLER_CONTRACT_VERSION = "research-controller.v1";

export const IdSchema = z.string().uuid();
export type Id = z.infer<typeof IdSchema>;

export const RouteModeSchema = z.enum(["fixture", "controlled-research", "hosted-baseline"]);
export type RouteMode = z.infer<typeof RouteModeSchema>;

export const LifecycleSchema = z.enum(["queued", "running", "awaiting_input", "cancelling", "terminal"]);
export type Lifecycle = z.infer<typeof LifecycleSchema>;

export const PhaseSchema = z.enum(["preparing", "researching", "verifying", "writing"]);
export type Phase = z.infer<typeof PhaseSchema>;

export const TerminalOutcomeSchema = z.enum([
  "completed",
  "completed_with_limitations",
  "cancelled",
  "failed",
]);
export type TerminalOutcome = z.infer<typeof TerminalOutcomeSchema>;

export const ConstraintOriginSchema = z.enum(["explicit", "confirmed", "assumed", "document", "system"]);
export const ConstraintImportanceSchema = z.enum(["hard", "preference"]);
export const ConstraintProvenanceSchema = z.enum([
  "user_provided",
  "model_inferred",
  "document_derived",
  "system_generated",
]);
export type ConstraintProvenance = z.infer<typeof ConstraintProvenanceSchema>;

export const ConstraintSchema = z.object({
  id: z.string(),
  field: z.string(),
  operator: z.string(),
  value: z.string(),
  units: z.string().optional(),
  origin: ConstraintOriginSchema,
  importance: ConstraintImportanceSchema,
  explanation: z.string(),
  appliesTo: z.string().optional(),
  provenance: ConstraintProvenanceSchema.optional(),
});
export type Constraint = z.infer<typeof ConstraintSchema>;

export const AssumptionSchema = z.object({
  id: z.string(),
  value: z.string(),
  reversibility: z.enum(["reversible", "consequential"]),
  impact: z.string(),
  userConfirmationState: z.enum(["unconfirmed", "accepted", "rejected"]),
});
export type Assumption = z.infer<typeof AssumptionSchema>;

export const ResearchBriefSchema = z.object({
  id: IdSchema,
  conversationId: IdSchema,
  originalQuestion: z.string().min(1),
  desiredOutcome: z.string().optional(),
  audience: z.string().optional(),
  language: z.string().default("en"),
  geography: z.string().optional(),
  timeRange: z.string().optional(),
  freshnessRequirements: z.string().optional(),
  outputPreferences: z.string().optional(),
  attachmentIds: z.array(IdSchema).default([]),
  sourceRestrictions: z.array(z.string()).default([]),
  nonGoals: z.array(z.string()).default([]),
  constraints: z.array(ConstraintSchema).default([]),
  assumptions: z.array(AssumptionSchema).default([]),
  budgetPolicyId: z.string(),
  consentPolicyVersion: z.string(),
  revision: z.number().int().positive(),
});
export type ResearchBrief = z.infer<typeof ResearchBriefSchema>;

export const AccessLevelSchema = z.enum([
  "discovered",
  "snippet",
  "abstract",
  "partial-text",
  "full-text",
  "visual-inspected",
  "blocked",
  "failed",
]);
export type AccessLevel = z.infer<typeof AccessLevelSchema>;

export const ActionTypeSchema = z.enum([
  "clarify",
  "search",
  "fetch",
  "extract_text",
  "extract_table",
  "inspect_visual",
  "compare",
  "calculate",
  "verify",
  "challenge",
  "replan",
  "synthesize",
  "stop",
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const PrivilegedActionTypes = ["reveal_keys", "grant_tool", "change_policy", "purchase"] as const;

export const ActionProposalSchema = z.object({
  actionId: z.string().min(1).max(200),
  runId: IdSchema,
  briefRevision: z.number().int().positive().safe(),
  type: z.string().min(1).max(100),
  coverageIds: z.array(z.string().min(1).max(200)).max(50).default([]),
  gapId: z.string().min(1).max(200).optional(),
  arguments: z.record(z.unknown()).default({}),
  rationale: z.string().max(4000),
  estimatedMaxCostMicro: z.number().int().nonnegative().safe().default(0),
  sourceAccessConstraints: z.array(z.string().max(200)).max(20).default([]),
  dedupeKey: z.string().min(1).max(4000),
  privileged: z.boolean().default(false),
}).strict();
export type ActionProposal = z.infer<typeof ActionProposalSchema>;

export const RevisionBasisSchema = z.object({
  briefRevision: z.number().int(),
  evidenceRevision: z.number().int(),
  consentEpoch: z.number().int(),
  cancellationEpoch: z.number().int(),
  workerLeaseFence: z.number().int(),
});
export type RevisionBasis = z.infer<typeof RevisionBasisSchema>;

export const ClaimTypeSchema = z.enum([
  "external-fact",
  "user-provided",
  "calculation",
  "inference",
  "conditional-conclusion",
  "limitation",
]);

export const SupportStatusSchema = z.enum(["direct", "inference", "disputed", "unverified"]);
export const EvidenceRelationSchema = z.enum(["supports", "contradicts", "qualifies", "context-only"]);

export const ReportBlockSchema = z.object({
  id: z.string(),
  kind: z.enum(["heading", "text", "list", "table", "quote", "code", "caveat"]),
  text: z.string(),
  claimIds: z.array(z.string()).default([]),
  citationIds: z.array(z.string()).default([]),
});
export type ReportBlock = z.infer<typeof ReportBlockSchema>;

export const CanonicalReportSchema = z.object({
  reportId: IdSchema,
  version: z.number().int().positive(),
  runId: IdSchema,
  basis: RevisionBasisSchema,
  outcome: TerminalOutcomeSchema,
  blocks: z.array(ReportBlockSchema),
  claimIds: z.array(z.string()),
  limitations: z.array(z.string()).default([]),
  sourceAccessSummary: z.array(
    z.object({
      sourceId: z.string(),
      title: z.string(),
      accessLevel: AccessLevelSchema,
      originCluster: z.string().optional(),
    }),
  ),
  changeSummary: z
    .object({
      comparison:z.object({version:z.literal("report-changes.v1"),parentReportId:z.string().uuid(),
        addedClaimRevisionIds:z.array(z.string().uuid()),removedClaimRevisionIds:z.array(z.string().uuid()),unchangedAssertions:z.number().int().nonnegative(),
        addedCriterionIds:z.array(z.string().uuid()),removedCriterionIds:z.array(z.string().uuid()),
        reusedCitedSourceVersionIds:z.array(z.string().uuid()),newlyCitedSourceVersionIds:z.array(z.string().uuid()),reportStateChanged:z.boolean(),
      }).strict().optional(),
      evidenceUpdated: z.boolean(),
      conclusionChanged: z.boolean(),
      newlyFeasible: z.array(z.string()).default([]),
      newlyInfeasible: z.array(z.string()).default([]),
      notes: z.string(),
    })
    .optional(),
  routeMode: RouteModeSchema,
});
export type CanonicalReport = z.infer<typeof CanonicalReportSchema>;

export const PublicEventSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  sequence: z.number().int().nonnegative(),
  createdAt: z.string(),
  schemaVersion: z.string(),
  type: z.string(),
  publicSummary: z.string(),
  phase: PhaseSchema,
  snapshotRevision: z.number().int(),
  relatedIds: z.record(z.string()).optional(),
});
export type PublicEvent = z.infer<typeof PublicEventSchema>;

export const CreateRunRequestSchema = z.object({
  question: z.string().min(1).max(20_000),
  routeMode: RouteModeSchema.default("fixture"),
  attachmentIds: z.array(IdSchema).default([]),
  conversationId: IdSchema.optional(),
  parentRunId: IdSchema.optional(),
  expectedBriefRevision: z.number().int().optional(),
  outputPreferences: z.string().optional(),
  consentPolicyVersion: z.string().default(CONSENT_POLICY_VERSION),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const ResearchCorrectionPatchSchema=z.discriminatedUnion("kind",[
 z.object({
  kind:z.literal("append_attachments"),
  attachmentIds:z.array(IdSchema).min(1).max(3).refine(ids=>new Set(ids.map(id=>id.toLowerCase())).size===ids.length),
  evidencePolicy:z.literal("reuse_snapshot"),
 }).strict(),
 z.object({
  kind:z.literal("replace_question"),question:z.string().min(1).max(20_000),
  evidencePolicy:z.enum(["reuse_snapshot","refresh"]),
 }).strict(),
 z.object({
  kind:z.literal("replace_question_span"),originalQuestionSha256:z.string().regex(/^[a-f0-9]{64}$/u),
  start:z.number().int().min(0).max(20_000),end:z.number().int().min(0).max(20_000),
  quote:z.string().max(20_000),replacement:z.string().max(20_000),
  evidencePolicy:z.enum(["reuse_snapshot","refresh"]),
 }).strict(),
]);
export type ResearchCorrectionPatch=z.infer<typeof ResearchCorrectionPatchSchema>;
export const CorrectionRequestSchema = z.object({
  patch:ResearchCorrectionPatchSchema.optional(),
  expectedBriefRevision: z.number().int().positive(),
  correctionText: z.string().min(1).max(20_000),
  claimId: z.string().optional(),
  blockId: z.string().optional(),
});
export type CorrectionRequest = z.infer<typeof CorrectionRequestSchema>;

export const ErrorCodeSchema = z.enum([
  "invalid_input",
  "permission_denied",
  "consent_required",
  "stale_revision",
  "capacity_unavailable",
  "allowance_exhausted",
  "source_unavailable",
  "extraction_partial",
  "provider_outcome_unknown",
  "internal_failure",
  "idempotency_conflict",
  "publication_rejected",
  "cancelled",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export type ApiErrorBody = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  correlationId: string;
  preserved: string;
};

export const ALLOWED_ATTACHMENT_MIMES = [
  "text/plain",
  "text/markdown",
  "application/pdf",
  "text/html",
] as const;

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_FETCH_BYTES = 1_500_000;
export const WRITING_RESERVE_RATIO = 0.2;
export const DEFAULT_RUN_BUDGET_MICRO = 100_000;
export const FIXTURE_SEARCH_COST_MICRO = 5_000;
export const FIXTURE_FETCH_COST_MICRO = 3_000;
export const FIXTURE_SYNTH_COST_MICRO = 8_000;
/** Pinned fixture tariff set. Live OpenRouter list prices are not this constant. */
export const FIXTURE_TARIFF_VERSION = "fixture-2026-09-16";
/** One USD expressed in micro-units used by spend caps (1 USD = 1_000_000). */
export const MICRO_PER_USD = 1_000_000;
/** Conservative reservation for one live OpenRouter call including web plugin. $0.20. */
export const LIVE_CALL_RESERVE_MICRO = 200_000;
export const PROCESSOR_DISCLOSURE = [
  "App-owned research worker (this service)",
  "Optional OpenRouter model gateway when live route is enabled",
  "OpenAI or Microsoft Azure via OpenRouter, using the server-pinned structured text route",
  "Exa via OpenRouter for public search queries when structured discovery is enabled",
  "Optional retrieval/fetch of public URLs when live retrieval is enabled",
];
export const OUTPUT_REPORT_CATEGORIES = ["harmful", "inaccurate", "legal", "privacy", "other"] as const;
export type OutputReportCategory = (typeof OUTPUT_REPORT_CATEGORIES)[number];
export const PRIVACY_DATA_FLOWS =
  "Questions, optional attachments, and retrieved public pages are processed by the app-owned worker. The live route may send prompts to OpenRouter; structured text operations use the server-pinned OpenAI or Microsoft Azure endpoint through OpenRouter. Structured discovery sends approved public queries to Exa via OpenRouter. Private attachment text is not copied into public search queries.";
export const DELETION_VS_SUBSCRIPTION =
  "Deleting the app account cancels in-flight research and removes derived text. Cancelling a store subscription is a separate store action and does not by itself delete the account.";


export { ExecutableArguments, type ExecutableAction, type ExecutableActionKind } from "./action-arguments.js";

export * from "./research-model.js";
export * from "./scope-comparison.js";
export * from "./evidence-calculation.js";
export * from "./counterevidence.js";
export * from "./requested-verification.js";
export * from "./research-intent.js";

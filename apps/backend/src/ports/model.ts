import { z } from "zod";
import { ScopeComparisonContextSchema, ScopeComparisonResultSchema, ResearchModelOutputs, type ResearchModelOperation, type ResearchModelOutput } from "@deep/contracts";

/** Explicit projection, not controller/database serialization. Ownership is rechecked by the coordinator. */
export const ModelContextSchema = z.object({
  question: z.string().min(1).max(20_000),
  task: ResearchModelOutputs.brief.nullable(),
  passages: z.array(z.object({ id: z.string().uuid(), sourceVersionId: z.string().uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/), accessLevel: z.enum(["snippet", "abstract", "partial-text", "full-text"]),
    text: z.string().min(1).max(24_000),
  }).strict()).max(24),
  sources: z.array(z.object({ handle: z.string().min(1).max(100), title: z.string().max(500) }).strict()).max(40),
  assertions: ResearchModelOutputs.extract_assertions.shape.assertions,
  approvedClaimKeys: z.array(z.string().min(1).max(100)).max(60),
  draft: ResearchModelOutputs.write_report.nullable(),
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
}).strict();
export type ModelReceipt = z.infer<typeof ModelReceiptSchema>;
export type ModelResult<K extends ResearchModelOperation> =
  | { status: "succeeded"; output: ResearchModelOutput<K>; receipt: ModelReceipt }
  | { status: "refused" | "invalid_output" | "transient_failure" | "permanent_failure" | "outcome_unknown";
      reason: string; receipt: ModelReceipt };
export type PreparedModelRequest<K extends ResearchModelOperation> = {
  operation: K; body: string; digest: string; schemaVersion: string; promptVersion: string; policyId: string;
};

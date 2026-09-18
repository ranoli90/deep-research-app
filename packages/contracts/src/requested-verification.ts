import { z } from "zod";
export const REQUESTED_VERIFICATION_VERSION="requested-verification.v1";
export const RequestedVerificationRequestSchema=z.object({
 version:z.literal(REQUESTED_VERIFICATION_VERSION),reportId:z.string().uuid(),reportVersion:z.number().int().positive(),claimId:z.string().uuid(),
 note:z.string().max(4000).default(""),evidencePolicy:z.enum(["reuse_snapshot","refresh_sources"]),idempotencyKey:z.string().uuid(),
}).strict();
export type RequestedVerificationRequest=z.infer<typeof RequestedVerificationRequestSchema>;
export const RequestedVerificationOutcomeSchema=z.enum(["supported_in_inspected_evidence","contradicted_in_inspected_evidence","qualification_needed","unresolved","blocked","outcome_unknown"]);

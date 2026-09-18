import { z } from "zod";
import { QuestionSpanSchema } from "./research-model.js";
export const COUNTEREVIDENCE_VERSION="counterevidence.v1";
export const COUNTEREVIDENCE_SUFFIX="contradictions limitations exceptions";
export const CounterevidenceActionSchema=z.object({type:z.literal("challenge"),claimKeys:z.array(z.string().min(1).max(100)).min(1).max(6),
 questionKeys:z.array(z.string().min(1).max(100)).min(1).max(12),question:z.string().min(1).max(25000),hypothesis:z.literal("contradiction_or_missing_qualification")}).strict();
export const CounterevidenceSearchSchema=z.object({rationale:z.string().min(1).max(4000),action:z.object({type:z.literal("search"),query:z.string().min(1).max(4000),
 questionKeys:z.array(z.string().min(1).max(100)).min(1).max(12),publicQueryBasis:QuestionSpanSchema,
 queryTransform:z.literal(COUNTEREVIDENCE_VERSION)}).strict()}).strict();
export const CounterevidenceOutcomeSchema=z.enum(["counterevidence_found","no_counterevidence_found_in_inspected_evidence","blocked","unresolved_at_limit","outcome_unknown"]);
export type CounterevidenceAction=z.infer<typeof CounterevidenceActionSchema>;

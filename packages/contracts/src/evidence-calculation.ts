import { z } from "zod";
import { EvidenceQuoteSchema } from "./research-model.js";
export const EVIDENCE_CALCULATION_VERSION="evidence-calculation.v1";
const Key=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const EvidenceCalculationActionSchema=z.object({type:z.literal("calculate"),
 formula:z.enum(["sum","difference","product","ratio","percentage","annual_cost"]),
 inputs:z.array(z.object({claimKey:Key,quantityIndex:z.number().int().min(0).max(11)}).strict()).min(1).max(50)
  .refine(xs=>new Set(xs.map(x=>`${x.claimKey}:${x.quantityIndex}`)).size===xs.length,"Duplicate calculation input")}).strict();
export type EvidenceCalculationAction=z.infer<typeof EvidenceCalculationActionSchema>;
export const EvidenceCalculationResultSchema=z.object({version:z.literal(EVIDENCE_CALCULATION_VERSION),
 status:z.enum(["computed","unknown"]),formula:EvidenceCalculationActionSchema.shape.formula,
 reason:z.string().min(1).max(100),
 inputs:z.array(z.object({claimKey:Key,quantityIndex:z.number().int().min(0).max(11),value:z.string().max(300),
  evidence:z.array(EvidenceQuoteSchema).min(1).max(12),unit:z.string().max(300),currency:z.string().max(300).nullable(),billingPeriod:z.string().max(300).nullable()}).strict()).max(50),
 output:z.object({numerator:z.string().regex(/^-?\d+$/).max(1500),denominator:z.string().regex(/^[1-9]\d*$/).max(1500),
  unit:z.string().max(610),currency:z.string().max(300).nullable(),billingPeriod:z.string().max(300).nullable()}).strict().nullable(),
 assumptions:z.array(z.string().min(1).max(500)).max(5)}).strict().refine(result=>(result.status==="computed")===(result.output!==null),"Calculation outcome/output mismatch");
export type EvidenceCalculationResult=z.infer<typeof EvidenceCalculationResultSchema>;
